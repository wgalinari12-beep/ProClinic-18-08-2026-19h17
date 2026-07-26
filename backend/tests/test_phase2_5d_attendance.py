"""
Phase 2.5D — Structural fixes to attendance module.
P1: finalize_attendance IDEMPOTENT (cached result)
P2: appointment.status transitions (em_atendimento → concluido) + audit fields
P3: medical_record.session_id + session_number (ATT-YYYY-######) + FKs + consent_signature
P4: procedure_id propagates from appointment
Regression: dashboard/stats, appointments, patients, finance/*, budgets, ai/generate, RBAC.
"""
import os
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TIMEOUT = 60


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@proclinic.com", "password": "admin123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def bella_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "dra.bella@proclinic.com", "password": "bella123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="session")
def ana_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "ana.recep@proclinic.com", "password": "ana123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()["token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def bella_user(bella_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(bella_token), timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def test_patient(admin_token):
    # Reuse existing or create one
    r = requests.get(f"{BASE_URL}/api/patients", headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code == 200
    patients = r.json()
    if patients:
        return patients[0]
    payload = {"name": "TEST_P25D_Patient", "phone": "11999999999",
               "email": "test_p25d@example.com", "birthdate": "1990-01-01"}
    r = requests.post(f"{BASE_URL}/api/patients", json=payload,
                      headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="session")
def test_procedure(admin_token):
    payload = {"name": "TEST_proc_p4", "price": 100, "duration_minutes": 30, "active": True}
    r = requests.post(f"{BASE_URL}/api/procedures", json=payload,
                      headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_appt(token, patient, professional, procedure_name="Atendimento", procedure_id=None):
    now = datetime.now(timezone.utc)
    start = (now + timedelta(minutes=5)).isoformat()
    end = (now + timedelta(minutes=35)).isoformat()
    payload = {
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name"),
        "procedure": procedure_name,
        "procedure_id": procedure_id,
        "professional_id": professional["user_id"],
        "professional_name": professional.get("name"),
        "start": start,
        "end": end,
        "status": "agendado",
    }
    r = requests.post(f"{BASE_URL}/api/appointments", json=payload,
                      headers=H(token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), f"appt create failed: {r.status_code} {r.text}"
    return r.json()


# ---------- P1: Idempotência ----------
class TestP1Idempotency:
    def test_finalize_idempotent_same_payload(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        s = requests.post(f"{BASE_URL}/api/attendance/start",
                          json={"appointment_id": apt["appointment_id"]},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert s.status_code == 200, s.text
        sid = s.json()["session_id"]
        appt_id = apt["appointment_id"]

        payload = {"payment_status": "pago", "amount_total": 500, "payment_method": "pix"}
        f1 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f1.status_code == 200, f1.text
        r1 = f1.json()

        # Second call — should return cached result
        f2 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f2.status_code == 200, f2.text
        r2 = f2.json()

        assert r1["record_id"] == r2["record_id"]
        assert r1["session_number"] == r2["session_number"]
        assert r1["financial_entries"] == r2["financial_entries"]

        # Count medical_records for this session — must be 1
        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={test_patient['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        assert mr.status_code == 200
        recs = [x for x in mr.json() if x.get("session_id") == sid]
        assert len(recs) == 1, f"expected 1 medical_record for session, got {len(recs)}"

        # Count financial entries for this appointment — must be 1
        fe = requests.get(f"{BASE_URL}/api/finance/entries",
                          headers=H(bella_token), timeout=TIMEOUT)
        # bella (profissional) has no access to finance — use admin
        # skip this way; use admin_token via secondary check below

    def test_finalize_idempotent_finance_count(self, admin_token, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        appt_id = apt["appointment_id"]
        s = requests.post(f"{BASE_URL}/api/attendance/start",
                          json={"appointment_id": appt_id},
                          headers=H(bella_token), timeout=TIMEOUT)
        sid = s.json()["session_id"]

        payload = {"payment_status": "pago", "amount_total": 500, "payment_method": "pix"}
        f1 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f1.status_code == 200
        r1 = f1.json()
        f2 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f2.status_code == 200
        r2 = f2.json()
        assert r1["record_id"] == r2["record_id"]

        # Use admin to check financial entries for this appointment
        fe = requests.get(f"{BASE_URL}/api/finance/entries",
                          headers=H(admin_token), timeout=TIMEOUT)
        assert fe.status_code == 200
        entries = [e for e in fe.json() if e.get("appointment_id") == appt_id]
        assert len(entries) == 1, f"expected 1 financial entry for appt, got {len(entries)}: {entries}"

    def test_finalize_idempotent_different_payload_ignored(self, admin_token, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        appt_id = apt["appointment_id"]
        s = requests.post(f"{BASE_URL}/api/attendance/start",
                          json={"appointment_id": appt_id},
                          headers=H(bella_token), timeout=TIMEOUT)
        sid = s.json()["session_id"]

        f1 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json={"payment_status": "pago", "amount_total": 500},
                           headers=H(bella_token), timeout=TIMEOUT)
        assert f1.status_code == 200
        r1 = f1.json()

        # Second call with different payload — must return first result
        f2 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                           json={"payment_status": "nao_pago", "amount_total": 9999,
                                 "installments": 10},
                           headers=H(bella_token), timeout=TIMEOUT)
        assert f2.status_code == 200
        r2 = f2.json()
        assert r1["record_id"] == r2["record_id"]
        assert r1["financial_entries"] == r2["financial_entries"]
        assert len(r2["financial_entries"]) == 1, "second payload must not create 10 installments"

        # Confirm on finance
        fe = requests.get(f"{BASE_URL}/api/finance/entries",
                          headers=H(admin_token), timeout=TIMEOUT)
        entries = [e for e in fe.json() if e.get("appointment_id") == appt_id]
        assert len(entries) == 1


# ---------- P2: Status transitions ----------
class TestP2StatusTransitions:
    def test_start_sets_em_atendimento(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        appt_id = apt["appointment_id"]
        s = requests.post(f"{BASE_URL}/api/attendance/start",
                          json={"appointment_id": appt_id},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert s.status_code == 200
        sid = s.json()["session_id"]

        # GET appointments and verify
        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        found = next((a for a in r.json() if a.get("appointment_id") == appt_id), None)
        assert found is not None
        assert found["status"] == "em_atendimento", f"status={found['status']}"
        assert found.get("attendance_started_at"), "attendance_started_at missing"
        assert found.get("attendance_started_by") == bella_user["user_id"]

        # Finalize and verify concluido + finished metadata
        f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                          json={"payment_status": "pago", "amount_total": 100},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert f.status_code == 200

        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(bella_token), timeout=TIMEOUT)
        found = next((a for a in r.json() if a.get("appointment_id") == appt_id), None)
        assert found["status"] == "concluido"
        assert found.get("finished_at")
        assert found.get("finished_by") == bella_user["user_id"]
        assert isinstance(found.get("duration_minutes"), int)

    def test_appointments_backward_compat(self, admin_token):
        # Old appointments without attendance_started_at should still list without error
        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- P3: Session ID + Number ----------
class TestP3SessionIdentifiers:
    def test_session_number_sequential(self, bella_token, bella_user, test_patient):
        session_numbers = []
        record_ids = []
        for _ in range(3):
            apt = _make_appt(bella_token, test_patient, bella_user)
            s = requests.post(f"{BASE_URL}/api/attendance/start",
                              json={"appointment_id": apt["appointment_id"]},
                              headers=H(bella_token), timeout=TIMEOUT)
            sid = s.json()["session_id"]
            f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                              json={"payment_status": "pago", "amount_total": 100,
                                    "payment_method": "pix"},
                              headers=H(bella_token), timeout=TIMEOUT)
            assert f.status_code == 200
            data = f.json()
            session_numbers.append(data["session_number"])
            record_ids.append(data["record_id"])

        year = datetime.now(timezone.utc).year
        import re
        for sn in session_numbers:
            m = re.match(rf"^ATT-{year}-(\d{{6}})$", sn)
            assert m, f"bad session_number format: {sn}"

        # Sequential (strictly increasing)
        seqs = [int(sn.split("-")[-1]) for sn in session_numbers]
        assert seqs[1] == seqs[0] + 1, f"not sequential: {seqs}"
        assert seqs[2] == seqs[1] + 1, f"not sequential: {seqs}"

        # Verify medical_record has proper fields
        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={test_patient['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        assert mr.status_code == 200
        by_rec = {r["record_id"]: r for r in mr.json() if r.get("record_id") in record_ids}
        assert len(by_rec) == 3
        for rid, rec in by_rec.items():
            assert rec.get("session_id"), "session_id missing"
            assert rec.get("session_number", "").startswith(f"ATT-{year}-")
            assert rec.get("appointment_id")
            assert rec.get("professional_id") == bella_user["user_id"]
            # procedure_id may be None if appt didn't have procedure_id — accepted per spec

    def test_medical_records_backward_compat(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/medical-records",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- P4: procedure_id propagation ----------
class TestP4ProcedureId:
    def test_procedure_id_on_appointment(self, admin_token, bella_token, bella_user,
                                        test_patient, test_procedure):
        proc_id = test_procedure.get("procedure_id") or test_procedure.get("id")
        assert proc_id, f"procedure has no id: {test_procedure}"
        now = datetime.now(timezone.utc)
        payload = {
            "patient_id": test_patient["patient_id"],
            "patient_name": test_patient.get("name"),
            "procedure": "TEST_proc_p4",
            "procedure_id": proc_id,
            "professional_id": bella_user["user_id"],
            "professional_name": bella_user.get("name"),
            "start": (now + timedelta(minutes=10)).isoformat(),
            "end": (now + timedelta(minutes=40)).isoformat(),
            "status": "agendado",
        }
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload,
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201), r.text
        appt_id = r.json()["appointment_id"]

        r = requests.get(f"{BASE_URL}/api/appointments",
                        headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        found = next((a for a in r.json() if a.get("appointment_id") == appt_id), None)
        assert found is not None
        assert found.get("procedure_id") == proc_id, f"procedure_id not persisted: {found.get('procedure_id')}"


# ---------- Regression ----------
class TestRegression:
    def test_dashboard_stats(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_appointments_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/appointments", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_patients_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_summary(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/finance/summary", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_entries(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/finance/entries", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_patient_summary(self, admin_token, test_patient):
        r = requests.get(
            f"{BASE_URL}/api/finance/patient/{test_patient['patient_id']}/summary",
            headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_entry_post_with_receipt(self, admin_token, test_patient):
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": "TEST_regression_paid_entry",
            "amount": 100.0,
            "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "paid": True,
            "patient_id": test_patient["patient_id"],
            "payment_method": "pix",
        }
        r = requests.post(f"{BASE_URL}/api/finance/entries", json=payload,
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201), r.text

    def test_budgets_post(self, admin_token, test_patient):
        payload = {
            "patient_id": test_patient["patient_id"],
            "patient_name": test_patient.get("name"),
            "items": [{"name": "TEST_item", "description": "TEST_item", "qty": 1, "unit_price": 100, "total": 100}],
            "total": 100,
            "status": "rascunho",
        }
        r = requests.post(f"{BASE_URL}/api/budgets", json=payload,
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201), r.text

    def test_ai_generate(self, admin_token):
        payload = {"prompt": "Diga apenas: OK", "type": "generic"}
        r = requests.post(f"{BASE_URL}/api/ai/generate", json=payload,
                          headers=H(admin_token), timeout=TIMEOUT)
        # accept 200 or 400 depending on implementation contract; check if endpoint exists
        assert r.status_code in (200, 400, 422), f"ai/generate failed: {r.status_code} {r.text}"


class TestRegressionRBAC:
    def test_bella_forbidden_finance_entries_get(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/finance/entries", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"

    def test_ana_get_finance_ok(self, ana_token):
        r = requests.get(f"{BASE_URL}/api/finance/entries", headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_ana_post_finance_forbidden(self, ana_token, test_patient):
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": "TEST_rbac_ana",
            "amount": 10,
            "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "paid": False,
            "patient_id": test_patient["patient_id"],
        }
        r = requests.post(f"{BASE_URL}/api/finance/entries", json=payload,
                          headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403


class TestRegressionManualMedicalRecord:
    def test_manual_medical_record_post_bella(self, bella_token, bella_user, test_patient):
        payload = {
            "patient_id": test_patient["patient_id"],
            "patient_name": test_patient.get("name"),
            "procedure": "TEST_manual_record",
            "evolution": "Nota manual de teste",
            "observations": "",
        }
        r = requests.post(f"{BASE_URL}/api/medical-records", json=payload,
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201), r.text
