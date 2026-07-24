"""Phase 2.5C — Patient Finance Tab + Receipt PDF (sequential REC-YYYY-####) + Email + WhatsApp.

Covers:
- Auto-generation on POST (paid=true, type=receita)
- Auto-generation on PUT paid=false→true transition (idempotent on paid=true→false)
- Sequential + unique REC numbers (atomicity)
- No receipt for despesa or paid=false
- Idempotency of POST /receipt (with/without force)
- GET /receipt (auto-generate if eligible; 404 if missing)
- POST /receipt/email (patient email default, custom override, 400 missing email, 400 not paid, updates fields)
- GET /receipt/whatsapp-link (wa.me format, BR phone prefix, no-phone fallback, message content)
- RBAC (admin/financeiro full, recepcao read-only, profissional/marketing 403)
- GET /finance/patient/{pid}/summary (totals + entries + overdue calc)
- Auto-receipt on finalize_attendance (pago and parcial entrada only)
- Regressions: /finance/summary shape, /dashboard/stats.revenue_month, /finance/entries filters
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://beauty-ops-platform.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin":    ("admin@proclinic.com", "admin123"),
    "profissional": ("dra.bella@proclinic.com", "bella123"),
    "recepcao": ("ana.recep@proclinic.com", "ana123"),
    "super":    ("superadmin@proclinic.com", "super123"),
}

# ------------------------ fixtures ------------------------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=45)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")

def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def admin_token():
    return _login(*CREDS["admin"])

@pytest.fixture(scope="module")
def prof_token():
    return _login(*CREDS["profissional"])

@pytest.fixture(scope="module")
def recep_token():
    return _login(*CREDS["recepcao"])

@pytest.fixture(scope="module")
def super_token():
    return _login(*CREDS["super"])

@pytest.fixture(scope="module")
def sample_patient(admin_token):
    """Get any existing patient in admin clinic (Sofia Galinari expected)."""
    r = requests.get(f"{API}/patients", headers=_hdr(admin_token), timeout=45)
    assert r.status_code == 200
    patients = r.json()
    assert len(patients) > 0, "need at least one patient in seed"
    # Prefer one with an email + phone
    with_both = [p for p in patients if p.get("email") and p.get("phone")]
    return (with_both[0] if with_both else patients[0])

# ------------------------ 1. Auto-gen on POST ------------------------

class TestAutoReceiptOnCreate:
    def test_paid_receita_auto_generates_receipt(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_auto_post_paid",
            "amount": 300, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("receipt_number"), f"no receipt_number in response: {data}"
        assert re.match(r"^REC-\d{4}-\d{4}$", data["receipt_number"]), f"bad format: {data['receipt_number']}"
        assert data.get("receipt_url", "").startswith("/api/files/"), f"bad url: {data.get('receipt_url')}"
        # Save for next test
        TestAutoReceiptOnCreate.entry_id = data["entry_id"]
        TestAutoReceiptOnCreate.receipt_url = data["receipt_url"]

    def test_pdf_download_returns_pdf_bytes(self, admin_token):
        assert hasattr(self, "entry_id"), "prev test failed"
        url = f"{BASE_URL}{self.receipt_url}"
        r = requests.get(url, timeout=45)  # sig is embedded in URL; no auth needed
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert r.content[:4] == b"%PDF", f"not a PDF: {r.content[:10]!r}"

    def test_despesa_paid_no_receipt(self, admin_token):
        body = {
            "type": "despesa", "category": "Insumos",
            "description": "TEST_despesa_no_receipt",
            "amount": 50, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        assert r.status_code == 200
        assert not r.json().get("receipt_number"), "despesa should not have receipt"

    def test_paid_false_no_receipt(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_pending_no_receipt",
            "amount": 100, "due_date": "2026-02-20",
            "paid": False,
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        assert r.status_code == 200
        data = r.json()
        assert not data.get("receipt_number"), "pending should not have receipt"
        TestAutoReceiptOnCreate.pending_id = data["entry_id"]

# ------------------------ 2. Auto-gen on PUT transition ------------------------

class TestAutoReceiptOnUpdate:
    def test_put_paid_true_generates_receipt(self, admin_token):
        eid = TestAutoReceiptOnCreate.pending_id
        r = requests.put(f"{API}/finance/entries/{eid}", headers=_hdr(admin_token),
                         json={"paid": True}, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("receipt_number"), "receipt_number missing after PUT paid=true"
        assert re.match(r"^REC-\d{4}-\d{4}$", data["receipt_number"])
        assert data.get("receipt_url", "").startswith("/api/files/")
        TestAutoReceiptOnUpdate.receipt_number_after = data["receipt_number"]
        TestAutoReceiptOnUpdate.eid = eid

    def test_put_paid_false_keeps_receipt(self, admin_token):
        eid = TestAutoReceiptOnUpdate.eid
        r = requests.put(f"{API}/finance/entries/{eid}", headers=_hdr(admin_token),
                         json={"paid": False}, timeout=45)
        assert r.status_code == 200
        # Even flipped back, receipt_number should still be present (persisted)
        assert r.json().get("receipt_number") == TestAutoReceiptOnUpdate.receipt_number_after

    def test_put_paid_true_again_does_not_regenerate(self, admin_token):
        eid = TestAutoReceiptOnUpdate.eid
        r = requests.put(f"{API}/finance/entries/{eid}", headers=_hdr(admin_token),
                         json={"paid": True}, timeout=45)
        assert r.status_code == 200
        # Same receipt_number — no duplicate
        assert r.json().get("receipt_number") == TestAutoReceiptOnUpdate.receipt_number_after

# ------------------------ 3. Sequence + atomicity ------------------------

class TestReceiptSequence:
    def test_three_paid_entries_sequential_unique(self, admin_token, sample_patient):
        nums = []
        for i in range(3):
            body = {
                "type": "receita", "category": "Consulta",
                "description": f"TEST_seq_{i}",
                "amount": 10 + i, "due_date": "2026-02-20",
                "paid": True, "payment_method": "pix",
                "patient_id": sample_patient["patient_id"],
            }
            r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
            assert r.status_code == 200
            n = r.json().get("receipt_number")
            assert n and re.match(r"^REC-\d{4}-\d{4}$", n), f"bad: {n}"
            nums.append(int(n.split("-")[-1]))
        # All unique
        assert len(set(nums)) == 3
        # Strictly increasing (may not be contiguous if others ran in parallel, but always +ve delta)
        assert nums == sorted(nums), f"not sequential: {nums}"

# ------------------------ 4. Idempotency of POST /receipt ------------------------

class TestPostReceiptEndpoint:
    def test_post_receipt_idempotent(self, admin_token, sample_patient):
        # create paid receita
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_idem",
            "amount": 100, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        assert r.status_code == 200
        eid = r.json()["entry_id"]
        orig_num = r.json()["receipt_number"]

        # POST without force → same number
        r2 = requests.post(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(admin_token), timeout=45)
        assert r2.status_code == 200
        assert r2.json()["receipt_number"] == orig_num, "should be idempotent without force"

        # POST with force=true → new number
        r3 = requests.post(f"{API}/finance/entries/{eid}/receipt?force=true", headers=_hdr(admin_token), timeout=45)
        assert r3.status_code == 200
        new_num = r3.json()["receipt_number"]
        assert new_num != orig_num, f"force should regenerate; got same: {new_num}"
        assert re.match(r"^REC-\d{4}-\d{4}$", new_num)

    def test_post_receipt_on_pending_returns_400(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_pending_400",
            "amount": 50, "due_date": "2026-02-20",
            "paid": False,
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        r2 = requests.post(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(admin_token), timeout=45)
        assert r2.status_code == 400, f"expected 400, got {r2.status_code}: {r2.text}"

# ------------------------ 5. GET /receipt ------------------------

class TestGetReceiptEndpoint:
    def test_get_receipt_of_paid_returns_number_url(self, admin_token):
        eid = TestAutoReceiptOnCreate.entry_id
        r = requests.get(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(admin_token), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("receipt_number")
        assert data.get("receipt_url", "").startswith("/api/files/")

    def test_get_receipt_404_when_entry_missing(self, admin_token):
        r = requests.get(f"{API}/finance/entries/fin_nonexistent999/receipt", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 404

# ------------------------ 6. Email endpoint ------------------------

class TestEmailEndpoint:
    def test_email_uses_patient_email_when_no_body(self, admin_token, sample_patient):
        # create paid receita for a patient with email
        if not sample_patient.get("email"):
            pytest.skip("sample patient has no email")
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_email_default",
            "amount": 42, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        r2 = requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(admin_token), json={}, timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("ok") is True
        assert data.get("to") == sample_patient["email"]
        assert "email_id" in data
        # Verify field persisted
        r3 = requests.get(f"{API}/finance/entries", headers=_hdr(admin_token), params={"patient_id": sample_patient["patient_id"]}, timeout=45)
        entry = next((e for e in r3.json() if e["entry_id"] == eid), None)
        assert entry is not None
        assert entry.get("receipt_sent_email_at")
        assert entry.get("receipt_sent_email_to") == sample_patient["email"]

    def test_email_uses_custom_email(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_email_custom",
            "amount": 43, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
            "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        custom = "wgalinari2@gmail.com"
        r2 = requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(admin_token),
                           json={"email": custom}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["to"] == custom

    def test_email_400_when_no_email(self, admin_token):
        # find/create a patient with no email
        body_p = {"name": "TEST_no_email_patient"}
        r = requests.post(f"{API}/patients", headers=_hdr(admin_token), json=body_p, timeout=45)
        if r.status_code not in (200, 201):
            pytest.skip(f"patient create failed: {r.status_code}")
        pid = r.json().get("patient_id")
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_email_no_addr",
            "amount": 10, "due_date": "2026-02-20",
            "paid": True, "patient_id": pid,
        }
        r2 = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r2.json()["entry_id"]
        r3 = requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(admin_token), json={}, timeout=45)
        assert r3.status_code == 400, f"expected 400, got {r3.status_code}: {r3.text}"

    def test_email_400_when_not_paid(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_email_pending",
            "amount": 10, "due_date": "2026-02-20",
            "paid": False, "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        r2 = requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(admin_token), json={"email": "x@y.com"}, timeout=45)
        assert r2.status_code == 400

# ------------------------ 7. WhatsApp endpoint ------------------------

class TestWhatsappEndpoint:
    def test_whatsapp_link_with_br_phone(self, admin_token):
        # create patient with brazilian phone (no +55)
        body_p = {"name": "TEST_wa_patient", "phone": "33991084691"}
        r = requests.post(f"{API}/patients", headers=_hdr(admin_token), json=body_p, timeout=45)
        pid = r.json().get("patient_id")
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_wa_default",
            "amount": 250, "due_date": "2026-02-20",
            "paid": True, "payment_method": "pix",
            "patient_id": pid,
        }
        r2 = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r2.json()["entry_id"]
        r3 = requests.get(f"{API}/finance/entries/{eid}/receipt/whatsapp-link", headers=_hdr(admin_token), timeout=45)
        assert r3.status_code == 200, r3.text
        data = r3.json()
        assert data["whatsapp_url"].startswith("https://wa.me/"), data
        assert data["phone"] and data["phone"].startswith("55"), f"br prefix missing: {data['phone']}"
        assert data.get("receipt_number")
        assert "text=" in data["whatsapp_url"]

    def test_whatsapp_link_no_phone_fallback(self, admin_token):
        body_p = {"name": "TEST_wa_nophone"}
        r = requests.post(f"{API}/patients", headers=_hdr(admin_token), json=body_p, timeout=45)
        pid = r.json().get("patient_id")
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_wa_nophone",
            "amount": 100, "due_date": "2026-02-20",
            "paid": True, "patient_id": pid,
        }
        r2 = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r2.json()["entry_id"]
        r3 = requests.get(f"{API}/finance/entries/{eid}/receipt/whatsapp-link", headers=_hdr(admin_token), timeout=45)
        assert r3.status_code == 200
        d = r3.json()
        # Without phone, still returns wa.me with text
        assert d["whatsapp_url"].startswith("https://wa.me/?text=") or d["whatsapp_url"].startswith("https://wa.me/"), d
        assert "text=" in d["whatsapp_url"]

    def test_whatsapp_message_content(self, admin_token, sample_patient):
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_wa_msg_ctx",
            "amount": 199.9, "due_date": "2026-02-20",
            "paid": True, "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        r2 = requests.get(f"{API}/finance/entries/{eid}/receipt/whatsapp-link", headers=_hdr(admin_token), timeout=45)
        assert r2.status_code == 200
        # URL-decode text to inspect message
        import urllib.parse
        url = r2.json()["whatsapp_url"]
        text = urllib.parse.unquote(url.split("text=", 1)[1])
        # Message should include patient name (partial), receipt number, R$, and PDF link
        assert "REC-" in text
        assert "R$" in text
        assert "199,90" in text or "199.90" in text or "199,9" in text
        assert "/api/files/" in text  # PDF link embedded

# ------------------------ 8. RBAC on new endpoints ------------------------

class TestRBAC:
    @pytest.fixture(autouse=True)
    def _setup(self, admin_token, sample_patient):
        # Create a paid entry to test against
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_rbac_entry",
            "amount": 100, "due_date": "2026-02-20",
            "paid": True, "patient_id": sample_patient["patient_id"],
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        assert r.status_code == 200
        self.eid = r.json()["entry_id"]
        self.pid = sample_patient["patient_id"]

    def test_profissional_forbidden_all_receipts(self, prof_token):
        eid = self.eid
        for r_call in [
            requests.get(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(prof_token), timeout=10),
            requests.post(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(prof_token), timeout=10),
            requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(prof_token), json={}, timeout=10),
            requests.get(f"{API}/finance/entries/{eid}/receipt/whatsapp-link", headers=_hdr(prof_token), timeout=10),
            requests.get(f"{API}/finance/patient/{self.pid}/summary", headers=_hdr(prof_token), timeout=10),
        ]:
            assert r_call.status_code == 403, f"expected 403 got {r_call.status_code}: {r_call.text[:200]}"

    def test_recepcao_read_only(self, recep_token):
        eid = self.eid
        # reads OK
        r_get = requests.get(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(recep_token), timeout=10)
        assert r_get.status_code == 200, r_get.text
        r_wa = requests.get(f"{API}/finance/entries/{eid}/receipt/whatsapp-link", headers=_hdr(recep_token), timeout=10)
        assert r_wa.status_code == 200
        r_sum = requests.get(f"{API}/finance/patient/{self.pid}/summary", headers=_hdr(recep_token), timeout=10)
        assert r_sum.status_code == 200
        # writes 403
        r_post = requests.post(f"{API}/finance/entries/{eid}/receipt", headers=_hdr(recep_token), timeout=10)
        assert r_post.status_code == 403
        r_email = requests.post(f"{API}/finance/entries/{eid}/receipt/email", headers=_hdr(recep_token), json={}, timeout=10)
        assert r_email.status_code == 403

# ------------------------ 9. Patient summary ------------------------

class TestPatientSummary:
    def test_summary_shape_and_totals(self, admin_token, sample_patient):
        r = requests.get(f"{API}/finance/patient/{sample_patient['patient_id']}/summary",
                         headers=_hdr(admin_token), timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["total_pago", "total_pendente", "total_vencido", "proximo_vencimento",
                  "count_total", "count_pendente", "entries"]:
            assert k in d, f"missing key {k}"
        assert isinstance(d["entries"], list)
        # count consistency
        assert d["count_total"] == len(d["entries"])
        pending = [e for e in d["entries"] if not e.get("paid")]
        assert d["count_pendente"] == len(pending)
        # entries sorted by due_date desc
        dates = [e.get("due_date") or "" for e in d["entries"]]
        assert dates == sorted(dates, reverse=True), "entries should be desc by due_date"

# ------------------------ 10. Finalize attendance auto-receipt ------------------------

class TestFinalizeAttendance:
    def test_pago_creates_entry_with_receipt(self, admin_token, sample_patient):
        # login as dra.bella (profissional) — problem statement asks; but she can create appt/session
        prof = _login(*CREDS["profissional"])
        # get her professional_id
        me = requests.get(f"{API}/auth/me", headers=_hdr(prof), timeout=10).json()
        prof_id = me.get("user_id")
        # create appointment
        appt_body = {
            "patient_id": sample_patient["patient_id"],
            "professional_id": prof_id,
            "start": "2026-02-22T10:00:00",
            "end":   "2026-02-22T11:00:00",
            "status": "confirmado",
            "notes": "TEST_finalize_pago",
        }
        r_a = requests.post(f"{API}/appointments", headers=_hdr(prof), json=appt_body, timeout=45)
        if r_a.status_code not in (200, 201):
            pytest.skip(f"appointment create failed: {r_a.status_code} {r_a.text[:200]}")
        appt = r_a.json()
        # attendance session
        r_s = requests.post(f"{API}/attendance/start", headers=_hdr(prof),
                            json={"appointment_id": appt["appointment_id"]}, timeout=45)
        if r_s.status_code not in (200, 201):
            pytest.skip(f"attendance start failed: {r_s.status_code} {r_s.text[:200]}")
        sid = r_s.json().get("session_id") or r_s.json().get("attendance_id")
        # finalize as pago
        r_f = requests.post(f"{API}/attendance/{sid}/finalize", headers=_hdr(prof),
                            json={"payment_status": "pago", "amount_total": 400,
                                  "description": "TEST_finalize_pago"}, timeout=45)
        assert r_f.status_code == 200, r_f.text
        entries = r_f.json().get("financial_entries", [])
        assert len(entries) == 1
        # verify the created entry has receipt_number
        eid = entries[0]
        r_e = requests.get(f"{API}/finance/entries", headers=_hdr(admin_token),
                           params={"patient_id": sample_patient["patient_id"]}, timeout=45)
        entry = next((e for e in r_e.json() if e["entry_id"] == eid), None)
        assert entry is not None, "created entry not found"
        assert entry.get("receipt_number"), "receipt_number missing on finalize pago"

    def test_parcial_only_entrada_gets_receipt(self, admin_token, sample_patient):
        prof = _login(*CREDS["profissional"])
        me = requests.get(f"{API}/auth/me", headers=_hdr(prof), timeout=10).json()
        prof_id = me.get("user_id")
        appt_body = {
            "patient_id": sample_patient["patient_id"],
            "professional_id": prof_id,
            "start": "2026-02-23T10:00:00",
            "end":   "2026-02-23T11:00:00",
            "status": "confirmado",
            "notes": "TEST_finalize_parcial",
        }
        r_a = requests.post(f"{API}/appointments", headers=_hdr(prof), json=appt_body, timeout=45)
        if r_a.status_code not in (200, 201):
            pytest.skip(f"appointment create failed: {r_a.status_code}")
        r_s = requests.post(f"{API}/attendance/start", headers=_hdr(prof),
                            json={"appointment_id": r_a.json()["appointment_id"]}, timeout=45)
        if r_s.status_code not in (200, 201):
            pytest.skip(f"session start failed: {r_s.status_code}")
        sid = r_s.json().get("session_id") or r_s.json().get("attendance_id")
        r_f = requests.post(f"{API}/attendance/{sid}/finalize", headers=_hdr(prof),
                            json={"payment_status": "parcial", "amount_total": 400,
                                  "amount_paid": 100, "installments": 3,
                                  "description": "TEST_finalize_parcial"}, timeout=45)
        assert r_f.status_code == 200, r_f.text
        entries_ids = r_f.json().get("financial_entries", [])
        assert len(entries_ids) == 4, f"expected entrada + 3 parcelas, got {len(entries_ids)}"
        r_e = requests.get(f"{API}/finance/entries", headers=_hdr(admin_token),
                           params={"patient_id": sample_patient["patient_id"]}, timeout=45)
        entries = [e for e in r_e.json() if e["entry_id"] in entries_ids]
        with_receipt = [e for e in entries if e.get("receipt_number")]
        without_receipt = [e for e in entries if not e.get("receipt_number")]
        assert len(with_receipt) == 1, f"only entrada should have receipt; got {len(with_receipt)}"
        assert len(without_receipt) == 3, f"3 parcels should have no receipt; got {len(without_receipt)}"
        # entrada is the one with paid=True
        assert with_receipt[0].get("paid") is True
        for pend in without_receipt:
            assert pend.get("paid") is False

# ------------------------ 11. Regressions ------------------------

class TestRegression:
    def test_finance_summary_shape(self, admin_token):
        r = requests.get(f"{API}/finance/summary", headers=_hdr(admin_token), timeout=45)
        assert r.status_code == 200
        d = r.json()
        for k in ["receitas", "despesas", "saldo", "a_receber", "a_pagar", "chart"]:
            assert k in d
        assert isinstance(d["chart"], list)

    def test_dashboard_revenue_month(self, admin_token):
        r = requests.get(f"{API}/dashboard/stats", headers=_hdr(admin_token), timeout=45)
        assert r.status_code == 200
        assert "revenue_month" in r.json()

    def test_finance_entries_filters_still_work(self, admin_token, sample_patient):
        r = requests.get(f"{API}/finance/entries", headers=_hdr(admin_token),
                         params={"patient_id": sample_patient["patient_id"], "type": "receita"},
                         timeout=45)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_non_destructive_put_preserves_context(self, admin_token, sample_patient):
        # create with rich context
        body = {
            "type": "receita", "category": "Consulta",
            "description": "TEST_nondestructive",
            "amount": 100, "due_date": "2026-02-20",
            "paid": False,
            "patient_id": sample_patient["patient_id"],
            "notes": "context notes",
            "cost_center": "unidade-1",
        }
        r = requests.post(f"{API}/finance/entries", headers=_hdr(admin_token), json=body, timeout=45)
        eid = r.json()["entry_id"]
        # PATCH-style PUT only paid
        r2 = requests.put(f"{API}/finance/entries/{eid}", headers=_hdr(admin_token), json={"paid": True}, timeout=45)
        assert r2.status_code == 200
        e = r2.json()
        assert e["patient_id"] == sample_patient["patient_id"]
        assert e["notes"] == "context notes"
        assert e["cost_center"] == "unidade-1"
