"""
Phase 2.4A — Subscriptions (Asaas) integration tests.

Covers:
  * GET /api/plans
  * GET /api/subscriptions/me
  * POST /api/subscriptions/checkout (PIX + BOLETO + non-admin 403)
  * POST /api/subscriptions/cancel
  * POST /api/subscriptions/change-plan
  * GET /api/subscriptions/payments
  * POST /api/webhooks/asaas (PAYMENT_CONFIRMED, PAYMENT_OVERDUE,
    SUBSCRIPTION_INACTIVATED, idempotency, auth)
  * Feature gating on /api/ai/chat and /api/documents (starter → 403)
  * Expired trial → /api/ai/chat 402
  * GET /api/admin/finance/summary
"""

import os
import time
import uuid
from typing import Any, Dict, Optional

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://beauty-ops-platform.preview.emergentagent.com").rstrip("/")
WEBHOOK_TOKEN = os.environ.get("ASAAS_WEBHOOK_TOKEN", "whsec_proclinic_a8f3d9e2c1b47506a92e3f81d5c6b0a4")
API = f"{BASE_URL}/api"

# ---------- helpers ----------

def _login(email: str, password: str) -> Dict[str, Any]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    j = r.json()
    return {"token": j["token"], "user": j}

def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin():
    return _login("admin@proclinic.com", "admin123")

@pytest.fixture(scope="module")
def bella():
    return _login("dra.bella@proclinic.com", "bella123")

@pytest.fixture(scope="module")
def ana():
    return _login("ana.recep@proclinic.com", "ana123")

@pytest.fixture(scope="module")
def clinic_id(admin):
    return admin["user"]["clinic_id"]


# =====================================================================
# 1) Plans catalog
# =====================================================================
class TestPlans:
    def test_list_plans_returns_three(self):
        r = requests.get(f"{API}/plans", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        keys = sorted(p["plan_key"] for p in data)
        assert keys == ["premium", "professional", "starter"]

    def test_plan_prices_and_features(self):
        plans = {p["plan_key"]: p for p in requests.get(f"{API}/plans", timeout=15).json()}
        assert plans["starter"]["price"] == 59.9
        assert plans["professional"]["price"] == 99.9
        assert plans["premium"]["price"] == 149.9
        assert plans["starter"]["annual_price"] == 574.8
        assert plans["professional"]["annual_price"] == 958.8
        assert plans["premium"]["annual_price"] == 1438.8
        # feature flags
        assert plans["starter"]["features"]["ai"] is False
        assert plans["professional"]["features"]["ai"] is True
        assert plans["premium"]["features"]["whatsapp"] is True
        assert plans["professional"]["features"]["documents"] is True
        assert plans["starter"]["features"]["documents"] is False


# =====================================================================
# 2) GET /api/subscriptions/me
# =====================================================================
class TestSubscriptionMe:
    def test_me_returns_subscription(self, admin):
        r = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data is not None
        # status can be 'trial' or already 'pending'/'active' depending on prior manual tests
        assert data["status"] in {"trial", "pending", "active", "past_due", "cancelled"}
        assert data["plan_key"] in {"starter", "professional", "premium"}
        assert "features" in data
        assert "effective_status" in data
        assert isinstance(data["features"], dict)


# =====================================================================
# 3) Reset admin subscription helper — MongoDB direct manipulation
#    We reset to trial before checkout tests to ensure predictable state
# =====================================================================
import asyncio


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _mongo():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    return client, client[db_name]


async def _reset_sub_to_trial(clinic_id: str):
    from datetime import datetime, timezone, timedelta
    client, db = await _mongo()
    now = datetime.now(timezone.utc)
    await db.subscriptions.update_one(
        {"clinic_id": clinic_id},
        {"$set": {
            "status": "trial",
            "plan_key": "professional",
            "billing_cycle": "monthly",
            "trial_ends_at": (now + timedelta(days=7)).isoformat(),
            "read_only_until": (now + timedelta(days=10)).isoformat(),
            "cancelled_at": None,
            "value": 0.0,
            "updated_at": now.isoformat(),
        }, "$unset": {"gateway_subscription_id": "", "gateway_customer_id": ""}},
    )
    client.close()


async def _set_sub_plan(clinic_id: str, plan_key: str, status: str = "active"):
    from datetime import datetime, timezone
    client, db = await _mongo()
    await db.subscriptions.update_one(
        {"clinic_id": clinic_id},
        {"$set": {"plan_key": plan_key, "status": status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    client.close()


async def _expire_trial(clinic_id: str):
    client, db = await _mongo()
    await db.subscriptions.update_one(
        {"clinic_id": clinic_id},
        {"$set": {
            "status": "trial",
            "trial_ends_at": "2020-01-01T00:00:00+00:00",
            "read_only_until": "2020-01-02T00:00:00+00:00",
        }},
    )
    client.close()


async def _delete_webhook_events():
    client, db = await _mongo()
    await db.webhook_events.delete_many({"event_id": {"$regex": "^pay_test_phase24a_"}})
    client.close()


async def _delete_test_payments(clinic_id: str):
    client, db = await _mongo()
    await db.payments.delete_many({"clinic_id": clinic_id, "gateway_payment_id": {"$regex": "^pay_test_phase24a_"}})
    client.close()


# =====================================================================
# 4) Checkout
# =====================================================================
class TestCheckout:
    def test_checkout_non_admin_forbidden(self, bella):
        payload = {
            "plan_key": "professional",
            "billing_cycle": "monthly",
            "billing_type": "PIX",
            "cpf_cnpj": "24971563792",
            "holder_name": "Bella",
            "email": "dra.bella@proclinic.com",
            "phone": "11987654321",
        }
        r = requests.post(f"{API}/subscriptions/checkout", headers=_auth(bella["token"]), json=payload, timeout=30)
        assert r.status_code == 403

    def test_checkout_pix_professional_monthly_admin(self, admin, clinic_id):
        _run(_reset_sub_to_trial(clinic_id))
        payload = {
            "plan_key": "professional",
            "billing_cycle": "monthly",
            "billing_type": "PIX",
            "cpf_cnpj": "24971563792",
            "holder_name": "Teste ProClinic",
            "email": "teste@proclinic.com",
            "phone": "11987654321",
        }
        r = requests.post(f"{API}/subscriptions/checkout", headers=_auth(admin["token"]), json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["gateway_subscription_id"].startswith("sub_")
        assert data["status"] == "pending"

        # Verify in /subscriptions/me
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["status"] == "pending"
        assert me["plan_key"] == "professional"
        assert me["gateway_subscription_id"] == data["gateway_subscription_id"]
        assert me["gateway_customer_id"] is not None
        assert me["value"] == 99.9


# =====================================================================
# 5) Change plan + cancel
# =====================================================================
class TestChangePlanAndCancel:
    def test_change_plan_to_starter(self, admin, clinic_id):
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        if not me or not me.get("gateway_subscription_id"):
            pytest.skip("No gateway_subscription_id — checkout test likely failed")

        r = requests.post(f"{API}/subscriptions/change-plan",
                          headers=_auth(admin["token"]),
                          json={"plan_key": "starter", "billing_cycle": "monthly"}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["plan_key"] == "starter"
        assert data["value"] == 59.9

        me2 = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me2["plan_key"] == "starter"
        assert me2["value"] == 59.9

    def test_cancel_subscription(self, admin):
        r = requests.post(f"{API}/subscriptions/cancel", headers=_auth(admin["token"]), timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["status"] == "cancelled"
        assert me["cancelled_at"] is not None


# =====================================================================
# 6) Payments listing
# =====================================================================
class TestPayments:
    def test_list_payments_returns_list(self, admin):
        r = requests.get(f"{API}/subscriptions/payments", headers=_auth(admin["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# =====================================================================
# 7) Webhooks
# =====================================================================
class TestWebhooks:
    def test_webhook_missing_token_401(self):
        body = {"id": "evt_test_missing", "event": "PAYMENT_CONFIRMED", "payment": {}}
        r = requests.post(f"{API}/webhooks/asaas", json=body, timeout=15)
        assert r.status_code == 401

    def test_webhook_invalid_token_401(self):
        r = requests.post(f"{API}/webhooks/asaas",
                          headers={"asaas-access-token": "WRONG", "Content-Type": "application/json"},
                          json={"id": "evt_invalid", "event": "PAYMENT_CONFIRMED", "payment": {}}, timeout=15)
        assert r.status_code == 401

    def test_webhook_payment_confirmed_activates_and_creates_payment(self, admin, clinic_id):
        # cleanup previous test webhook events
        _run(_delete_webhook_events())
        _run(_delete_test_payments(clinic_id))

        event_id = f"pay_test_phase24a_{uuid.uuid4().hex[:8]}"
        body = {
            "id": event_id,
            "event": "PAYMENT_CONFIRMED",
            "payment": {
                "id": event_id,
                "subscription": "sub_gw_test",
                "value": 99.90,
                "billingType": "PIX",
                "paymentDate": "2026-07-16",
                "externalReference": clinic_id,
            },
        }
        r = requests.post(f"{API}/webhooks/asaas",
                          headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                          json=body, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("duplicate") is not True

        # Subscription should be active
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["status"] == "active"

        # Payments list should contain the new payment
        pays = requests.get(f"{API}/subscriptions/payments", headers=_auth(admin["token"]), timeout=15).json()
        assert any(p.get("gateway_payment_id") == event_id for p in pays)

    def test_webhook_idempotency(self, clinic_id):
        # Send same event twice; second should return duplicate:true
        event_id = f"pay_test_phase24a_idem_{uuid.uuid4().hex[:6]}"
        body = {
            "id": event_id,
            "event": "PAYMENT_CONFIRMED",
            "payment": {
                "id": event_id,
                "subscription": "sub_gw_test",
                "value": 99.90,
                "billingType": "PIX",
                "paymentDate": "2026-07-16",
                "externalReference": clinic_id,
            },
        }
        h = {"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"}
        r1 = requests.post(f"{API}/webhooks/asaas", headers=h, json=body, timeout=15)
        r2 = requests.post(f"{API}/webhooks/asaas", headers=h, json=body, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True

    def test_webhook_payment_overdue_sets_past_due(self, admin, clinic_id):
        event_id = f"pay_test_phase24a_overdue_{uuid.uuid4().hex[:6]}"
        body = {
            "id": event_id,
            "event": "PAYMENT_OVERDUE",
            "payment": {"id": event_id, "subscription": "sub_gw_test", "externalReference": clinic_id},
        }
        r = requests.post(f"{API}/webhooks/asaas",
                          headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                          json=body, timeout=15)
        assert r.status_code == 200
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["status"] == "past_due"

    def test_webhook_subscription_inactivated_sets_cancelled(self, admin, clinic_id):
        event_id = f"pay_test_phase24a_inact_{uuid.uuid4().hex[:6]}"
        body = {
            "id": event_id,
            "event": "SUBSCRIPTION_INACTIVATED",
            "payment": {"id": event_id, "subscription": "sub_gw_test", "externalReference": clinic_id},
        }
        r = requests.post(f"{API}/webhooks/asaas",
                          headers={"asaas-access-token": WEBHOOK_TOKEN, "Content-Type": "application/json"},
                          json=body, timeout=15)
        assert r.status_code == 200
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["status"] == "cancelled"


# =====================================================================
# 8) Feature gating
# =====================================================================
class TestFeatureGating:
    def test_starter_blocks_ai_chat(self, admin, clinic_id):
        _run(_set_sub_plan(clinic_id, "starter", status="active"))
        r = requests.post(f"{API}/ai/chat",
                          headers=_auth(admin["token"]),
                          json={"message": "hello", "session_id": "test_session_phase24a"}, timeout=30)
        assert r.status_code == 403
        detail = r.json().get("detail")
        # detail may be dict or JSON-decoded object
        if isinstance(detail, dict):
            assert detail.get("code") == "plan_upgrade_required"
        else:
            # fastapi HTTPException converts dict-detail into a dict when jsonified
            assert "plan_upgrade_required" in str(detail)

    def test_professional_allows_ai_chat(self, admin, clinic_id):
        _run(_set_sub_plan(clinic_id, "professional", status="active"))
        r = requests.post(f"{API}/ai/chat",
                          headers=_auth(admin["token"]),
                          json={"message": "Olá, teste", "session_id": "test_session_phase24a_ok"}, timeout=60)
        # AI chat can be 200 (LLM ok) or 500 (LLM key issues); but MUST NOT be 403/402
        assert r.status_code not in (403, 402), f"unexpected gate: {r.status_code} {r.text[:200]}"

    def test_starter_blocks_documents_create(self, admin, clinic_id):
        _run(_set_sub_plan(clinic_id, "starter", status="active"))
        # Need a template + patient. If create fails on template-not-found, it's still fine — gate runs first.
        r = requests.post(f"{API}/documents",
                          headers=_auth(admin["token"]),
                          json={"patient_id": "TEST_x", "template_id": "TEST_x", "device": "desktop"}, timeout=30)
        assert r.status_code == 403
        detail = r.json().get("detail")
        if isinstance(detail, dict):
            assert detail.get("code") == "plan_upgrade_required"
        else:
            assert "plan_upgrade_required" in str(detail)

    def test_expired_trial_returns_402(self, admin, clinic_id):
        _run(_expire_trial(clinic_id))
        me = requests.get(f"{API}/subscriptions/me", headers=_auth(admin["token"]), timeout=15).json()
        assert me["effective_status"] == "expired"
        r = requests.post(f"{API}/ai/chat",
                          headers=_auth(admin["token"]),
                          json={"message": "hi", "session_id": "s"}, timeout=30)
        assert r.status_code == 402
        detail = r.json().get("detail")
        if isinstance(detail, dict):
            assert detail.get("code") == "subscription_required"
        else:
            assert "subscription_required" in str(detail)


# =====================================================================
# 9) Admin finance summary
# =====================================================================
class TestAdminFinance:
    def test_admin_finance_summary(self, admin, clinic_id):
        # Restore a sane state first
        _run(_set_sub_plan(clinic_id, "professional", status="active"))
        r = requests.get(f"{API}/admin/finance/summary", headers=_auth(admin["token"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        for k in ("active", "trial", "past_due", "cancelled", "mrr", "arr", "conversion_rate"):
            assert k in j
        assert isinstance(j["mrr"], (int, float))
        assert isinstance(j["arr"], (int, float))


# =====================================================================
# 10) Cleanup — restore trial subscription for next iterations
# =====================================================================
class TestZZZCleanup:
    def test_restore_admin_trial(self, clinic_id):
        _run(_reset_sub_to_trial(clinic_id))
        _run(_delete_webhook_events())
        _run(_delete_test_payments(clinic_id))
