"""Phase 2.4C — Email tracking (open/click), email-logs endpoint, primary_color branding.

Covers:
- GET /api/email-tracking/open/{email_id}.png (returns 1x1 gif even for unknown ids, increments open_count).
- GET /api/email-tracking/click/{email_id}?u=... (302 redirect + click_count).
- Safety: javascript: URLs are rejected and redirected to '/'.
- GET /api/super-admin/email-logs (super_admin only, 403 for others).
- PUT /api/clinic with primary_color persists.
- send_email_trial_day3_features / send_email_trial_day5_socialproof importable + idempotency keys.
- Webhook PAYMENT_CONFIRMED still creates email_log with clinic_id + email_id (em_<12hex>).
"""

import os
import re
import time
import uuid
import hmac
import hashlib
import importlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://proclinic-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER_EMAIL = "superadmin@proclinic.com"
SUPER_PASS = "super123"
ADMIN_EMAIL = "admin@proclinic.com"
ADMIN_PASS = "admin123"
BELLA_EMAIL = "dra.bella@proclinic.com"
BELLA_PASS = "bella123"

WEBHOOK_TOKEN = "whsec_proclinic_a8f3d9e2c1b47506a92e3f81d5c6b0a4"


# ------------------- fixtures -------------------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _login(sess, email, password):
    r = sess.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def super_token():
    sess = requests.Session()
    return _login(sess, SUPER_EMAIL, SUPER_PASS)


@pytest.fixture(scope="module")
def admin_token():
    sess = requests.Session()
    return _login(sess, ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def bella_token():
    sess = requests.Session()
    return _login(sess, BELLA_EMAIL, BELLA_PASS)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------- open tracking -------------------
class TestEmailOpenTracking:
    def test_open_unknown_id_returns_200_gif(self):
        fake_id = f"em_{uuid.uuid4().hex[:12]}"
        r = requests.get(f"{API}/email-tracking/open/{fake_id}.png", allow_redirects=False)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/gif")
        assert len(r.content) > 0
        # GIF89a magic
        assert r.content[:6] in (b"GIF89a", b"GIF87a")

    def test_open_increments_open_count_for_existing_email(self, super_token):
        # get any existing email_log
        logs = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token)).json()
        if not logs:
            pytest.skip("No pre-existing email logs to verify open_count increment")
        target = logs[0]
        email_id = target["email_id"]
        before = int(target.get("open_count") or 0)
        r = requests.get(f"{API}/email-tracking/open/{email_id}.png")
        assert r.status_code == 200
        # re-fetch and verify open_count incremented + opened_at populated
        logs2 = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token)).json()
        entry = next((x for x in logs2 if x["email_id"] == email_id), None)
        assert entry is not None
        assert int(entry.get("open_count") or 0) >= before + 1
        assert entry.get("opened_at") is not None


# ------------------- click tracking -------------------
class TestEmailClickTracking:
    def test_click_redirects_to_target_https(self):
        fake_id = f"em_{uuid.uuid4().hex[:12]}"
        target = "https://example.com/anything?a=1"
        r = requests.get(
            f"{API}/email-tracking/click/{fake_id}",
            params={"u": target},
            allow_redirects=False,
        )
        assert r.status_code == 302, r.text
        assert r.headers.get("location") == target

    def test_click_javascript_url_redirected_to_root(self):
        fake_id = f"em_{uuid.uuid4().hex[:12]}"
        r = requests.get(
            f"{API}/email-tracking/click/{fake_id}",
            params={"u": "javascript:alert(1)"},
            allow_redirects=False,
        )
        assert r.status_code == 302
        assert r.headers.get("location") == "/"

    def test_click_data_url_rejected(self):
        fake_id = f"em_{uuid.uuid4().hex[:12]}"
        r = requests.get(
            f"{API}/email-tracking/click/{fake_id}",
            params={"u": "data:text/html,<script>1</script>"},
            allow_redirects=False,
        )
        assert r.status_code == 302
        assert r.headers.get("location") == "/"

    def test_click_increments_click_count(self, super_token):
        logs = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token)).json()
        if not logs:
            pytest.skip("No pre-existing email logs")
        target = logs[0]
        email_id = target["email_id"]
        before = int(target.get("click_count") or 0)
        r = requests.get(
            f"{API}/email-tracking/click/{email_id}",
            params={"u": "https://example.com"},
            allow_redirects=False,
        )
        assert r.status_code == 302
        logs2 = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token)).json()
        entry = next((x for x in logs2 if x["email_id"] == email_id), None)
        assert entry is not None
        assert int(entry.get("click_count") or 0) >= before + 1
        assert entry.get("clicked_at") is not None


# ------------------- super-admin email-logs -------------------
class TestSuperAdminEmailLogs:
    def test_super_admin_can_list(self, super_token):
        r = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # if any exists, check schema
        if data:
            entry = data[0]
            for k in ["email_id", "to", "subject", "status"]:
                assert k in entry, f"missing key {k} in {entry}"
            # optional fields
            # opened_at / clicked_at / click_count may be null/absent for failed entries
            assert entry["email_id"].startswith("em_")

    def test_admin_forbidden(self, admin_token):
        r = requests.get(f"{API}/super-admin/email-logs", headers=_h(admin_token))
        assert r.status_code == 403

    def test_professional_forbidden(self, bella_token):
        r = requests.get(f"{API}/super-admin/email-logs", headers=_h(bella_token))
        assert r.status_code == 403

    def test_no_auth_401(self):
        r = requests.get(f"{API}/super-admin/email-logs")
        assert r.status_code in (401, 403)


# ------------------- primary_color branding -------------------
class TestClinicPrimaryColor:
    def test_put_clinic_persists_primary_color(self, admin_token):
        new_color = "#8B5CF6"
        r = requests.put(
            f"{API}/clinic",
            headers=_h(admin_token),
            json={"name": "Clínica ProClinic Demo", "primary_color": new_color},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("primary_color") == new_color

        # re-fetch
        r2 = requests.get(f"{API}/clinic", headers=_h(admin_token))
        assert r2.status_code == 200
        assert r2.json().get("primary_color") == new_color

    def test_revert_primary_color(self, admin_token):
        r = requests.put(
            f"{API}/clinic",
            headers=_h(admin_token),
            json={"name": "Clínica ProClinic Demo", "primary_color": "#B76E79"},
        )
        assert r.status_code == 200
        assert r.json().get("primary_color") == "#B76E79"


# ------------------- functions importable + webhook email_log -------------------
class TestBackgroundEmailFunctions:
    def test_send_email_trial_functions_importable(self):
        # Import server module and verify callables exist
        import sys
        sys.path.insert(0, "/app/backend")
        import server  # noqa
        assert hasattr(server, "send_email_trial_day3_features")
        assert hasattr(server, "send_email_trial_day5_socialproof")
        assert hasattr(server, "send_email_trial_expiring")
        assert callable(server.send_email_trial_day3_features)
        assert callable(server.send_email_trial_day5_socialproof)


# ------------------- webhook -> email_log has clinic_id + email_id -------------------
class TestWebhookEmailLog:
    def _post_webhook(self, event_id, payment_id, clinic_id):
        payload = {
            "id": event_id,
            "event": "PAYMENT_CONFIRMED",
            "payment": {
                "id": payment_id,
                "value": 197.0,
                "netValue": 197.0,
                "status": "CONFIRMED",
                "billingType": "CREDIT_CARD",
                "invoiceUrl": None,
                "dueDate": "2026-02-01",
                "paymentDate": "2026-01-15",
                "description": "ProClinic - Plano Professional",
                "externalReference": clinic_id,
            },
        }
        headers = {
            "asaas-access-token": WEBHOOK_TOKEN,
            "Content-Type": "application/json",
        }
        r = requests.post(f"{API}/webhooks/asaas", json=payload, headers=headers)
        return r

    def test_webhook_creates_email_log_with_clinic_id_and_email_id(self, super_token, admin_token):
        # Discover admin's clinic_id
        me = requests.get(f"{API}/auth/me", headers=_h(admin_token)).json()
        clinic_id = me.get("clinic_id")
        assert clinic_id, f"admin has no clinic_id: {me}"

        event_id = f"evt_tst_{uuid.uuid4().hex[:10]}"
        payment_id = f"pay_tst_{uuid.uuid4().hex[:10]}"
        r = self._post_webhook(event_id, payment_id, clinic_id)
        assert r.status_code in (200, 201, 204), f"webhook status {r.status_code}: {r.text}"

        # Give backend a beat to record the email attempt
        time.sleep(3)

        logs = requests.get(f"{API}/super-admin/email-logs", headers=_h(super_token)).json()
        # Find the log matching THIS specific payment (idempotency_key)
        expected_key = f"payment_confirmed:{payment_id}"
        matches = [x for x in logs if x.get("idempotency_key") == expected_key]
        assert matches, f"No email_log for idempotency_key={expected_key} (total logs: {len(logs)})"
        latest = matches[0]
        # email_id format em_<12hex>
        assert re.match(r"^em_[0-9a-f]{12}$", latest["email_id"]), f"bad email_id: {latest['email_id']}"
        assert latest.get("clinic_id"), f"clinic_id missing in {latest}"
        # status must be sent or failed but valid
        assert latest.get("status") in ("sent", "failed")
        # When sent, tracking counters must exist
        if latest["status"] == "sent":
            assert "click_count" in latest
            assert "opened_at" in latest
            assert "clicked_at" in latest


# ------------------- regression sanity: existing phase 2.4B endpoints still up -------------------
class TestRegression:
    def test_plans_public(self):
        r = requests.get(f"{API}/plans")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_super_admin_summary(self, super_token):
        r = requests.get(f"{API}/super-admin/summary", headers=_h(super_token))
        assert r.status_code == 200

    def test_super_admin_clinics(self, super_token):
        r = requests.get(f"{API}/super-admin/clinics", headers=_h(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_invoices_list(self, admin_token):
        r = requests.get(f"{API}/invoices", headers=_h(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
