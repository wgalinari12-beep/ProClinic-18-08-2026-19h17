"""
Phase 2 — Integridade Clínica e Prontuário
- ficha_snapshot em medical_records (finalize_attendance)
- GET /api/patients/{patient_id}/timeline
Reference: iteration_16 request
"""
import os
import uuid
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
def lais_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "dra.lais@proclinic.com", "password": "lais123"},
                      timeout=TIMEOUT)
    if r.status_code != 200:
        pytest.skip("dra.lais nao disponivel")
    return r.json()["token"]


@pytest.fixture(scope="module")
def ana_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "ana.recep@proclinic.com", "password": "ana123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def bella_user(bella_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(bella_token), timeout=TIMEOUT)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def fresh_patient(admin_token):
    """Cria um paciente NOVO isolado para os testes de timeline (evitar poluição de dados)."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_P2_INT_{suffix}",
        "phone": "11955554444",
        "email": f"test_p2int_{suffix}@example.com",
        "birthdate": "1990-01-01",
    }
    r = requests.post(f"{BASE_URL}/api/patients", json=payload,
                      headers=H(admin_token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_appt(token, patient, professional_user):
    now = datetime.now(timezone.utc)
    payload = {
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name"),
        "procedure": "Atendimento Fase 2",
        "professional_id": professional_user["user_id"],
        "professional_name": professional_user.get("name"),
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
                      json={"appointment_id": appt_id},
                      headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


def _save_module(token, patient_id, module, answers):
    r = requests.post(f"{BASE_URL}/api/anamnesis-modules",
                      json={"patient_id": patient_id, "module": module,
                            "answers": answers, "photos": []},
                      headers=H(token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _finalize(token, sid, amount=100):
    r = requests.post(f"{BASE_URL}/api/attendance/{sid}/finalize",
                      json={"payment_status": "pago", "amount_total": amount},
                      headers=H(token), timeout=TIMEOUT)
    return r


# ==================== FICHA SNAPSHOT ====================
class TestFichaSnapshot:
    def test_ficha_snapshot_captured_on_finalize(self, bella_token, bella_user, admin_token):
        # patient dedicado
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_SNAP_{uuid.uuid4().hex[:6]}",
                                "phone": "11999998888", "birthdate": "1985-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201)
        pat = r.json()

        apt = _make_appt(bella_token, pat, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])

        # criar 2 modulos
        _save_module(bella_token, pat["patient_id"], "geral",
                     {"queixa_principal": "Teste TESTE_geral", "historia_clinica": "Nenhuma"})
        _save_module(bella_token, pat["patient_id"], "facial", {"pele": "Mista"})

        r = _finalize(bella_token, sid)
        assert r.status_code == 200, r.text

        # GET medical-records
        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={pat['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        assert mr.status_code == 200
        recs = mr.json()
        # pegar o record com session_id == sid
        rec = next((x for x in recs if x.get("session_id") == sid), None)
        assert rec is not None, f"no record with session_id={sid}"
        snap = rec.get("ficha_snapshot")
        assert isinstance(snap, dict), f"ficha_snapshot must be dict, got {type(snap)}"
        assert "geral" in snap, f"snap keys: {list(snap.keys())}"
        assert "facial" in snap
        assert snap["geral"]["answers"]["queixa_principal"] == "Teste TESTE_geral"
        assert snap["facial"]["answers"]["pele"] == "Mista"
        # cada snap tem answers, photos, captured_at
        for k in ("geral", "facial"):
            assert "answers" in snap[k]
            assert "photos" in snap[k]
            assert "captured_at" in snap[k]

    def test_ficha_snapshot_empty_when_no_modules(self, bella_token, bella_user, admin_token):
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_SNAP_EMPTY_{uuid.uuid4().hex[:6]}",
                                "phone": "11977776666", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201)
        pat = r.json()

        apt = _make_appt(bella_token, pat, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])

        r = _finalize(bella_token, sid)
        assert r.status_code == 200, r.text

        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={pat['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        assert mr.status_code == 200
        rec = next((x for x in mr.json() if x.get("session_id") == sid), None)
        assert rec is not None
        snap = rec.get("ficha_snapshot")
        assert snap == {}, f"expected empty dict, got {snap}"

    def test_ficha_snapshot_isolation_by_professional(
        self, bella_token, bella_user, lais_token, admin_token
    ):
        """dra.bella cria modulos; dra.lais cria seus proprios; ao finalizar como bella,
        ficha_snapshot inclui apenas modulos criados por bella (role=profissional)."""
        # patient
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_SNAP_ISO_{uuid.uuid4().hex[:6]}",
                                "phone": "11966665555", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 201)
        pat = r.json()

        # bella cria modulo geral
        _save_module(bella_token, pat["patient_id"], "geral",
                     {"queixa_principal": "por_bella"})
        # lais cria modulo facial (proprio)
        _save_module(lais_token, pat["patient_id"], "facial",
                     {"pele": "por_lais"})

        # bella finaliza
        apt = _make_appt(bella_token, pat, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        r = _finalize(bella_token, sid)
        assert r.status_code == 200, r.text

        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={pat['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        rec = next((x for x in mr.json() if x.get("session_id") == sid), None)
        assert rec is not None
        snap = rec["ficha_snapshot"]
        # bella so vê o proprio (geral). facial (de lais) NAO deve aparecer
        assert "geral" in snap
        assert snap["geral"]["answers"].get("queixa_principal") == "por_bella"
        assert "facial" not in snap, f"leak! facial (lais) apareceu em snap de bella: {snap}"

    def test_ficha_snapshot_admin_sees_all_modules(
        self, admin_token, bella_token, lais_token
    ):
        """Admin finalizando: ficha_snapshot inclui TODOS os módulos (sem filtro created_by)."""
        # patient
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_SNAP_ADM_{uuid.uuid4().hex[:6]}",
                                "phone": "11955553333", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        pat = r.json()

        # bella cria modulo geral
        _save_module(bella_token, pat["patient_id"], "geral", {"q": "b"})
        # lais cria modulo facial
        _save_module(lais_token, pat["patient_id"], "facial", {"p": "l"})

        # admin precisa de um professional_id — usar admin como profissional
        admin_me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(admin_token), timeout=TIMEOUT).json()
        apt = _make_appt(admin_token, pat, admin_me)
        sid = _start_session(admin_token, apt["appointment_id"])
        r = _finalize(admin_token, sid)
        assert r.status_code == 200, r.text

        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={pat['patient_id']}",
                          headers=H(admin_token), timeout=TIMEOUT)
        rec = next((x for x in mr.json() if x.get("session_id") == sid), None)
        assert rec is not None
        snap = rec["ficha_snapshot"]
        assert "geral" in snap, snap
        assert "facial" in snap, snap  # admin vê ambos


# ==================== TIMELINE ENDPOINT ====================
class TestTimelineStructure:
    def test_timeline_404_nonexistent(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/patients/inexistente_id_xyz/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 404

    def test_timeline_top_level_shape(self, admin_token, fresh_patient):
        r = requests.get(f"{BASE_URL}/api/patients/{fresh_patient['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "patient" in data
        assert "sessions" in data
        assert "legacy_records" in data
        assert "counts" in data
        assert data["patient"]["patient_id"] == fresh_patient["patient_id"]
        assert data["patient"]["name"] == fresh_patient["name"]
        # counts keys
        for k in ("sessions", "concluidas", "em_andamento", "legacy"):
            assert k in data["counts"]


class TestTimelineSessions:
    @pytest.fixture(scope="class")
    def scenario(self, admin_token, bella_token, bella_user):
        """Cria paciente + 3 sessions finalizadas + 1 em andamento."""
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_TL_{uuid.uuid4().hex[:6]}",
                                "phone": "11944443333", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        pat = r.json()

        # criar modulo
        _save_module(bella_token, pat["patient_id"], "geral",
                     {"queixa_principal": "TL_test"})

        finalized_sids = []
        for i in range(3):
            apt = _make_appt(bella_token, pat, bella_user)
            sid = _start_session(bella_token, apt["appointment_id"])
            r = _finalize(bella_token, sid, amount=50 + i * 10)
            assert r.status_code == 200, r.text
            finalized_sids.append(sid)

        # 1 em andamento
        apt_open = _make_appt(bella_token, pat, bella_user)
        sid_open = _start_session(bella_token, apt_open["appointment_id"])

        return {"patient": pat, "finalized": finalized_sids, "open": sid_open}

    def test_timeline_session_fields(self, admin_token, scenario):
        r = requests.get(f"{BASE_URL}/api/patients/{scenario['patient']['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        sessions = data["sessions"]
        assert len(sessions) >= 4  # 3 finalizadas + 1 open

        required = {"session_id", "session_number", "status", "started_at",
                    "finalized_at", "duration_seconds", "procedure", "procedure_id",
                    "professional_id", "professional_name", "appointment",
                    "medical_record", "ficha_snapshot", "budget",
                    "financial_entries", "receipts", "signed_documents", "signatures"}
        for s in sessions:
            missing = required - set(s.keys())
            assert not missing, f"missing keys in session: {missing}"
            sig = s["signatures"]
            assert "consent" in sig and "evolution" in sig
            assert "consent_meta" in sig and "evolution_meta" in sig
            assert isinstance(sig["consent"], bool)
            assert isinstance(sig["evolution"], bool)
            assert isinstance(s["financial_entries"], list)
            assert isinstance(s["receipts"], list)
            assert isinstance(s["signed_documents"], list)

    def test_timeline_order_desc(self, admin_token, scenario):
        r = requests.get(f"{BASE_URL}/api/patients/{scenario['patient']['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        sessions = r.json()["sessions"]
        starts = [s["started_at"] for s in sessions if s.get("started_at")]
        assert starts == sorted(starts, reverse=True), f"not DESC: {starts}"

    def test_timeline_finalized_sessions_have_session_number(self, admin_token, scenario):
        r = requests.get(f"{BASE_URL}/api/patients/{scenario['patient']['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        sessions = r.json()["sessions"]
        finalized = [s for s in sessions if s["status"] == "concluido"]
        assert len(finalized) >= 3
        import re
        for s in finalized:
            assert s["medical_record"] is not None
            assert s["session_number"] is not None
            assert re.match(r"^ATT-\d{4}-\d{6}$", s["session_number"]), s["session_number"]

    def test_timeline_in_progress_session(self, admin_token, scenario):
        r = requests.get(f"{BASE_URL}/api/patients/{scenario['patient']['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        data = r.json()
        open_sess = next((s for s in data["sessions"] if s["session_id"] == scenario["open"]), None)
        assert open_sess is not None
        assert open_sess["status"] == "rascunho"
        assert open_sess["medical_record"] is None
        # ficha_snapshot em vôo — deve conter 'geral' criado antes
        assert isinstance(open_sess["ficha_snapshot"], dict)
        assert "geral" in open_sess["ficha_snapshot"]
        # counts.em_andamento >= 1
        assert data["counts"]["em_andamento"] >= 1
        assert data["counts"]["concluidas"] >= 3

    def test_timeline_receipts_derived(self, admin_token, scenario):
        r = requests.get(f"{BASE_URL}/api/patients/{scenario['patient']['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        sessions = r.json()["sessions"]
        # verificar coerencia receipts vs financial_entries
        for s in sessions:
            entries_with_receipt = [e for e in s["financial_entries"] if e.get("receipt_number")]
            assert len(s["receipts"]) == len(entries_with_receipt)
            # cada receipt tem os campos esperados
            for rec in s["receipts"]:
                assert "receipt_number" in rec
                assert "receipt_url" in rec
                assert "entry_id" in rec
                assert "amount" in rec


class TestTimelineRBAC:
    def test_timeline_professional_sees_only_own(
        self, bella_token, bella_user, lais_token, admin_token
    ):
        # patient
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_TL_RBAC_{uuid.uuid4().hex[:6]}",
                                "phone": "11933332222", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        pat = r.json()

        # bella cria uma session
        apt_b = _make_appt(bella_token, pat, bella_user)
        sid_b = _start_session(bella_token, apt_b["appointment_id"])
        _finalize(bella_token, sid_b)

        # lais cria outra
        lais_me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(lais_token), timeout=TIMEOUT).json()
        apt_l = _make_appt(lais_token, pat, lais_me)
        sid_l = _start_session(lais_token, apt_l["appointment_id"])
        _finalize(lais_token, sid_l)

        # bella vê só a dela
        r = requests.get(f"{BASE_URL}/api/patients/{pat['patient_id']}/timeline",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        sids_bella = {s["session_id"] for s in r.json()["sessions"]}
        assert sid_b in sids_bella
        assert sid_l not in sids_bella, "leak! bella vendo sessao de lais"

        # admin vê ambas
        r = requests.get(f"{BASE_URL}/api/patients/{pat['patient_id']}/timeline",
                         headers=H(admin_token), timeout=TIMEOUT)
        sids_admin = {s["session_id"] for s in r.json()["sessions"]}
        assert sid_b in sids_admin
        assert sid_l in sids_admin

    def test_timeline_recepcao_access(self, ana_token, fresh_patient):
        # Verifica comportamento — nao ha bloqueio explicito segundo spec
        r = requests.get(f"{BASE_URL}/api/patients/{fresh_patient['patient_id']}/timeline",
                         headers=H(ana_token), timeout=TIMEOUT)
        # comportamento atual: retornar 200 (não bloqueado). Aceitar 200 ou 403.
        assert r.status_code in (200, 403), r.text


class TestTimelineLegacy:
    def test_timeline_legacy_records(self, admin_token, bella_token):
        # patient
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_TL_LEG_{uuid.uuid4().hex[:6]}",
                                "phone": "11922221111", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        pat = r.json()

        # criar medical_record manualmente (SEM session_id) via POST /medical-records
        r = requests.post(f"{BASE_URL}/api/medical-records",
                          json={"patient_id": pat["patient_id"],
                                "procedure": "Legacy",
                                "evolution": "manual",
                                "observations": ""},
                          headers=H(bella_token), timeout=TIMEOUT)
        if r.status_code not in (200, 201):
            pytest.skip(f"POST /medical-records not accepting shape: {r.status_code} {r.text}")

        tl = requests.get(f"{BASE_URL}/api/patients/{pat['patient_id']}/timeline",
                          headers=H(admin_token), timeout=TIMEOUT)
        assert tl.status_code == 200
        data = tl.json()
        assert data["counts"]["legacy"] >= 1
        assert len(data["legacy_records"]) >= 1


# ==================== REGRESSION ====================
class TestRegression:
    def test_finalize_idempotence_snapshot_from_first(
        self, bella_token, bella_user, admin_token
    ):
        r = requests.post(f"{BASE_URL}/api/patients",
                          json={"name": f"TEST_IDEMP_{uuid.uuid4().hex[:6]}",
                                "phone": "11911110000", "birthdate": "1990-01-01"},
                          headers=H(admin_token), timeout=TIMEOUT)
        pat = r.json()
        apt = _make_appt(bella_token, pat, bella_user)
        sid = _start_session(bella_token, apt["appointment_id"])
        _save_module(bella_token, pat["patient_id"], "geral", {"q": "primeiro"})
        r1 = _finalize(bella_token, sid)
        assert r1.status_code == 200
        # add outro modulo (nao deve entrar no snapshot ja capturado)
        _save_module(bella_token, pat["patient_id"], "facial", {"p": "depois"})
        r2 = _finalize(bella_token, sid)
        assert r2.status_code == 200
        # idempotencia: nao deve criar segundo record
        mr = requests.get(f"{BASE_URL}/api/medical-records?patient_id={pat['patient_id']}",
                          headers=H(bella_token), timeout=TIMEOUT)
        recs = [x for x in mr.json() if x.get("session_id") == sid]
        assert len(recs) == 1, f"duplicate records: {len(recs)}"
        snap = recs[0]["ficha_snapshot"]
        assert "geral" in snap
        assert "facial" not in snap, "snapshot deveria ter sido tirado apenas na 1a finalizacao"

    def test_regression_medical_records_list(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/medical-records", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_regression_anamnesis_modules_list(self, bella_token, fresh_patient):
        r = requests.get(
            f"{BASE_URL}/api/anamnesis-modules?patient_id={fresh_patient['patient_id']}",
            headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_regression_finance_summary(self, admin_token, fresh_patient):
        r = requests.get(
            f"{BASE_URL}/api/finance/patient/{fresh_patient['patient_id']}/summary",
            headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
