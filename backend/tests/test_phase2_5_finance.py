"""Phase 2.5A+B — Financeiro overhaul: RBAC, non-destructive PUT, intelligent installments,
public budget approval flow, manual charge generation (idempotent), filters, dashboard regression.

Runs against the public REACT_APP_BACKEND_URL. Uses only credentials from /app/memory/test_credentials.md.
"""

import os
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://proclinic-deploy-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@proclinic.com", "admin123")
BELLA = ("dra.bella@proclinic.com", "bella123")
ANA = ("ana.recep@proclinic.com", "ana123")
SUPER = ("superadmin@proclinic.com", "super123")


# --------------------- helpers ---------------------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    body = r.json()
    return body.get("token") or body.get("access_token")


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def bella_token():
    return _login(*BELLA)


@pytest.fixture(scope="module")
def ana_token():
    return _login(*ANA)


@pytest.fixture(scope="module")
def super_token():
    return _login(*SUPER)


@pytest.fixture(scope="module")
def a_patient(admin_token):
    """Pick an existing patient or create one."""
    r = requests.get(f"{API}/patients", headers=_h(admin_token))
    assert r.status_code == 200
    items = r.json()
    if items:
        return items[0]["patient_id"]
    # create
    r = requests.post(
        f"{API}/patients",
        headers=_h(admin_token),
        json={"name": "TEST_PAT_2_5", "cpf": None, "email": None, "phone": None},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["patient_id"]


# =================== RBAC ===================
class TestFinanceRBAC:
    def test_profissional_forbidden_get_entries(self, bella_token):
        r = requests.get(f"{API}/finance/entries", headers=_h(bella_token))
        assert r.status_code == 403

    def test_profissional_forbidden_summary(self, bella_token):
        r = requests.get(f"{API}/finance/summary", headers=_h(bella_token))
        assert r.status_code == 403

    def test_profissional_forbidden_post(self, bella_token):
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(bella_token),
            json={
                "type": "receita",
                "category": "Test",
                "description": "TEST_should_fail",
                "amount": 100,
                "due_date": "2026-01-15",
            },
        )
        assert r.status_code == 403

    def test_admin_can_read_entries(self, admin_token):
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_can_summary(self, admin_token):
        r = requests.get(f"{API}/finance/summary", headers=_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        for k in ("receitas", "despesas", "saldo", "a_receber", "a_pagar", "chart"):
            assert k in data

    def test_recepcao_can_read_entries(self, ana_token):
        r = requests.get(f"{API}/finance/entries", headers=_h(ana_token))
        assert r.status_code == 200

    def test_recepcao_can_read_summary(self, ana_token):
        r = requests.get(f"{API}/finance/summary", headers=_h(ana_token))
        assert r.status_code == 200

    def test_recepcao_cannot_post(self, ana_token):
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(ana_token),
            json={
                "type": "receita",
                "category": "Test",
                "description": "TEST_recepcao_should_fail",
                "amount": 100,
                "due_date": "2026-01-15",
            },
        )
        assert r.status_code == 403

    def test_recepcao_cannot_put(self, ana_token, admin_token):
        # create as admin
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "receita",
                "category": "Test",
                "description": "TEST_recepcao_put_probe",
                "amount": 50,
                "due_date": "2026-01-15",
            },
        )
        assert r.status_code in (200, 201)
        eid = r.json()["entry_id"]
        # recepcao tries to PUT
        r2 = requests.put(f"{API}/finance/entries/{eid}", headers=_h(ana_token), json={"paid": True})
        assert r2.status_code == 403
        # cleanup
        requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))

    def test_recepcao_cannot_delete(self, ana_token, admin_token):
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "despesa",
                "category": "Test",
                "description": "TEST_recepcao_delete_probe",
                "amount": 25,
                "due_date": "2026-01-16",
            },
        )
        eid = r.json()["entry_id"]
        r2 = requests.delete(f"{API}/finance/entries/{eid}", headers=_h(ana_token))
        assert r2.status_code == 403
        requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))


# =================== SCHEMA + PUT non-destructive ===================
class TestFinanceSchemaAndPUT:
    def test_create_entry_returns_new_fields_with_defaults(self, admin_token, a_patient):
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": "TEST_schema_defaults",
            "amount": 300,
            "due_date": "2026-02-10",
            "patient_id": a_patient,
        }
        r = requests.post(f"{API}/finance/entries", headers=_h(admin_token), json=payload)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d["entry_id"].startswith("fin_")
        # New fields exist (may be None)
        for k in (
            "procedure_id", "professional_id", "cost_center", "notes",
            "installment_group_id", "installment_number", "installment_total",
        ):
            assert k in d, f"missing {k} in response"
        # Defaults for single-entry
        assert d["installment_group_id"] == d["entry_id"]
        assert d["installment_number"] == 1
        assert d["installment_total"] == 1
        # patient_id preserved
        assert d["patient_id"] == a_patient
        # cleanup
        requests.delete(f"{API}/finance/entries/{d['entry_id']}", headers=_h(admin_token))

    def test_create_entry_paid_true_sets_paid_at(self, admin_token):
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "receita",
                "category": "Test",
                "description": "TEST_paid_on_create",
                "amount": 10,
                "due_date": "2026-02-10",
                "paid": True,
            },
        )
        assert r.status_code in (200, 201)
        d = r.json()
        assert d.get("paid") is True
        assert d.get("paid_at"), "paid_at should be populated on create when paid=True"
        assert re.match(r"^\d{4}-\d{2}-\d{2}T", d["paid_at"])
        requests.delete(f"{API}/finance/entries/{d['entry_id']}", headers=_h(admin_token))

    def test_put_preserves_context_fields(self, admin_token, a_patient):
        # create with rich context
        payload = {
            "type": "receita",
            "category": "Procedimentos",
            "description": "TEST_put_nondestructive",
            "amount": 500,
            "due_date": "2026-02-20",
            "patient_id": a_patient,
            "budget_id": "bud_test_placeholder",
            "appointment_id": "apt_test_placeholder",
            "notes": "notas importantes",
            "cost_center": "Sala 1",
        }
        r = requests.post(f"{API}/finance/entries", headers=_h(admin_token), json=payload)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        eid = d["entry_id"]
        # PATCH via PUT with only {paid: true}
        r2 = requests.put(f"{API}/finance/entries/{eid}", headers=_h(admin_token), json={"paid": True})
        assert r2.status_code == 200
        after = r2.json()
        assert after["paid"] is True
        assert after.get("paid_at"), "paid_at must be filled when toggled true"
        # Non-destructive: all other fields intact
        assert after["patient_id"] == a_patient
        assert after["budget_id"] == "bud_test_placeholder"
        assert after["appointment_id"] == "apt_test_placeholder"
        assert after["notes"] == "notas importantes"
        assert after["cost_center"] == "Sala 1"
        assert after["description"] == "TEST_put_nondestructive"
        assert after["amount"] == 500
        assert after["category"] == "Procedimentos"

        # Toggle back paid=false clears paid_at
        r3 = requests.put(f"{API}/finance/entries/{eid}", headers=_h(admin_token), json={"paid": False})
        assert r3.status_code == 200
        after2 = r3.json()
        assert after2["paid"] is False
        assert after2.get("paid_at") is None
        # cleanup
        requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))


# =================== FILTERS ===================
class TestFinanceFilters:
    def test_filter_type_and_paid_and_search_and_date_and_group(self, admin_token, a_patient):
        # seed 3 entries
        base = "TEST_filter_" + uuid.uuid4().hex[:6]
        made = []
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "receita", "category": "Cat1", "description": f"{base}_A_receita_paid",
                "amount": 111, "due_date": "2026-02-05", "paid": True,
                "patient_id": a_patient,
                "installment_group_id": "grp_test_" + base,
                "installment_number": 1, "installment_total": 1,
            },
        )
        made.append(r.json()["entry_id"])
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "despesa", "category": "Cat2", "description": f"{base}_B_despesa_unpaid",
                "amount": 22, "due_date": "2026-02-15", "paid": False,
                "installment_group_id": "grp_test_" + base,
                "installment_number": 2, "installment_total": 3,
            },
        )
        made.append(r.json()["entry_id"])
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "receita", "category": "Cat3", "description": f"{base}_C_receita_unpaid",
                "amount": 33, "due_date": "2026-03-15",
                "installment_group_id": "grp_test_" + base,
                "installment_number": 3, "installment_total": 3,
            },
        )
        made.append(r.json()["entry_id"])

        # filter type=receita
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"type": "receita", "search": base})
        got = r.json()
        assert all(e["type"] == "receita" for e in got)
        assert len(got) >= 2

        # filter paid=true
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"paid": "true", "search": base})
        got = r.json()
        assert all(e["paid"] is True for e in got)
        assert len(got) >= 1

        # filter patient_id
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient, "search": base})
        got = r.json()
        assert all(e.get("patient_id") == a_patient for e in got)
        assert len(got) >= 1

        # date range
        r = requests.get(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            params={"date_from": "2026-02-01", "date_to": "2026-02-28", "search": base},
        )
        got = r.json()
        assert all("2026-02-01" <= e["due_date"] <= "2026-02-28" for e in got)
        assert len(got) >= 2

        # installment_group
        r = requests.get(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            params={"installment_group_id": "grp_test_" + base},
        )
        got = r.json()
        assert len(got) >= 3
        assert all(e["installment_group_id"] == "grp_test_" + base for e in got)

        # combo: type=receita + paid=true + date_from/to
        r = requests.get(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            params={"type": "receita", "paid": "true", "date_from": "2026-02-01", "date_to": "2026-02-28", "search": base},
        )
        got = r.json()
        assert all(e["type"] == "receita" and e["paid"] and "2026-02-01" <= e["due_date"] <= "2026-02-28" for e in got)

        # cleanup
        for eid in made:
            requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))


# =================== INSTALLMENTS via finalize ===================
class TestInstallmentsFlow:
    def _mk_appointment(self, admin_token, patient_id, price=1200):
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        end = start + timedelta(minutes=30)
        r = requests.post(
            f"{API}/appointments",
            headers=_h(admin_token),
            json={
                "patient_id": patient_id,
                "procedure": "TEST_2_5_proc",
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
                "price": price,
                "status": "agendado",
            },
        )
        assert r.status_code in (200, 201), r.text
        return r.json()["appointment_id"]

    def _start_attendance(self, token, appointment_id):
        r = requests.post(f"{API}/attendance/start", headers=_h(token), json={"appointment_id": appointment_id})
        assert r.status_code == 200, r.text
        return r.json()["session_id"]

    def _cleanup_entries(self, admin_token, entry_ids):
        for eid in entry_ids:
            try:
                requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))
            except Exception:
                pass

    def test_nao_pago_creates_n_installments(self, admin_token, bella_token, a_patient):
        apt = self._mk_appointment(admin_token, a_patient, price=1200)
        sid = self._start_attendance(bella_token, apt)
        r = requests.post(
            f"{API}/attendance/{sid}/finalize",
            headers=_h(bella_token),
            json={
                "payment_status": "nao_pago",
                "amount_total": 1200,
                "payment_method": "parcelado",
                "installments": 6,
                "installment_interval_days": 30,
                "due_date": "2026-03-01",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        entry_ids = body["financial_entries"]
        assert len(entry_ids) == 6

        # fetch each entry
        r2 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        all_entries = r2.json()
        made = [e for e in all_entries if e["entry_id"] in entry_ids]
        assert len(made) == 6

        # same installment_group_id starting with grp_
        group_ids = {e["installment_group_id"] for e in made}
        assert len(group_ids) == 1
        gid = next(iter(group_ids))
        assert gid.startswith("grp_"), f"group_id={gid}"

        # numbers 1..6, total=6
        numbers = sorted(e["installment_number"] for e in made)
        assert numbers == [1, 2, 3, 4, 5, 6]
        assert all(e["installment_total"] == 6 for e in made)

        # due_dates increment 30 days
        by_num = {e["installment_number"]: e for e in made}
        expected_dates = ["2026-03-01", "2026-03-31", "2026-04-30", "2026-05-30", "2026-06-29", "2026-07-29"]
        actual = [by_num[i]["due_date"] for i in range(1, 7)]
        assert actual == expected_dates, f"got {actual}"

        # amount ~200 each (last may absorb remainder)
        total = round(sum(e["amount"] for e in made), 2)
        assert total == 1200
        assert all(abs(e["amount"] - 200) < 0.5 for e in made)

        # patient_id + appointment_id populated
        assert all(e["patient_id"] == a_patient for e in made)
        assert all(e["appointment_id"] == apt for e in made)

        # professional_id + procedure_id fields exist (may be None but keys present)
        for e in made:
            assert "professional_id" in e
            assert "procedure_id" in e

        self._cleanup_entries(admin_token, entry_ids)

    def test_parcial_creates_entrada_plus_n_balance_parcelas(self, admin_token, bella_token, a_patient):
        apt = self._mk_appointment(admin_token, a_patient, price=1000)
        sid = self._start_attendance(bella_token, apt)
        r = requests.post(
            f"{API}/attendance/{sid}/finalize",
            headers=_h(bella_token),
            json={
                "payment_status": "parcial",
                "amount_total": 1000,
                "amount_paid": 400,
                "installments": 3,
                "installment_interval_days": 30,
            },
        )
        assert r.status_code == 200, r.text
        eids = r.json()["financial_entries"]
        assert len(eids) == 4  # 1 entrada + 3 parcelas

        # fetch back
        r2 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        made = [e for e in r2.json() if e["entry_id"] in eids]
        entrada = [e for e in made if e["installment_number"] == 0]
        parcelas = [e for e in made if e["installment_number"] in (1, 2, 3)]
        assert len(entrada) == 1
        assert entrada[0]["paid"] is True
        assert entrada[0]["amount"] == 400
        assert len(parcelas) == 3
        # same group id for all 4
        gids = {e["installment_group_id"] for e in made}
        assert len(gids) == 1
        # each parcela ~= 200
        assert all(e["installment_total"] == 3 for e in parcelas)
        assert round(sum(e["amount"] for e in parcelas), 2) == 600
        assert all(abs(e["amount"] - 200) < 0.5 for e in parcelas)
        assert all(e["paid"] is False for e in parcelas)

        self._cleanup_entries(admin_token, eids)

    def test_pago_creates_single_entry(self, admin_token, bella_token, a_patient):
        apt = self._mk_appointment(admin_token, a_patient, price=500)
        sid = self._start_attendance(bella_token, apt)
        r = requests.post(
            f"{API}/attendance/{sid}/finalize",
            headers=_h(bella_token),
            json={"payment_status": "pago", "amount_total": 500},
        )
        assert r.status_code == 200, r.text
        eids = r.json()["financial_entries"]
        assert len(eids) == 1
        r2 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        made = [e for e in r2.json() if e["entry_id"] in eids]
        assert len(made) == 1
        e = made[0]
        assert e["paid"] is True
        assert e.get("paid_at")
        assert e["installment_group_id"] == e["entry_id"]
        assert e["installment_number"] == 1
        assert e["installment_total"] == 1
        assert e["amount"] == 500

        self._cleanup_entries(admin_token, eids)

    def test_finalize_default_installments_backward_compat(self, admin_token, bella_token, a_patient):
        """Regression: finalize without 'installments' (default=1) still produces installment_number=1, total=1."""
        apt = self._mk_appointment(admin_token, a_patient, price=200)
        sid = self._start_attendance(bella_token, apt)
        r = requests.post(
            f"{API}/attendance/{sid}/finalize",
            headers=_h(bella_token),
            json={"payment_status": "nao_pago", "amount_total": 200, "due_date": "2026-04-01"},
        )
        assert r.status_code == 200
        eids = r.json()["financial_entries"]
        assert len(eids) == 1
        r2 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        made = [e for e in r2.json() if e["entry_id"] in eids]
        e = made[0]
        assert e["installment_number"] == 1
        assert e["installment_total"] == 1
        self._cleanup_entries(admin_token, eids)


# =================== BUDGET PUBLIC APPROVAL + generate-charges ===================
class TestBudgetApprovalAndCharges:
    def _mk_budget(self, admin_token, a_patient, installments=4, total=800):
        # 4 items × 200 = 800 (uses unit_price × quantity)
        r = requests.post(
            f"{API}/budgets",
            headers=_h(admin_token),
            json={
                "patient_id": a_patient,
                "items": [{"name": "Sessão", "quantity": 1, "unit_price": total}],
                "payment_method": "parcelado",
                "installments": installments,
                "status": "rascunho",
            },
        )
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_public_approval_sets_pending_charge_generation_and_no_entries_created(
        self, admin_token, a_patient
    ):
        b = self._mk_budget(admin_token, a_patient, installments=4, total=800)
        bid = b["budget_id"]
        # get public link
        r = requests.get(f"{API}/budgets/{bid}/public-link", headers=_h(admin_token))
        assert r.status_code == 200
        token = r.json()["token"]
        # public approval
        r2 = requests.post(
            f"{API}/public/budgets/{token}/sign",
            json={"action": "aprovar", "signature": "data:image/png;base64,iVBORw0KGgo="},
        )
        assert r2.status_code == 200
        # reload budget
        r3 = requests.get(f"{API}/budgets/{bid}", headers=_h(admin_token))
        assert r3.status_code == 200
        doc = r3.json()
        assert doc["status"] == "aprovado"
        assert doc.get("pending_charge_generation") is True
        # No financial entries yet
        r4 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        entries_for_budget = [e for e in r4.json() if e.get("budget_id") == bid]
        assert entries_for_budget == [], f"expected no entries yet, got {entries_for_budget}"

        # Now generate charges manually
        r5 = requests.post(
            f"{API}/budgets/{bid}/generate-charges",
            headers=_h(admin_token),
            json={"installments": 4, "installment_interval_days": 30, "first_due_date": "2026-03-01"},
        )
        assert r5.status_code == 200, r5.text
        body = r5.json()
        assert body["already_generated"] is False
        assert len(body["financial_entries"]) == 4

        # reload budget: pending false + charges_generated_at set
        r6 = requests.get(f"{API}/budgets/{bid}", headers=_h(admin_token))
        d2 = r6.json()
        assert d2.get("pending_charge_generation") is False
        assert d2.get("charges_generated_at")

        # Idempotent — call again returns same entries
        r7 = requests.post(
            f"{API}/budgets/{bid}/generate-charges",
            headers=_h(admin_token),
            json={"installments": 4, "installment_interval_days": 30, "first_due_date": "2026-03-01"},
        )
        assert r7.status_code == 200
        body2 = r7.json()
        assert body2["already_generated"] is True
        assert set(body2["financial_entries"]) == set(body["financial_entries"])

        # Sanity: still 4 entries, not 8
        r8 = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"patient_id": a_patient})
        for_bud = [e for e in r8.json() if e.get("budget_id") == bid]
        assert len(for_bud) == 4

        # cleanup
        for eid in body["financial_entries"]:
            requests.delete(f"{API}/finance/entries/{eid}", headers=_h(admin_token))
        requests.delete(f"{API}/budgets/{bid}", headers=_h(admin_token))

    def test_idempotency_when_manual_entry_already_linked(self, admin_token, a_patient):
        """If a manual finance entry with budget_id exists before generate-charges, it returns already_generated=True."""
        b = self._mk_budget(admin_token, a_patient, installments=2, total=300)
        bid = b["budget_id"]
        # approve via update budget status (admin has permission via update)
        # simpler: approve via public link
        tok = requests.get(f"{API}/budgets/{bid}/public-link", headers=_h(admin_token)).json()["token"]
        requests.post(f"{API}/public/budgets/{tok}/sign", json={"action": "aprovar"})

        # Manually create a finance entry linked to this budget BEFORE generate-charges
        r = requests.post(
            f"{API}/finance/entries",
            headers=_h(admin_token),
            json={
                "type": "receita", "category": "Manual",
                "description": "TEST_manual_before_gen",
                "amount": 300, "due_date": "2026-03-05",
                "budget_id": bid,
            },
        )
        assert r.status_code in (200, 201)
        manual_eid = r.json()["entry_id"]

        # Now generate-charges must NOT create duplicates
        r2 = requests.post(f"{API}/budgets/{bid}/generate-charges", headers=_h(admin_token), json={})
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["already_generated"] is True
        assert manual_eid in b2["financial_entries"]

        # cleanup
        requests.delete(f"{API}/finance/entries/{manual_eid}", headers=_h(admin_token))
        requests.delete(f"{API}/budgets/{bid}", headers=_h(admin_token))


# =================== DASHBOARD REGRESSION ===================
class TestDashboardRegression:
    def test_dashboard_stats_returns_revenue_month(self, admin_token):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        assert "revenue_month" in data
        assert isinstance(data["revenue_month"], (int, float))

    def test_finance_summary_shape(self, admin_token):
        r = requests.get(f"{API}/finance/summary", headers=_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        for k in ("receitas", "despesas", "saldo", "a_receber", "a_pagar", "chart"):
            assert k in data
        assert isinstance(data["chart"], list)
        assert len(data["chart"]) == 6
        for row in data["chart"]:
            assert "mes" in row and "receita" in row and "despesa" in row


# =================== INDEXES (best-effort) ===================
class TestIndexes:
    def test_no_duplicate_entry_ids_in_lists(self, admin_token):
        # A weak check that entry_id unique index is in effect (no duplicates in listing).
        r = requests.get(f"{API}/finance/entries", headers=_h(admin_token), params={"limit": 500})
        assert r.status_code == 200
        ids = [e["entry_id"] for e in r.json()]
        assert len(ids) == len(set(ids))
