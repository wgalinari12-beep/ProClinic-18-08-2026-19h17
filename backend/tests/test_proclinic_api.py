"""
ProClinic backend API tests
Covers: health, auth (JWT + protection), patients CRUD, appointments, medical records,
anamnesis, finance, dashboard, AI chat, google session endpoint.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://proclinic-deploy-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@proclinic.com"
ADMIN_PASSWORD = "admin123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth(session):
    r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["user_id"]
    token = data["token"]
    return {"token": token, "user": data, "headers": {"Authorization": f"Bearer {token}"}}


# ---------- Health ----------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "ok"
        assert "message" in j


# ---------- Auth ----------
class TestAuth:
    def test_login_success_sets_cookie(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"
        assert data["token"]
        # cookie set
        assert "access_token" in r.cookies

    def test_login_wrong_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpw"})
        assert r.status_code == 401

    def test_me_returns_user(self, auth, session):
        r = session.get(f"{API}/auth/me", headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["clinic_id"] == auth["user"]["clinic_id"]

    def test_me_unauthorized(self, session):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_register_new_user(self, session):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = session.post(f"{API}/auth/register", json={
            "email": email, "password": "Test12345!", "name": "Test User", "role": "recepcao"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == email
        assert data["token"]

    def test_logout_clears_cookies(self, session):
        # First login to set cookie
        r = requests.Session()
        r.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        out = r.post(f"{API}/auth/logout")
        assert out.status_code == 200
        assert out.json().get("ok") is True

    def test_google_session_missing_id(self, session):
        r = session.post(f"{API}/auth/google/session", json={})
        assert r.status_code == 400


# ---------- Patients ----------
class TestPatients:
    def test_list_patients_seeded(self, auth, session):
        r = session.get(f"{API}/patients", headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 4

    def test_create_get_update_delete_patient(self, auth, session):
        # create
        payload = {"name": "TEST_Paciente Beta", "cpf": "111.222.333-44",
                   "birth_date": "1992-05-10", "phone": "(11) 99999-0000",
                   "email": "test_beta@example.com", "lgpd_consent": True}
        r = session.post(f"{API}/patients", headers=auth["headers"], json=payload)
        assert r.status_code == 200, r.text
        pat = r.json()
        pid = pat["patient_id"]
        assert pat["name"] == payload["name"]
        assert pat["clinic_id"] == auth["user"]["clinic_id"]

        # get
        r = session.get(f"{API}/patients/{pid}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["name"] == payload["name"]

        # update
        new_payload = dict(payload, name="TEST_Paciente Beta Atualizado")
        r = session.put(f"{API}/patients/{pid}", headers=auth["headers"], json=new_payload)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Paciente Beta Atualizado"

        # verify GET reflects change
        r = session.get(f"{API}/patients/{pid}", headers=auth["headers"])
        assert r.json()["name"] == "TEST_Paciente Beta Atualizado"

        # delete
        r = session.delete(f"{API}/patients/{pid}", headers=auth["headers"])
        assert r.status_code == 200

        # verify gone
        r = session.get(f"{API}/patients/{pid}", headers=auth["headers"])
        assert r.status_code == 404

    def test_patients_requires_auth(self):
        r = requests.get(f"{API}/patients")
        assert r.status_code == 401


# ---------- Appointments ----------
class TestAppointments:
    def test_list_appointments(self, auth, session):
        r = session.get(f"{API}/appointments", headers=auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_update_delete_appointment(self, auth, session):
        patients = session.get(f"{API}/patients", headers=auth["headers"]).json()
        pid = patients[0]["patient_id"]
        from datetime import datetime, timedelta, timezone
        start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=2, hours=1)).isoformat()
        payload = {"patient_id": pid, "procedure": "TEST_Botox",
                   "start": start, "end": end, "status": "agendado", "price": 1200}
        r = session.post(f"{API}/appointments", headers=auth["headers"], json=payload)
        assert r.status_code == 200, r.text
        apt = r.json()
        aid = apt["appointment_id"]
        assert apt["patient_name"]

        payload2 = dict(payload, procedure="TEST_Botox Updated", status="confirmado")
        r = session.put(f"{API}/appointments/{aid}", headers=auth["headers"], json=payload2)
        assert r.status_code == 200
        assert r.json()["procedure"] == "TEST_Botox Updated"

        r = session.delete(f"{API}/appointments/{aid}", headers=auth["headers"])
        assert r.status_code == 200


# ---------- Medical Records ----------
class TestMedicalRecords:
    def test_create_and_list(self, auth, session):
        patients = session.get(f"{API}/patients", headers=auth["headers"]).json()
        pid = patients[0]["patient_id"]
        payload = {"patient_id": pid, "procedure": "TEST_Limpeza",
                   "evolution": "Paciente reagiu bem.", "photos_before": [], "photos_after": []}
        r = session.post(f"{API}/medical-records", headers=auth["headers"], json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["procedure"] == "TEST_Limpeza"

        r = session.get(f"{API}/medical-records?patient_id={pid}", headers=auth["headers"])
        assert r.status_code == 200
        assert any(d["procedure"] == "TEST_Limpeza" for d in r.json())


# ---------- Anamnesis ----------
class TestAnamnesis:
    def test_create_and_list(self, auth, session):
        patients = session.get(f"{API}/patients", headers=auth["headers"]).json()
        pid = patients[0]["patient_id"]
        payload = {"patient_id": pid, "template_name": "TEST_Padrão",
                   "answers": {"alergias": "nenhuma", "gravidez": "não"}, "signed": True}
        r = session.post(f"{API}/anamnesis", headers=auth["headers"], json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["template_name"] == "TEST_Padrão"

        r = session.get(f"{API}/anamnesis?patient_id={pid}", headers=auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Finance ----------
class TestFinance:
    def test_summary(self, auth, session):
        r = session.get(f"{API}/finance/summary", headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        for k in ["receitas", "despesas", "saldo", "a_receber", "a_pagar", "chart"]:
            assert k in data
        assert isinstance(data["chart"], list)
        assert len(data["chart"]) == 6

    def test_create_entry(self, auth, session):
        payload = {"type": "receita", "category": "TEST_Cat", "description": "TEST_lanc",
                   "amount": 250.0, "due_date": "2026-01-15", "paid": False}
        r = session.post(f"{API}/finance/entries", headers=auth["headers"], json=payload)
        assert r.status_code == 200, r.text
        eid = r.json()["entry_id"]
        # delete cleanup
        r2 = session.delete(f"{API}/finance/entries/{eid}", headers=auth["headers"])
        assert r2.status_code == 200


# ---------- Dashboard ----------
class TestDashboard:
    def test_stats(self, auth, session):
        r = session.get(f"{API}/dashboard/stats", headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        for k in ["total_patients", "appointments_today", "revenue_month",
                  "today_agenda", "birthdays", "occupancy_pct", "top_procedures"]:
            assert k in data
        assert data["total_patients"] >= 4


# ---------- AI Chat ----------
class TestAI:
    def test_chat_returns_reply(self, auth, session):
        payload = {"message": "Olá, faça uma saudação curta em 1 frase.", "session_id": f"test_{uuid.uuid4().hex[:8]}"}
        r = session.post(f"{API}/ai/chat", headers=auth["headers"], json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("reply")
        assert isinstance(data["reply"], str)
        assert len(data["reply"]) > 5
