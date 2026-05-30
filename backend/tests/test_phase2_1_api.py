"""ProClinic Phase 2.1 backend tests:
- Procedures CRUD
- Clinic settings GET/PUT (upsert)
- Public confirmation link + GET + action (no auth on public endpoints)
- Mobile upload init / verify / files (no auth on public endpoints)
- Patient pre-registered flag
- AnamnesisModule photos field
"""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@proclinic.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def auth():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"headers": {"Authorization": f"Bearer {data['token']}"}, "token": data["token"]}


@pytest.fixture(scope="session")
def seed_patient(auth):
    r = requests.get(f"{API}/patients", headers=auth["headers"])
    assert r.status_code == 200
    pats = r.json()
    assert pats
    return pats[0]


@pytest.fixture(scope="session")
def seed_appointment(auth):
    r = requests.get(f"{API}/appointments", headers=auth["headers"])
    assert r.status_code == 200
    apts = r.json()
    assert apts
    return apts[0]


# ---------- 1. Procedures CRUD ----------
class TestProcedures:
    def test_create_procedure(self, auth):
        payload = {
            "name": f"TEST_Botox_{uuid.uuid4().hex[:6]}",
            "description": "Aplicação de toxina botulínica",
            "price": 1500.0,
            "duration_minutes": 60,
            "category": "Facial",
            "active": True,
        }
        r = requests.post(f"{API}/procedures", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["price"] == 1500.0
        assert data["duration_minutes"] == 60
        assert "procedure_id" in data
        assert "clinic_id" in data
        pytest.proc_id = data["procedure_id"]

    def test_list_procedures(self, auth):
        r = requests.get(f"{API}/procedures", headers=auth["headers"])
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        assert any(d["procedure_id"] == pytest.proc_id for d in docs)

    def test_list_active_only(self, auth):
        r = requests.get(f"{API}/procedures?active_only=true", headers=auth["headers"])
        assert r.status_code == 200
        assert all(d.get("active") for d in r.json())

    def test_update_procedure(self, auth):
        payload = {
            "name": "TEST_Botox_updated",
            "price": 1800.0,
            "duration_minutes": 90,
            "active": False,
        }
        r = requests.put(f"{API}/procedures/{pytest.proc_id}", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price"] == 1800.0
        assert d["duration_minutes"] == 90
        assert d["active"] is False

    def test_delete_procedure(self, auth):
        r = requests.delete(f"{API}/procedures/{pytest.proc_id}", headers=auth["headers"])
        assert r.status_code == 200
        # verify removed
        r2 = requests.get(f"{API}/procedures", headers=auth["headers"])
        assert all(d["procedure_id"] != pytest.proc_id for d in r2.json())

    def test_procedures_requires_auth(self):
        r = requests.get(f"{API}/procedures")
        assert r.status_code == 401


# ---------- 2. Clinic settings ----------
class TestClinicSettings:
    def test_get_clinic(self, auth):
        r = requests.get(f"{API}/clinic", headers=auth["headers"])
        assert r.status_code == 200
        d = r.json()
        assert "clinic_id" in d

    def test_update_clinic_full_fields(self, auth):
        payload = {
            "name": "ProClinic Demo TEST",
            "legal_name": "ProClinic Estética Ltda",
            "cnpj": "12.345.678/0001-90",
            "state_registration": "123456",
            "phone": "(11) 3333-4444",
            "whatsapp": "(11) 99999-8888",
            "email": "contato@proclinic.com",
            "website": "https://proclinic.com",
            "address": "Av. Paulista, 1000",
            "zipcode": "01310-100",
            "city": "São Paulo",
            "state": "SP",
            "technical_responsible_name": "Dra. Bella Castro",
            "technical_responsible_council": "CRM-SP",
            "technical_responsible_number": "12345",
            "instagram": "@proclinic",
            "facebook": "proclinic",
            "tiktok": "@proclinic",
            "youtube": "@proclinic",
            "logo_url": "/api/files/test/logo.png",
        }
        r = requests.put(f"{API}/clinic", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        for k, v in payload.items():
            assert d.get(k) == v, f"Field {k} mismatch: {d.get(k)} != {v}"

        # GET to verify persistence
        r2 = requests.get(f"{API}/clinic", headers=auth["headers"])
        d2 = r2.json()
        assert d2["legal_name"] == "ProClinic Estética Ltda"
        assert d2["cnpj"] == "12.345.678/0001-90"
        assert d2["technical_responsible_name"] == "Dra. Bella Castro"
        assert d2["instagram"] == "@proclinic"

    def test_clinic_requires_auth(self):
        assert requests.get(f"{API}/clinic").status_code == 401
        assert requests.put(f"{API}/clinic", json={}).status_code == 401


# ---------- 3. Public confirmation link ----------
class TestPublicConfirmation:
    def test_get_confirmation_link_auth_required(self, seed_appointment):
        r = requests.get(f"{API}/appointments/{seed_appointment['appointment_id']}/confirmation-link")
        assert r.status_code == 401

    def test_get_confirmation_link(self, auth, seed_appointment):
        r = requests.get(
            f"{API}/appointments/{seed_appointment['appointment_id']}/confirmation-link",
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d
        assert isinstance(d["token"], str)
        assert len(d["token"]) > 20
        pytest.conf_token = d["token"]

    def test_public_get_appointment_no_auth(self):
        # no auth header — must work
        r = requests.get(f"{API}/public/appointment/{pytest.conf_token}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "appointment" in d
        assert "clinic" in d
        assert d["appointment"]["procedure"]
        assert d["clinic"]["name"]

    def test_public_get_invalid_token(self):
        r = requests.get(f"{API}/public/appointment/invalid.bogus.token")
        assert r.status_code == 401

    def test_public_action_confirm(self):
        r = requests.post(
            f"{API}/public/appointment/{pytest.conf_token}/action",
            json={"action": "confirm"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["confirmation_status"] == "CONFIRMADO"

    def test_public_action_persisted(self):
        r = requests.get(f"{API}/public/appointment/{pytest.conf_token}")
        d = r.json()
        assert d["appointment"]["confirmation_status"] == "CONFIRMADO"
        assert d["appointment"]["status"] == "confirmado"

    def test_public_action_cancel(self):
        r = requests.post(
            f"{API}/public/appointment/{pytest.conf_token}/action",
            json={"action": "cancel"},
        )
        assert r.status_code == 200
        assert r.json()["confirmation_status"] == "CANCELADO"

    def test_public_action_reschedule(self):
        r = requests.post(
            f"{API}/public/appointment/{pytest.conf_token}/action",
            json={"action": "reschedule", "reschedule_note": "manhã"},
        )
        assert r.status_code == 200
        assert r.json()["confirmation_status"] == "REAGENDAMENTO_SOLICITADO"


# ---------- 4. Mobile upload tokens ----------
class TestMobileUpload:
    def test_init_auth_required(self):
        r = requests.post(f"{API}/mobile-upload/init", json={"context_type": "anamnesis", "context_id": "x"})
        assert r.status_code == 401

    def test_init_token(self, auth):
        r = requests.post(
            f"{API}/mobile-upload/init",
            json={"context_type": "anamnesis", "context_id": "module_test_123", "label": "Ficha Geral"},
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d
        assert d["expires_in_minutes"] == 20
        pytest.mob_token = d["token"]

    def test_verify_token_no_auth(self):
        r = requests.get(f"{API}/mobile-upload/verify/{pytest.mob_token}")
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["context_type"] == "anamnesis"
        assert d["context_id"] == "module_test_123"

    def test_verify_invalid_token(self):
        r = requests.get(f"{API}/mobile-upload/verify/bogus.token.x")
        assert r.status_code == 401

    def test_files_list_empty(self):
        r = requests.get(f"{API}/mobile-upload/files/{pytest.mob_token}")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_files_invalid_token(self):
        r = requests.get(f"{API}/mobile-upload/files/bogus")
        assert r.status_code == 401


# ---------- 5. Patient pre-registered flag ----------
class TestPatientPreRegistered:
    def test_create_pre_registered_patient(self, auth):
        payload = {
            "name": f"TEST_PreReg_{uuid.uuid4().hex[:6]}",
            "phone": "(11) 99999-1111",
            "is_pre_registered": True,
        }
        r = requests.post(f"{API}/patients", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_pre_registered"] is True
        assert d["name"] == payload["name"]
        pytest.prereg_id = d["patient_id"]

    def test_get_persisted_pre_registered(self, auth):
        r = requests.get(f"{API}/patients/{pytest.prereg_id}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["is_pre_registered"] is True

    def test_default_false(self, auth):
        payload = {"name": f"TEST_Default_{uuid.uuid4().hex[:6]}"}
        r = requests.post(f"{API}/patients", json=payload, headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["is_pre_registered"] is False
        # cleanup
        requests.delete(f"{API}/patients/{r.json()['patient_id']}", headers=auth["headers"])

    def test_cleanup(self, auth):
        requests.delete(f"{API}/patients/{pytest.prereg_id}", headers=auth["headers"])


# ---------- 6. Anamnesis module photos field ----------
class TestAnamnesisPhotos:
    def test_save_module_with_photos(self, auth, seed_patient):
        payload = {
            "patient_id": seed_patient["patient_id"],
            "module": "geral",
            "answers": {"doencas": ["Diabetes"], "doencas_descricao": "tipo 2"},
            "photos": ["/api/files/test/p1.jpg", "/api/files/test/p2.jpg"],
        }
        r = requests.post(f"{API}/anamnesis-modules", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["photos"] == payload["photos"]
        assert d["module"] == "geral"

    def test_list_modules_includes_photos(self, auth, seed_patient):
        r = requests.get(
            f"{API}/anamnesis-modules?patient_id={seed_patient['patient_id']}",
            headers=auth["headers"],
        )
        assert r.status_code == 200
        docs = r.json()
        geral = next((m for m in docs if m["module"] == "geral"), None)
        assert geral is not None
        assert "photos" in geral
        assert len(geral["photos"]) >= 2


# ---------- 7. Regression: critical Phase 1+2 endpoints still work ----------
class TestRegression:
    def test_auth_me(self, auth):
        r = requests.get(f"{API}/auth/me", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_dashboard_stats(self, auth):
        r = requests.get(f"{API}/dashboard/stats", headers=auth["headers"])
        assert r.status_code == 200
        d = r.json()
        for k in ["total_patients", "appointments_today", "revenue_month",
                  "today_agenda", "birthdays", "top_procedures"]:
            assert k in d

    def test_finance_summary(self, auth):
        r = requests.get(f"{API}/finance/summary", headers=auth["headers"])
        assert r.status_code == 200
        d = r.json()
        for k in ["receitas", "despesas", "saldo", "a_receber", "a_pagar", "chart"]:
            assert k in d

    def test_messages_list(self, auth):
        r = requests.get(f"{API}/messages", headers=auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)
