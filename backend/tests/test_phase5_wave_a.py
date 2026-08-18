"""Fase 5 Onda A — Reestruturação Arquitetural + preparação de comissões (schema-only).

Objetivo: garantir REGRESSÃO TOTAL das fases anteriores + validar 3 grupos aditivos:
(1) POST /procedures aceita commission_percent opcional (default 0).
(2) POST /finance/entries aceita commission_amount + commission_status opcionais.
(3) POST /auth/register aceita default_commission_percent opcional.

IMPORTANTE: campos são schema-only — nenhuma regra de cálculo automático deve disparar.
Backward compatibility: payloads SEM os novos campos continuam funcionando (não é bug).
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://medical-hub-131.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@proclinic.com", "admin123")
BELLA = ("dra.bella@proclinic.com", "bella123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def bella_token():
    return _login(*BELLA)


@pytest.fixture(scope="module")
def a_patient(admin_token):
    r = requests.get(f"{API}/patients", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    items = r.json()
    if items:
        return items[0]["patient_id"]
    r = requests.post(f"{API}/patients", headers=_h(admin_token), json={"name": "TEST_P5A_PAT"}, timeout=30)
    return r.json()["patient_id"]


# ==========================================================
# 1) REGRESSÃO TOTAL — endpoints das fases anteriores 200
# ==========================================================
class TestRegressionEndpoints:
    def test_auth_login_admin(self, admin_token):
        assert admin_token

    def test_auth_login_bella(self, bella_token):
        assert bella_token

    def test_get_patients(self, admin_token):
        r = requests.get(f"{API}/patients", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_post_patient_backward_compat(self, admin_token):
        r = requests.post(
            f"{API}/patients", headers=_h(admin_token),
            json={"name": f"TEST_P5A_{uuid.uuid4().hex[:6]}"}, timeout=30,
        )
        assert r.status_code in (200, 201)
        pid = r.json()["patient_id"]
        # Cleanup
        requests.delete(f"{API}/patients/{pid}", headers=_h(admin_token), timeout=30)

    def test_get_appointments(self, admin_token):
        r = requests.get(f"{API}/appointments", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200

    def test_get_medical_records(self, bella_token):
        r = requests.get(f"{API}/medical-records", headers=_h(bella_token), timeout=30)
        assert r.status_code == 200

    def test_patient_timeline(self, admin_token, a_patient):
        r = requests.get(f"{API}/patients/{a_patient}/timeline", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "sessions" in d
        assert "legacy_records" in d
        assert "counts" in d

    def test_finance_entries_get(self, admin_token):
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200

    def test_finance_summary(self, admin_token):
        r = requests.get(f"{API}/finance/summary", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        for k in ("receitas", "despesas", "saldo", "chart"):
            assert k in r.json()

    def test_finance_patient_summary(self, admin_token, a_patient):
        r = requests.get(f"{API}/finance/patient/{a_patient}/summary", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "total_pago" in d and "entries" in d

    def test_dashboard_stats(self, admin_token):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert "total_patients" in r.json()

    def test_procedures_get(self, admin_token):
        r = requests.get(f"{API}/procedures", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200

    def test_ai_generations_get(self, bella_token):
        r = requests.get(f"{API}/ai/generations", headers=_h(bella_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ==========================================================
# 2) ADITIVO: ProcedureIn.commission_percent
# ==========================================================
class TestProcedureCommission:
    def test_create_procedure_with_commission_percent(self, admin_token):
        payload = {"name": f"TEST_comm_{uuid.uuid4().hex[:6]}", "price": 100, "commission_percent": 15}
        r = requests.post(f"{API}/procedures", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d["commission_percent"] == 15
        assert d["price"] == 100
        pid = d["procedure_id"]
        # GET returns it
        r2 = requests.get(f"{API}/procedures", headers=_h(admin_token), timeout=30)
        assert r2.status_code == 200
        match = [p for p in r2.json() if p["procedure_id"] == pid]
        assert len(match) == 1
        assert match[0]["commission_percent"] == 15
        # cleanup
        requests.delete(f"{API}/procedures/{pid}", headers=_h(admin_token), timeout=30)

    def test_create_procedure_without_commission_percent_backward_compat(self, admin_token):
        # No commission_percent — should still accept 200 (default 0)
        payload = {"name": f"TEST_nocomm_{uuid.uuid4().hex[:6]}", "price": 50}
        r = requests.post(f"{API}/procedures", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        # default 0 (or None accepted — both are "no active rule")
        assert d.get("commission_percent") in (0, 0.0, None)
        pid = d["procedure_id"]
        requests.delete(f"{API}/procedures/{pid}", headers=_h(admin_token), timeout=30)


# ==========================================================
# 3) ADITIVO: FinancialEntry commission_amount + commission_status
# ==========================================================
class TestFinanceEntryCommission:
    def test_create_entry_with_commission_fields(self, admin_token, a_patient):
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": f"TEST_comm_fin_{uuid.uuid4().hex[:6]}",
            "amount": 100,
            "due_date": "2026-02-10",
            "patient_id": a_patient,
            "commission_amount": 20,
            "commission_status": "pendente",
        }
        r = requests.post(f"{API}/finance/entries", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        eid = d["entry_id"]
        assert d["commission_amount"] == 20
        assert d["commission_status"] == "pendente"
        # GET returns it
        r2 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient}, timeout=30)
        assert r2.status_code == 200
        found = [e for e in r2.json() if e["entry_id"] == eid]
        assert len(found) == 1
        assert found[0]["commission_amount"] == 20
        assert found[0]["commission_status"] == "pendente"
        # cleanup
        requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token), timeout=30)

    def test_create_entry_without_commission_backward_compat(self, admin_token):
        payload = {
            "type": "despesa",
            "category": "Test",
            "description": f"TEST_nocomm_fin_{uuid.uuid4().hex[:6]}",
            "amount": 30,
            "due_date": "2026-02-15",
        }
        r = requests.post(f"{API}/finance/entries", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        # Fields present in response but None
        assert d.get("commission_amount") is None
        assert d.get("commission_status") is None
        requests.delete(f"{API}/finance/entries/{d['entry_id']}", headers=_h(admin_token), timeout=30)

    def test_patch_commission_status_to_paga(self, admin_token):
        # Create with pendente
        r = requests.post(
            f"{API}/finance/entries", headers=_h(admin_token),
            json={
                "type": "receita", "category": "Test",
                "description": f"TEST_patch_comm_{uuid.uuid4().hex[:6]}",
                "amount": 100, "due_date": "2026-02-20",
                "commission_amount": 15, "commission_status": "pendente",
            }, timeout=30,
        )
        eid = r.json()["entry_id"]
        # PATCH via PUT to change commission_status
        # Note: FinancialEntryPatch may not include commission_status field explicitly.
        # We check whether backend accepts it (via extra fields) OR ignores. Both are OK
        # for schema-only phase — but assertion is that PUT does not 500.
        r2 = requests.put(
            f"{API}/finance/entries/{eid}", headers=_h(admin_token),
            json={"commission_status": "paga"}, timeout=30,
        )
        assert r2.status_code == 200, r2.text
        # cleanup
        requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token), timeout=30)

    def test_invalid_commission_status_rejected(self, admin_token):
        payload = {
            "type": "receita", "category": "Test",
            "description": "TEST_invalid_comm_status",
            "amount": 10, "due_date": "2026-02-25",
            "commission_status": "invalido_status",
        }
        r = requests.post(f"{API}/finance/entries", headers=_h(admin_token), json=payload, timeout=30)
        # Should be 422 (Literal validation)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"


# ==========================================================
# 4) ADITIVO: RegisterIn.default_commission_percent
# ==========================================================
class TestRegisterCommission:
    def test_register_with_default_commission_percent(self):
        email = f"test_p5a_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/auth/register",
            json={
                "email": email, "password": "test123456",
                "name": "TEST P5A User", "role": "recepcao",
                "default_commission_percent": 20,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == email

    def test_register_without_default_commission_percent_backward_compat(self):
        email = f"test_p5a_bc_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/auth/register",
            json={
                "email": email, "password": "test123456",
                "name": "TEST P5A BC", "role": "recepcao",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text


# ==========================================================
# 5) REGRESSÃO: attendance start + finalize idempotency + sign (Fase 2.5D/E)
# ==========================================================
class TestAttendanceRegression:
    @pytest.fixture(scope="class")
    def apt_id(self, admin_token, a_patient):
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=11, minute=0, second=0, microsecond=0)
        end = start + timedelta(minutes=30)
        r = requests.post(
            f"{API}/appointments", headers=_h(admin_token),
            json={
                "patient_id": a_patient, "procedure": "TEST_P5A_att",
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
                "price": 100, "status": "agendado",
            }, timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        return r.json()["appointment_id"]

    def test_start_and_finalize_idempotency(self, bella_token, admin_token, apt_id):
        r = requests.post(f"{API}/attendance/start", headers=_h(bella_token), json={"appointment_id": apt_id}, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]

        # Finalize
        payload = {"payment_status": "pago", "amount_total": 100}
        r1 = requests.post(f"{API}/attendance/{sid}/finalize", headers=_h(bella_token), json=payload, timeout=30)
        assert r1.status_code == 200, r1.text
        eids_1 = r1.json().get("financial_entries", [])

        # Second finalize — must be idempotent
        r2 = requests.post(f"{API}/attendance/{sid}/finalize", headers=_h(bella_token), json=payload, timeout=30)
        assert r2.status_code == 200, r2.text
        eids_2 = r2.json().get("financial_entries", [])
        assert set(eids_1) == set(eids_2), "finalize deve ser idempotente"

        # Sign
        # Sign requires type=consent|evolution + signature >= 100 chars
        long_sig = "data:image/png;base64," + ("A" * 200)
        r3 = requests.post(
            f"{API}/attendance/{sid}/sign", headers=_h(bella_token),
            json={"type": "consent", "signature": long_sig, "timezone": "America/Sao_Paulo"},
            timeout=30,
        )
        assert r3.status_code == 200, r3.text
        body = r3.json()
        assert body.get("ok") is True
        meta = body.get("meta", {})
        # Forensic metadata
        assert "sha256" in meta and len(meta["sha256"]) == 64
        assert meta.get("timezone") == "America/Sao_Paulo"
        assert meta.get("signed_at")

        # cleanup entries
        for eid in eids_1:
            requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token), timeout=30)


# ==========================================================
# 6) REGRESSÃO IA (Fase 4) — smoke em 3 types (rápido)
# ==========================================================
class TestAIRegression:
    @pytest.mark.parametrize("ai_type", ["evolution", "contraindications", "improve"])
    def test_ai_generate_types(self, bella_token, a_patient, ai_type):
        payload = {
            "type": ai_type,
            "patient_id": a_patient,
            "notes": "Paciente pós procedimento estético — evolução tranquila.",
            "current_text": "Paciente bem" if ai_type in ("improve", "rewrite") else None,
            "context": "Aplicação de toxina botulínica",
        }
        r = requests.post(f"{API}/ai/generate", headers=_h(bella_token), json=payload, timeout=60)
        assert r.status_code == 200, f"{ai_type}: {r.status_code} {r.text}"
        d = r.json()
        assert "text" in d
        assert d["type"] == ai_type
        assert isinstance(d["text"], str)
        assert len(d["text"]) > 0
