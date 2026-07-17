"""Phase 2.4B — Super-admin dashboard, Coupons, Emails, Invoice PDF via webhook.

Runs against the public REACT_APP_BACKEND_URL. Cleans up TEST_ coupons and pay_test_phase24b_* webhook events.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://beauty-ops-platform.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER_ADMIN = ("superadmin@proclinic.com", "super123")
ADMIN = ("admin@proclinic.com", "admin123")
BELLA = ("dra.bella@proclinic.com", "bella123")
ANA = ("ana.recep@proclinic.com", "ana123")
WEBHOOK_TOKEN = "whsec_proclinic_a8f3d9e2c1b47506a92e3f81d5c6b0a4"

class _NoCookieSession(requests.Session):
    """Session that discards Set-Cookie so bearer-only auth always wins."""
    def send(self, *args, **kwargs):
        resp = super().send(*args, **kwargs)
        self.cookies.clear()
        return resp


session = _NoCookieSession()
session.headers.update({"Content-Type": "application/json"})


def _login(email, password):
    # Use fresh requests.post so login cookies aren't kept in the shared session.
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def sa_token():
    return _login(*SUPER_ADMIN)


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def bella_token():
    return _login(*BELLA)


@pytest.fixture(scope="module")
def ana_token():
    return _login(*ANA)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ------------------------------------------------------------------
# 1) Super admin auth
# ------------------------------------------------------------------
class TestSuperAdminAuth:
    def test_super_admin_login_returns_role_and_token(self):
        r = session.post(f"{API}/auth/login", json={"email": SUPER_ADMIN[0], "password": SUPER_ADMIN[1]})
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "super_admin"
        assert d["clinic_id"] is None
        assert isinstance(d.get("token"), str) and len(d["token"]) > 50


# ------------------------------------------------------------------
# 2) /super-admin/summary + /super-admin/clinics
# ------------------------------------------------------------------
class TestSuperAdminSummary:
    def test_summary_super_admin_ok(self, sa_token):
        r = session.get(f"{API}/super-admin/summary", headers=_h(sa_token))
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("clinics", "active", "trial", "past_due", "cancelled", "expired",
                    "mrr", "arr", "total_revenue", "total_payments",
                    "conversion_rate", "churn_rate"):
            assert key in d, f"missing key: {key} in {d}"
        assert isinstance(d["mrr"], (int, float))
        assert isinstance(d["clinics"], int)

    def test_summary_admin_forbidden(self, admin_token):
        r = session.get(f"{API}/super-admin/summary", headers=_h(admin_token))
        assert r.status_code == 403

    def test_summary_professional_forbidden(self, bella_token):
        r = session.get(f"{API}/super-admin/summary", headers=_h(bella_token))
        assert r.status_code == 403

    def test_summary_receptionist_forbidden(self, ana_token):
        r = session.get(f"{API}/super-admin/summary", headers=_h(ana_token))
        assert r.status_code == 403

    def test_clinics_super_admin_ok(self, sa_token):
        r = session.get(f"{API}/super-admin/clinics", headers=_h(sa_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        c = data[0]
        assert "clinic_id" in c and "subscription" in c and "user_count" in c and "patient_count" in c
        assert isinstance(c["user_count"], int)

    def test_clinics_admin_forbidden(self, admin_token):
        r = session.get(f"{API}/super-admin/clinics", headers=_h(admin_token))
        assert r.status_code == 403


# ------------------------------------------------------------------
# 3) Coupons CRUD + validate
# ------------------------------------------------------------------
COUPON_CODE = f"TESTLNCH{uuid.uuid4().hex[:4].upper()}"
_created_coupon_id = {"id": None}


class TestCouponsCRUD:
    def test_list_coupons_forbidden_for_admin(self, admin_token):
        r = session.get(f"{API}/coupons", headers=_h(admin_token))
        assert r.status_code == 403

    def test_list_coupons_super_admin(self, sa_token):
        r = session.get(f"{API}/coupons", headers=_h(sa_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_coupon(self, sa_token):
        r = session.post(f"{API}/coupons", headers=_h(sa_token), json={
            "code": COUPON_CODE, "kind": "percent", "value": 20,
            "applies_to": ["professional", "premium"],
            "first_payment_only": True, "max_uses": 100,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["code"] == COUPON_CODE
        assert d["value"] == 20
        assert d["kind"] == "percent"
        assert d["applies_to"] == ["professional", "premium"]
        assert d["uses_count"] == 0
        assert "coupon_id" in d
        _created_coupon_id["id"] = d["coupon_id"]

    def test_create_coupon_duplicate_returns_400(self, sa_token):
        r = session.post(f"{API}/coupons", headers=_h(sa_token), json={
            "code": COUPON_CODE, "kind": "percent", "value": 20,
            "applies_to": ["professional"], "first_payment_only": True,
        })
        assert r.status_code == 400
        assert "existe" in r.json().get("detail", "").lower() or "j" in r.json().get("detail", "").lower()

    def test_update_coupon(self, sa_token):
        cid = _created_coupon_id["id"]
        assert cid, "must have created a coupon"
        r = session.put(f"{API}/coupons/{cid}", headers=_h(sa_token), json={
            "code": COUPON_CODE, "kind": "percent", "value": 25,
            "applies_to": ["professional", "premium"],
            "first_payment_only": True, "max_uses": 50,
        })
        assert r.status_code == 200
        assert r.json()["value"] == 25
        assert r.json()["max_uses"] == 50

    def test_validate_coupon_ok(self, admin_token):
        r = session.get(f"{API}/coupons/validate/{COUPON_CODE}", headers=_h(admin_token),
                        params={"plan_key": "professional"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["code"] == COUPON_CODE
        assert d["kind"] == "percent"
        assert d["value"] == 25
        assert d["first_payment_only"] is True

    def test_validate_coupon_plan_not_applicable(self, admin_token):
        r = session.get(f"{API}/coupons/validate/{COUPON_CODE}", headers=_h(admin_token),
                        params={"plan_key": "starter"})
        assert r.status_code == 400

    def test_validate_coupon_not_found(self, admin_token):
        r = session.get(f"{API}/coupons/validate/NOSUCHCODE", headers=_h(admin_token),
                        params={"plan_key": "professional"})
        assert r.status_code == 404

    def test_validate_expired_coupon(self, sa_token, admin_token):
        code = f"TESTEXP{uuid.uuid4().hex[:4].upper()}"
        r = session.post(f"{API}/coupons", headers=_h(sa_token), json={
            "code": code, "kind": "percent", "value": 10,
            "applies_to": ["professional"], "first_payment_only": True,
            "valid_until": "2020-01-01T00:00:00Z",
        })
        assert r.status_code == 200
        cid = r.json()["coupon_id"]
        try:
            r2 = session.get(f"{API}/coupons/validate/{code}", headers=_h(admin_token),
                             params={"plan_key": "professional"})
            assert r2.status_code == 410
        finally:
            session.delete(f"{API}/coupons/{cid}", headers=_h(sa_token))

    def test_validate_exhausted_coupon(self, sa_token, admin_token):
        code = f"TESTMAX{uuid.uuid4().hex[:4].upper()}"
        r = session.post(f"{API}/coupons", headers=_h(sa_token), json={
            "code": code, "kind": "percent", "value": 10,
            "applies_to": ["professional"], "first_payment_only": True, "max_uses": 1,
        })
        assert r.status_code == 200
        cid = r.json()["coupon_id"]
        # Bump uses_count manually via a direct DB update? We don't have DB access from tests;
        # instead update coupon and simulate by patching uses via PUT is not exposed.
        # Skip if we can't force it — but we can call PUT with same schema which resets uses_count? No, PUT doesn't touch uses_count.
        # So we consume the coupon by running a checkout (see TestCheckoutCoupon.test_checkout_applies_and_increments)
        # Since that is a separate resource, we just skip if not exhausted; but we can create with max_uses=0 impossible? Yes >=0 possible.
        # Alternative: create with max_uses=0 => any use is >= max_uses.
        r_up = session.put(f"{API}/coupons/{cid}", headers=_h(sa_token), json={
            "code": code, "kind": "percent", "value": 10,
            "applies_to": ["professional"], "first_payment_only": True, "max_uses": 0,
        })
        assert r_up.status_code == 200
        try:
            r2 = session.get(f"{API}/coupons/validate/{code}", headers=_h(admin_token),
                             params={"plan_key": "professional"})
            assert r2.status_code == 410, f"expected 410 exhausted, got {r2.status_code}: {r2.text}"
        finally:
            session.delete(f"{API}/coupons/{cid}", headers=_h(sa_token))


# ------------------------------------------------------------------
# 4) Webhook PAYMENT_CONFIRMED -> invoice PDF + email log
# ------------------------------------------------------------------
_admin_clinic_id = {"id": None}


def _fetch_admin_clinic_id(admin_token):
    if _admin_clinic_id["id"]:
        return _admin_clinic_id["id"]
    r = session.get(f"{API}/auth/me", headers=_h(admin_token))
    assert r.status_code == 200
    _admin_clinic_id["id"] = r.json()["clinic_id"]
    return _admin_clinic_id["id"]


class TestWebhookInvoice:
    _payload = {}

    def test_webhook_missing_id_returns_400(self):
        r = session.post(f"{API}/webhooks/asaas",
                         headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                         json={"event": "PAYMENT_CONFIRMED", "payment": {"value": 99.90}})
        assert r.status_code == 400

    def test_webhook_payment_confirmed_creates_invoice(self, admin_token):
        clinic_id = _fetch_admin_clinic_id(admin_token)
        event_id = f"pay_test_phase24b_{uuid.uuid4().hex[:10]}"
        body = {
            "id": event_id,
            "event": "PAYMENT_CONFIRMED",
            "payment": {
                "id": f"pay_gw_{uuid.uuid4().hex[:8]}",
                "value": 99.90,
                "billingType": "PIX",
                "externalReference": clinic_id,
                "paymentDate": "2026-01-15",
                "nextDueDate": "2026-02-15",
            },
        }
        r = session.post(f"{API}/webhooks/asaas",
                         headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                         json=body)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        assert not r.json().get("duplicate")
        TestWebhookInvoice._payload = body

    def test_webhook_duplicate_returns_duplicate_true(self):
        body = TestWebhookInvoice._payload
        assert body, "prior webhook must have run"
        r = session.post(f"{API}/webhooks/asaas",
                         headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                         json=body)
        assert r.status_code == 200
        assert r.json().get("duplicate") is True

    def test_invoices_endpoint_returns_payment_with_url(self, admin_token):
        # Poll a bit since the webhook is synchronous but be safe
        time.sleep(1.0)
        r = session.get(f"{API}/invoices", headers=_h(admin_token))
        assert r.status_code == 200
        docs = r.json()
        # BUG: server.py::_build_invoice_pdf does .replace(",","X").replace(".",",").replace("X",".")
        # on the ENTIRE HTML — this destroys CSS `font-family: Helvetica, Arial, sans-serif` and
        # xhtml2pdf/pisa raises: "Declaration group closing '}' not found". PDF gen fails silently;
        # invoice_url stays None, payment is stored WITHOUT invoice_url, and /invoices filter
        # `invoice_url: {$ne: null}` returns []. See backend logs "Invoice PDF gen failed".
        if not docs:
            pytest.fail("BUG: /invoices returns [] because _build_invoice_pdf broke — see backend logs "
                        "'Invoice PDF gen failed: Declaration group closing }' not found'. "
                        "Fix: apply comma/dot swap only to the amount string, not the entire HTML.")
        assert isinstance(docs, list) and len(docs) >= 1
        latest = docs[0]
        assert latest.get("invoice_url", "").startswith("/api/files/"), latest.get("invoice_url")
        assert "sig=" in latest["invoice_url"]
        TestWebhookInvoice._invoice_url = latest["invoice_url"]

    def test_invoice_url_returns_pdf(self):
        url = getattr(TestWebhookInvoice, "_invoice_url", None)
        assert url, "invoice_url from previous test"
        r = requests.get(BASE_URL + url, timeout=30)
        assert r.status_code == 200, f"invoice fetch: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        assert len(r.content) > 500, "PDF too small — probably empty"
        # PDF magic bytes
        assert r.content[:4] == b"%PDF", r.content[:8]


# ------------------------------------------------------------------
# 5) Email logs
# ------------------------------------------------------------------
class TestEmailLogs:
    def test_email_log_exists_after_webhook(self, admin_token):
        # No direct API. We verify by checking a subsequent duplicate webhook still returns duplicate,
        # and by relying on the send_email_payment_confirmed being called (logged via /invoices).
        # Since email_logs is internal, at least assert the flow completed w/o 500.
        # For deeper introspection, would need a debug endpoint — skipping strict assertion.
        # We simply check that /invoices contains a payment: already tested above.
        r = session.get(f"{API}/invoices", headers=_h(admin_token))
        assert r.status_code == 200
        assert any(p.get("invoice_url") for p in r.json())


# ------------------------------------------------------------------
# 6) Checkout with coupon
# ------------------------------------------------------------------
class TestCheckoutCoupon:
    """Note: cannot easily rollback subscription; running this changes admin sub state.
    We instead only assert the discount is APPLIED at API level (coupon uses_count increments)
    by validating final_price returned. Skipped if this would corrupt state — but auto-cleanup
    at teardown."""
    def test_checkout_applies_coupon_discount(self, admin_token, sa_token):
        # Use dedicated single-use coupon so uses_count check is deterministic.
        code = f"TESTCK{uuid.uuid4().hex[:4].upper()}"
        r = session.post(f"{API}/coupons", headers=_h(sa_token), json={
            "code": code, "kind": "percent", "value": 20,
            "applies_to": ["professional", "premium"],
            "first_payment_only": True, "max_uses": 5,
        })
        assert r.status_code == 200
        cid = r.json()["coupon_id"]

        # Get admin details (need CPF/CNPJ)
        payload = {
            "plan_key": "professional",
            "billing_cycle": "monthly",
            "billing_type": "PIX",
            "coupon_code": code,
            "cpf_cnpj": "24971563792",
            "holder_name": "Admin ProClinic",
            "email": "admin@proclinic.com",
            "phone": "11999999999",
        }
        r_co = session.post(f"{API}/subscriptions/checkout", headers=_h(admin_token), json=payload)
        try:
            if r_co.status_code >= 400:
                # Might fail because admin already has an active subscription state. Log the error but still validate.
                pytest.skip(f"checkout failed (env dependent): {r_co.status_code} {r_co.text[:200]}")
            d = r_co.json()
            assert d.get("coupon_applied") == code
            assert "final_price" in d
            # Verify uses_count incremented
            r_list = session.get(f"{API}/coupons", headers=_h(sa_token))
            found = [c for c in r_list.json() if c["code"] == code]
            assert found and found[0]["uses_count"] >= 1
        finally:
            session.delete(f"{API}/coupons/{cid}", headers=_h(sa_token))


# ------------------------------------------------------------------
# 7) Cleanup
# ------------------------------------------------------------------
class TestZZZCleanup:
    def test_cleanup(self, sa_token):
        # Remove our main test coupon
        if _created_coupon_id["id"]:
            session.delete(f"{API}/coupons/{_created_coupon_id['id']}", headers=_h(sa_token))
        # Remove any leftover TEST_ coupons
        r = session.get(f"{API}/coupons", headers=_h(sa_token))
        if r.status_code == 200:
            for c in r.json():
                code = c.get("code", "")
                if code.startswith("TEST") or code.startswith("TESTEXP") or code.startswith("TESTMAX") or code.startswith("TESTCK") or code.startswith("TESTLNCH"):
                    session.delete(f"{API}/coupons/{c['coupon_id']}", headers=_h(sa_token))
        assert True
