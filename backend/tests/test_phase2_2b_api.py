"""Phase 2.2B backend tests: Budgets, Finalize Attendance financial flow, Recepcao RBAC."""

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@proclinic.com", "password": "admin123"}
RECEP = {"email": "ana.recep@proclinic.com", "password": "ana123"}
PROF = {"email": "dra.bella@proclinic.com", "password": "bella123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s, data


@pytest.fixture(scope="module")
def admin_sess():
    s, _ = _login(ADMIN)
    return s


@pytest.fixture(scope="module")
def recep_sess():
    s, _ = _login(RECEP)
    return s


@pytest.fixture(scope="module")
def prof_sess():
    s, _ = _login(PROF)
    return s


@pytest.fixture(scope="module")
def patient_id(admin_sess):
    """Create or reuse a test patient."""
    r = admin_sess.get(f"{API}/patients", timeout=20)
    assert r.status_code == 200, r.text
    plist = r.json()
    if plist:
        return plist[0]["patient_id"]
    payload = {"name": "TEST_PatBudget", "phone": "11999990000", "email": "tpb@test.com"}
    r = admin_sess.post(f"{API}/patients", json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()["patient_id"]


# ---------- Budgets ----------
class TestBudgets:
    created_budget_id = None
    public_token = None

    def test_create_budget_totals(self, admin_sess, patient_id):
        payload = {
            "patient_id": patient_id,
            "items": [
                {"name": "Limpeza de Pele", "quantity": 1, "unit_price": 1500, "discount_percent": 10, "discount_value": 0},
                {"name": "Massagem", "quantity": 2, "unit_price": 250, "discount_percent": 0, "discount_value": 50},
            ],
            "payment_method": "pix",
            "installments": 1,
            "status": "rascunho",
        }
        r = admin_sess.post(f"{API}/budgets", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["subtotal"] == 2000
        assert doc["discount"] == 200
        assert doc["total"] == 1800
        assert doc["status"] == "rascunho"
        assert doc.get("public_token")
        TestBudgets.created_budget_id = doc["budget_id"]
        TestBudgets.public_token = doc["public_token"]

    def test_list_budgets_by_patient(self, admin_sess, patient_id):
        r = admin_sess.get(f"{API}/budgets", params={"patient_id": patient_id}, timeout=20)
        assert r.status_code == 200
        docs = r.json()
        assert any(d["budget_id"] == TestBudgets.created_budget_id for d in docs)

    def test_get_budget(self, admin_sess):
        bid = TestBudgets.created_budget_id
        r = admin_sess.get(f"{API}/budgets/{bid}", timeout=20)
        assert r.status_code == 200
        assert r.json()["budget_id"] == bid

    def test_update_budget_recalc(self, admin_sess, patient_id):
        bid = TestBudgets.created_budget_id
        payload = {
            "patient_id": patient_id,
            "items": [
                {"name": "Botox", "quantity": 1, "unit_price": 1000, "discount_percent": 0, "discount_value": 0},
            ],
            "status": "enviado",
        }
        r = admin_sess.put(f"{API}/budgets/{bid}", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["subtotal"] == 1000 and d["discount"] == 0 and d["total"] == 1000
        assert d["status"] == "enviado"

    def test_public_link(self, admin_sess):
        bid = TestBudgets.created_budget_id
        r = admin_sess.get(f"{API}/budgets/{bid}/public-link", timeout=20)
        assert r.status_code == 200
        token = r.json()["token"]
        assert isinstance(token, str) and len(token) > 30

    def test_public_get_no_auth(self):
        # no auth header
        r = requests.get(f"{API}/public/budgets/{TestBudgets.public_token}", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "budget" in body and "clinic" in body
        assert body["budget"]["budget_id"] == TestBudgets.created_budget_id

    def test_public_sign_reject(self):
        r = requests.post(
            f"{API}/public/budgets/{TestBudgets.public_token}/sign",
            json={"action": "recusar"}, timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "recusado"

    def test_public_sign_approve(self, admin_sess):
        sig = "data:image/png;base64,iVBORw0KGgoAAAANS"
        r = requests.post(
            f"{API}/public/budgets/{TestBudgets.public_token}/sign",
            json={"action": "aprovar", "signature": sig}, timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "aprovado"
        # verify via auth GET
        bid = TestBudgets.created_budget_id
        r2 = admin_sess.get(f"{API}/budgets/{bid}", timeout=20)
        assert r2.status_code == 200
        d = r2.json()
        assert d["status"] == "aprovado"
        assert d.get("patient_signature") == sig


# ---------- Finalize attendance financial flow ----------
def _create_appointment_and_session(admin_sess, patient_id, price=1500):
    # Need a professional user_id
    r = admin_sess.get(f"{API}/users/professionals-public", timeout=20)
    assert r.status_code == 200
    profs = r.json()
    assert profs, "no professionals available"
    prof = profs[0]
    # Create appointment
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    apt_payload = {
        "patient_id": patient_id,
        "patient_name": "TEST_PatBudget",
        "professional_id": prof["user_id"],
        "professional_name": prof.get("name"),
        "procedure": "TEST Procedimento",
        "start": now,
        "end": now,
        "price": price,
        "status": "agendado",
    }
    r = admin_sess.post(f"{API}/appointments", json=apt_payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    apt = r.json()
    apt_id = apt["appointment_id"]
    # Start attendance session
    r = admin_sess.post(f"{API}/attendance/start", json={"appointment_id": apt_id}, timeout=20)
    assert r.status_code == 200, r.text
    sess = r.json()
    return apt_id, sess["session_id"]


class TestFinalizeFinancial:
    def test_finalize_pago(self, admin_sess, patient_id):
        apt_id, sid = _create_appointment_and_session(admin_sess, patient_id, price=1500)
        payload = {"payment_status": "pago", "amount_total": 1500, "payment_method": "pix"}
        r = admin_sess.post(f"{API}/attendance/{sid}/finalize", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        fin_ids = r.json()["financial_entries"]
        assert len(fin_ids) == 1
        # verify
        r2 = admin_sess.get(f"{API}/finance/entries", timeout=20)
        assert r2.status_code == 200
        all_entries = r2.json()
        e = next((x for x in all_entries if x["entry_id"] == fin_ids[0]), None)
        assert e is not None
        assert e["paid"] is True
        assert float(e["amount"]) == 1500
        assert e["payment_method"] == "pix"

    def test_finalize_parcial(self, admin_sess, patient_id):
        apt_id, sid = _create_appointment_and_session(admin_sess, patient_id, price=1500)
        payload = {
            "payment_status": "parcial",
            "amount_total": 1500,
            "amount_paid": 500,
            "payment_method": "pix",
            "due_date": "2026-07-10",
        }
        r = admin_sess.post(f"{API}/attendance/{sid}/finalize", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        fin_ids = r.json()["financial_entries"]
        assert len(fin_ids) == 2
        r2 = admin_sess.get(f"{API}/finance/entries", timeout=20)
        entries = {x["entry_id"]: x for x in r2.json() if x["entry_id"] in fin_ids}
        paid = [v for v in entries.values() if v["paid"]]
        unpaid = [v for v in entries.values() if not v["paid"]]
        assert len(paid) == 1 and float(paid[0]["amount"]) == 500
        assert len(unpaid) == 1 and float(unpaid[0]["amount"]) == 1000
        assert unpaid[0]["due_date"] == "2026-07-10"

    def test_finalize_nao_pago(self, admin_sess, patient_id):
        apt_id, sid = _create_appointment_and_session(admin_sess, patient_id, price=1500)
        payload = {"payment_status": "nao_pago", "amount_total": 1500}
        r = admin_sess.post(f"{API}/attendance/{sid}/finalize", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        fin_ids = r.json()["financial_entries"]
        assert len(fin_ids) == 1
        r2 = admin_sess.get(f"{API}/finance/entries", timeout=20)
        e = next((x for x in r2.json() if x["entry_id"] == fin_ids[0]), None)
        assert e and e["paid"] is False
        assert float(e["amount"]) == 1500

    def test_finalize_with_budget(self, admin_sess, patient_id):
        # Create a budget total=900
        bpayload = {
            "patient_id": patient_id,
            "items": [{"name": "P1", "quantity": 1, "unit_price": 900}],
            "status": "enviado",
        }
        rb = admin_sess.post(f"{API}/budgets", json=bpayload, timeout=20)
        assert rb.status_code == 200
        budget = rb.json()
        assert budget["total"] == 900

        apt_id, sid = _create_appointment_and_session(admin_sess, patient_id, price=1500)
        payload = {"payment_status": "pago", "budget_id": budget["budget_id"], "payment_method": "pix"}
        r = admin_sess.post(f"{API}/attendance/{sid}/finalize", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        fin_ids = r.json()["financial_entries"]
        assert len(fin_ids) == 1
        r2 = admin_sess.get(f"{API}/finance/entries", timeout=20)
        e = next((x for x in r2.json() if x["entry_id"] == fin_ids[0]), None)
        assert e and float(e["amount"]) == 900  # budget total used, not appt price
        # budget should now be aprovado
        rb2 = admin_sess.get(f"{API}/budgets/{budget['budget_id']}", timeout=20)
        assert rb2.json()["status"] == "aprovado"


# ---------- Recepcao RBAC ----------
class TestRecepcaoRBAC:
    def test_forbidden_clinical(self, recep_sess, patient_id):
        endpoints_403 = [
            ("GET", "/anamnesis", None),
            ("GET", "/medical-records", None),
            ("GET", "/anamnesis-modules", {"patient_id": patient_id}),
            ("GET", "/budgets", None),
        ]
        for method, ep, params in endpoints_403:
            r = recep_sess.request(method, f"{API}{ep}", params=params, timeout=20)
            assert r.status_code == 403, f"{ep} should be 403, got {r.status_code} {r.text}"

    def test_forbidden_attendance(self, recep_sess):
        r = recep_sess.post(f"{API}/attendance/start", json={"appointment_id": "x"}, timeout=20)
        assert r.status_code == 403, f"attendance/start: {r.status_code} {r.text}"
        r2 = recep_sess.post(f"{API}/attendance/some-id/finalize", json={}, timeout=20)
        assert r2.status_code == 403

    def test_allowed_endpoints(self, recep_sess):
        for ep in ["/patients", "/appointments", "/finance/entries"]:
            r = recep_sess.get(f"{API}{ep}", timeout=20)
            assert r.status_code == 200, f"{ep} should be 200, got {r.status_code} {r.text}"
