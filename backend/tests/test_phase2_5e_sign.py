"""
Phase 2.5E — Hardening: sign endpoint + financial_entries.session_id + C7 identity fields.

C3+: session_id + session_number em financial_entries
C4/C5: POST /api/attendance/{sid}/sign com metadata forense
C6: cleanup frontend (não testável no backend)
C7: autosave — PUT identity fields (appointment_id/patient_id) devem ser ignorados
Regression: /finalize idempotence + status transitions + medical_records
"""
import os
import re
import hashlib
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
VALID_SIG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf"
             "FcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
             + "A" * 100)  # >100 chars


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@proclinic.com", "password": "admin123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def bella_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "dra.bella@proclinic.com", "password": "bella123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def ana_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "ana.recep@proclinic.com", "password": "ana123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def bella_user(bella_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(bella_token), timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def test_patient(admin_token):
    r = requests.get(f"{BASE_URL}/api/patients", headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code == 200
    patients = r.json()
    if patients:
        return patients[0]
    payload = {"name": "TEST_P25E_Patient", "phone": "11988887777",
               "email": "test_p25e@example.com", "birthdate": "1990-01-01"}
    r = requests.post(f"{BASE_URL}/api/patients", json=payload,
                      headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_appt(token, patient, professional):
    now = datetime.now(timezone.utc)
    payload = {
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name"),
        "procedure": "Atendimento",
        "professional_id": professional["user_id"],
        "professional_name": professional.get("name"),
        "start": (now + timedelta(minutes=5)).isoformat(),
        "end": (now + timedelta(minutes=35)).isoformat(),
        "status": "agendado",
    }
    r = requests.post(f"{BASE_URL}/api/appointments", json=payload,
                      headers=H(token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _start_session(token, appt_id):
    r = requests.post(f"{BASE_URL}/api/attendance/start",
                      json={"appointment_id": appt_id}, headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


# ==================== C4/C5 — SIGN ENDPOINT ====================
class TestC4C5SignHappy:
    def test_sign_consent_ok(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])

        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "consent", "signature": VALID_SIG,
                                "timezone": "America/Sao_Paulo"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        meta = data.get("meta")
        assert meta is not None
        # (a) fields present
        for k in ["signed_at", "signed_by", "signed_by_name", "timezone",
                  "ip", "session_id", "appointment_id", "patient_id", "sha256"]:
            assert k in meta, f"missing meta.{k}"
        # (b) signed_at ISO
        try:
            datetime.fromisoformat(meta["signed_at"].replace("Z", "+00:00"))
        except Exception:
            pytest.fail(f"signed_at not ISO: {meta['signed_at']}")
        # (c) signed_by = bella
        assert meta["signed_by"] == bella_user["user_id"]
        # (d) timezone preserved
        assert meta["timezone"] == "America/Sao_Paulo"
        # (e) sha256 = 64 hex chars
        assert re.match(r"^[a-f0-9]{64}$", meta["sha256"]), meta["sha256"]
        expected_hash = hashlib.sha256(VALID_SIG.encode("utf-8")).hexdigest()
        assert meta["sha256"] == expected_hash
        # (f) ip str or None
        assert meta["ip"] is None or isinstance(meta["ip"], str)
        # ids echoed
        assert meta["session_id"] == sid
        assert meta["appointment_id"] == apt["appointment_id"]
        assert meta["patient_id"] == test_patient["patient_id"]

    def test_sign_evolution_ok(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "evolution", "signature": VALID_SIG,
                                "timezone": "UTC"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        meta = r.json()["meta"]
        assert meta["timezone"] == "UTC"
        assert re.match(r"^[a-f0-9]{64}$", meta["sha256"])


class TestC4C5SignErrors:
    def test_sign_invalid_type(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "invalid", "signature": VALID_SIG},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_sign_short_signature(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "consent", "signature": "short"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 400

    def test_sign_empty_signature(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "consent", "signature": ""},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 400

    def test_sign_nonexistent_session(self, bella_token):
        r = requests.post(f"{BASE_URL}/api/attendance/does_not_exist/sign",
                          json={"type": "consent", "signature": VALID_SIG},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 404, r.text

    def test_sign_rbac_recepcao_forbidden(self, ana_token, bella_token, bella_user, test_patient):
        # bella creates session
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        # ana tries to sign
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "consent", "signature": VALID_SIG},
                          headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


class TestC4C5Persistence:
    def test_sign_persists_in_session(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        # sign both
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "consent", "signature": VALID_SIG,
                                "timezone": "America/Sao_Paulo"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                          json={"type": "evolution", "signature": VALID_SIG + "B",
                                "timezone": "UTC"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

        # GET session via by-appointment
        g = requests.get(f"{BASE_URL}/api/attendance/by-appointment/{apt['appointment_id']}",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200, g.text
        sess = g.json()
        assert sess.get("consent_signature") == VALID_SIG
        assert sess.get("evolution_signature") == VALID_SIG + "B"
        cmeta = sess.get("consent_signature_meta")
        emeta = sess.get("evolution_signature_meta")
        assert isinstance(cmeta, dict), "consent_signature_meta missing"
        assert isinstance(emeta, dict), "evolution_signature_meta missing"
        assert cmeta["timezone"] == "America/Sao_Paulo"
        assert emeta["timezone"] == "UTC"
        for m in [cmeta, emeta]:
            for k in ["signed_at", "signed_by", "sha256", "session_id",
                      "appointment_id", "patient_id"]:
                assert k in m


class TestC4C5CopyOnFinalize:
    def test_signatures_copied_to_medical_record(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])

        # sign both
        requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                      json={"type": "consent", "signature": VALID_SIG,
                            "timezone": "America/Sao_Paulo"},
                      headers=H(bella_token), timeout=TIMEOUT)
        requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                      json={"type": "evolution", "signature": VALID_SIG + "C",
                            "timezone": "America/Sao_Paulo"},
                      headers=H(bella_token), timeout=TIMEOUT)

        # finalize
        f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                         json={"payment_status": "pago", "amount_total": 200,
                               "payment_method": "pix"},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert f.status_code == 200, f.text
        record_id = f.json()["record_id"]

        # find medical_record
        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={test_patient['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        assert mr.status_code == 200
        rec = next((x for x in mr.json() if x.get("record_id") == record_id), None)
        assert rec is not None, f"record {record_id} not found"
        # (a) consent_signature preserved
        assert rec.get("consent_signature") == VALID_SIG
        # (b) consent_signature_meta dict
        assert isinstance(rec.get("consent_signature_meta"), dict)
        assert rec["consent_signature_meta"].get("timezone") == "America/Sao_Paulo"
        # (c) evolution_signature_meta dict
        assert isinstance(rec.get("evolution_signature_meta"), dict)

    def test_old_records_without_meta_still_listable(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/medical-records",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ==================== C3+ — session_id in financial_entries ====================
class TestC3PlusFinancialSessionId:
    def test_finance_entry_has_session_id_and_number(self, admin_token, bella_token,
                                                     bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                         json={"payment_status": "pago", "amount_total": 200,
                               "payment_method": "pix"},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert f.status_code == 200, f.text
        session_number = f.json()["session_number"]

        # admin fetch entries filtered by patient
        fe = requests.get(
            f"{BASE_URL}/api/finance/entries?patient_id={test_patient['patient_id']}",
            headers=H(admin_token), timeout=TIMEOUT)
        assert fe.status_code == 200
        entries_this = [e for e in fe.json() if e.get("session_id") == sid]
        assert len(entries_this) >= 1, "no financial entry with session_id"
        year = datetime.now(timezone.utc).year
        for e in entries_this:
            assert e.get("session_id") == sid
            assert e.get("session_number") == session_number
            assert re.match(rf"^ATT-{year}-\d{{6}}$", e["session_number"])

    def test_installments_share_same_session_id_and_number(self, admin_token, bella_token,
                                                           bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                         json={"payment_status": "nao_pago", "amount_total": 900,
                               "installments": 3,
                               "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert f.status_code == 200, f.text
        session_number = f.json()["session_number"]

        fe = requests.get(
            f"{BASE_URL}/api/finance/entries?patient_id={test_patient['patient_id']}",
            headers=H(admin_token), timeout=TIMEOUT)
        assert fe.status_code == 200
        inst = [e for e in fe.json() if e.get("session_id") == sid]
        assert len(inst) == 3, f"expected 3 installments, got {len(inst)}"
        # all same session_id + session_number
        assert all(e.get("session_id") == sid for e in inst)
        assert all(e.get("session_number") == session_number for e in inst)
        # same group_id
        groups = {e.get("group_id") for e in inst}
        assert len(groups) == 1, f"installments should share group_id: {groups}"

    def test_legacy_entries_without_session_id_still_listed(self, admin_token, test_patient):
        # entries without session_id must coexist and be returned
        fe = requests.get(f"{BASE_URL}/api/finance/entries",
                          headers=H(admin_token), timeout=TIMEOUT)
        assert fe.status_code == 200
        assert isinstance(fe.json(), list)


# ==================== C7 — Autosave identity fields ====================
class TestC7AutosaveIdentity:
    def test_put_ignores_appointment_id_and_patient_id_changes(self, bella_token,
                                                               bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])

        # Try to inject different appointment_id/patient_id
        payload = {
            "appointment_id": "other_appt_should_be_ignored",
            "patient_id": "other_pid_should_be_ignored",
            "evolution": "texto novo",
            "status": "rascunho",
            "duration_seconds": 60,
        }
        r = requests.put(f"{BASE_URL}/api/attendance/{sid}", json=payload,
                        headers=H(bella_token), timeout=TIMEOUT)
        # patient_id is required in schema but popped — should still succeed
        assert r.status_code == 200, r.text
        data = r.json()
        # session identity unchanged
        assert data.get("appointment_id") == apt["appointment_id"]
        assert data.get("patient_id") == test_patient["patient_id"]
        assert data.get("evolution") == "texto novo"

    def test_put_missing_patient_id_returns_422(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.put(f"{BASE_URL}/api/attendance/{sid}",
                        json={"evolution": "sem patient_id"},
                        headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text}"

    def test_put_partial_payload_updates(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.put(f"{BASE_URL}/api/attendance/{sid}",
                        json={"patient_id": test_patient["patient_id"],
                              "evolution": "primeira",
                              "status": "rascunho",
                              "duration_seconds": 60},
                        headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_put_sequential_updates_last_wins(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        for i, val in enumerate(["a", "b", "final"]):
            r = requests.put(f"{BASE_URL}/api/attendance/{sid}",
                            json={"patient_id": test_patient["patient_id"],
                                  "evolution": val,
                                  "status": "rascunho"},
                            headers=H(bella_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        # last should be persisted
        g = requests.get(f"{BASE_URL}/api/attendance/by-appointment/{apt['appointment_id']}",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        assert g.json().get("evolution") == "final"


# ==================== Regression — Idempotence + Status ====================
class TestRegressionIdempotence:
    def test_finalize_idempotent(self, admin_token, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        appt_id = apt["appointment_id"]
        sid = _start_session(bella_token, appt_id)
        payload = {"payment_status": "pago", "amount_total": 300, "payment_method": "pix"}
        f1 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                          json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f1.status_code == 200
        r1 = f1.json()
        f2 = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                          json=payload, headers=H(bella_token), timeout=TIMEOUT)
        assert f2.status_code == 200
        r2 = f2.json()
        assert r1["record_id"] == r2["record_id"]
        assert r1["session_number"] == r2["session_number"]
        assert r1["financial_entries"] == r2["financial_entries"]

        fe = requests.get(f"{BASE_URL}/api/finance/entries",
                          headers=H(admin_token), timeout=TIMEOUT)
        entries = [e for e in fe.json() if e.get("appointment_id") == appt_id]
        assert len(entries) == 1


class TestRegressionStatus:
    def test_start_finalize_status(self, bella_token, bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        appt_id = apt["appointment_id"]
        sid = _start_session(bella_token, appt_id)
        # em_atendimento
        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(bella_token), timeout=TIMEOUT)
        found = next(a for a in r.json() if a.get("appointment_id") == appt_id)
        assert found["status"] == "em_atendimento"
        assert found.get("attendance_started_at")
        assert found.get("attendance_started_by") == bella_user["user_id"]
        # finalize
        f = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                         json={"payment_status": "pago", "amount_total": 100},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert f.status_code == 200
        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(bella_token), timeout=TIMEOUT)
        found = next(a for a in r.json() if a.get("appointment_id") == appt_id)
        assert found["status"] == "concluido"
        assert found.get("finished_at")
        assert isinstance(found.get("duration_minutes"), int)


# ==================== Regression — General ====================
class TestRegressionGeneral:
    def test_dashboard_stats(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_appointments_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/appointments",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_patients_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/patients",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_summary(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/finance/summary",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_entries_filter_patient(self, admin_token, test_patient):
        r = requests.get(
            f"{BASE_URL}/api/finance/entries?patient_id={test_patient['patient_id']}",
            headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_finance_patient_summary(self, admin_token, test_patient):
        r = requests.get(
            f"{BASE_URL}/api/finance/patient/{test_patient['patient_id']}/summary",
            headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        for k in ["total_pago", "total_pendente", "total_vencido"]:
            assert k in data

    def test_finance_entry_paid_receipt(self, admin_token, test_patient):
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": "TEST_25E_paid_receipt",
            "amount": 50.0,
            "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "paid": True,
            "patient_id": test_patient["patient_id"],
            "payment_method": "pix",
        }
        r = requests.post(f"{BASE_URL}/api/finance/entries", json=payload,
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        # REC-YYYY-#### atomically
        rn = data.get("receipt_number") or data.get("recibo_number")
        year = datetime.now(timezone.utc).year
        if rn:
            assert re.match(rf"^REC-{year}-\d+$", rn), rn

    def test_budgets_post(self, admin_token, test_patient):
        payload = {
            "patient_id": test_patient["patient_id"],
            "patient_name": test_patient.get("name"),
            "items": [{"name": "TEST_i", "description": "d", "qty": 1,
                       "unit_price": 100, "total": 100}],
            "total": 100,
            "status": "rascunho",
        }
        r = requests.post(f"{BASE_URL}/api/budgets", json=payload,
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201)

    def test_ai_generate(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"prompt": "Diga OK", "type": "generic"},
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 400, 422)


class TestRegressionRBAC:
    def test_bella_forbidden_finance(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/finance/entries",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_ana_get_finance_ok(self, ana_token):
        r = requests.get(f"{BASE_URL}/api/finance/entries",
                         headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_ana_post_finance_forbidden(self, ana_token, test_patient):
        payload = {"type": "receita", "category": "X",
                   "description": "TEST_rbac_ana_25e", "amount": 5,
                   "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                   "paid": False, "patient_id": test_patient["patient_id"]}
        r = requests.post(f"{BASE_URL}/api/finance/entries", json=payload,
                          headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_ana_attendance_endpoints_forbidden(self, ana_token, bella_token,
                                                bella_user, test_patient):
        apt = _make_appt(bella_token, test_patient, bella_user)
        # /start
        r = requests.post(f"{BASE_URL}/api/attendance/start",
                          json={"appointment_id": apt["appointment_id"]},
                          headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403
        # bella starts, ana tries PUT + finalize + sign
        sid = _start_session(bella_token, apt["appointment_id"])
        r = requests.put(f"{BASE_URL}/api/attendance/{sid}",
                        json={"patient_id": test_patient["patient_id"], "evolution": "x"},
                        headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                         json={"payment_status": "pago", "amount_total": 100},
                         headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403
        r = requests.post(f"{BASE_URL}/api/attendance/{sid}/sign",
                         json={"type": "consent", "signature": VALID_SIG},
                         headers=H(ana_token), timeout=TIMEOUT)
        assert r.status_code == 403
