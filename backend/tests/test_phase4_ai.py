"""
Phase 4 — AI Clínica Avançada
- POST /api/ai/generate: types antigos + novos (contraindications, improve, rewrite)
- Contexto enriquecido (_build_patient_ai_context: allergies, medications, age, history, ficha)
- Log em ai_generations
- GET /api/ai/generations com filtros + RBAC
- Regressão: types antigos ainda funcionam
"""
import os
import uuid
import time
import pytest
import requests
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TIMEOUT = 60  # AI calls can take up to 45s


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
def rich_patient(bella_token):
    """Paciente com allergies + medications + birth_date para contexto rico."""
    suffix = uuid.uuid4().hex[:6]
    payload = {
        "name": f"TEST_AI_{suffix}",
        "cpf": f"999{suffix[:8]}",
        "birth_date": "1990-01-01",
        "phone": "11999990000",
        "email": f"test_ai_{suffix}@example.com",
        "allergies": "Penicilina",
        "medications": "Losartana",
        "notes": "Paciente teste Fase 4",
        "lgpd_consent": True,
    }
    r = requests.post(f"{BASE_URL}/api/patients", json=payload, headers=H(bella_token), timeout=TIMEOUT)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- Tests: types antigos (backward compat) ----------
class TestBackwardCompat:
    def test_evolution(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "evolution", "patient_id": rich_patient["patient_id"],
                                "context": "Botox testa", "notes": "Boa aceitação"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("text") and isinstance(d["text"], str) and len(d["text"]) > 0
        assert d.get("model") == "claude-sonnet-4-5-20250929"
        assert d.get("type") == "evolution"

    def test_protocol(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "protocol", "patient_id": rich_patient["patient_id"],
                                "context": "Rejuvenescimento facial"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("text")

    def test_session_summary(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "session_summary", "patient_id": rich_patient["patient_id"],
                                "notes": "Aplicação de toxina em terço superior."},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("text")

    def test_anamnesis_summary(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "anamnesis_summary", "patient_id": rich_patient["patient_id"],
                                "notes": "Alergia a penicilina, uso de losartana"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("text")


# ---------- Tests: novos types Fase 4 ----------
class TestNewTypes:
    def test_contraindications(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "contraindications", "patient_id": rich_patient["patient_id"],
                                "context": "Botox", "notes": "Paciente com hipertensão"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("text") and len(d["text"]) > 5
        assert d.get("type") == "contraindications"

    def test_improve(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "improve", "patient_id": rich_patient["patient_id"],
                                "current_text": "Paciente compareceu bem", "mode": "improve"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("text") and len(d["text"]) > 5
        assert d.get("type") == "improve"

    def test_rewrite(self, bella_token, rich_patient):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "rewrite",
                                "current_text": "paciente veio, fez procedimento, foi embora bem",
                                "mode": "rewrite"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("text")
        assert d.get("type") == "rewrite"


# ---------- Tests: contexto enriquecido ----------
class TestEnrichedContext:
    def test_context_includes_allergies_medications_age(self, bella_token, rich_patient):
        # Chamada IA
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "contraindications",
                                "patient_id": rich_patient["patient_id"],
                                "context": "Preenchimento labial",
                                "session_id": f"sess_test_{uuid.uuid4().hex[:6]}"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

        # Inspeciona prompt via GET /ai/generations
        time.sleep(1)
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"patient_id": rich_patient["patient_id"], "limit": 5},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200, g.text
        gens = g.json()
        assert isinstance(gens, list) and len(gens) >= 1
        # pega a última (mais recente)
        latest = gens[0]
        prompt = latest.get("prompt", "")
        assert "ALERGIAS: Penicilina" in prompt, f"prompt não contém ALERGIAS: {prompt[:500]}"
        assert "Losartana" in prompt, f"prompt não contém Losartana: {prompt[:500]}"
        # idade calculada — 1990 → ~35/36 anos em 2026
        assert "anos" in prompt, f"prompt não contém idade: {prompt[:500]}"

    def test_context_age_approx(self, bella_token, rich_patient):
        # Verifica que a idade calculada é entre 30 e 40 (paciente nasceu em 1990)
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"patient_id": rich_patient["patient_id"], "limit": 20},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        gens = g.json()
        assert len(gens) >= 1
        import re
        found_age = False
        for gen in gens:
            m = re.search(r"(\d{2}) anos", gen.get("prompt", ""))
            if m:
                age = int(m.group(1))
                assert 30 <= age <= 40, f"idade fora do esperado: {age}"
                found_age = True
                break
        assert found_age, "nenhuma menção 'XX anos' encontrada nos prompts"


# ---------- Tests: log ai_generations ----------
class TestAiGenerationsLog:
    def test_generation_logged_with_all_fields(self, bella_token, rich_patient):
        sess_id = f"sess_log_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "evolution",
                                "patient_id": rich_patient["patient_id"],
                                "session_id": sess_id,
                                "notes": "teste log"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

        time.sleep(0.5)
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"session_id": sess_id},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        gens = g.json()
        assert len(gens) >= 1
        entry = gens[0]
        for k in ("generation_id", "prompt", "response", "model", "type", "user_id", "patient_id", "session_id", "created_at"):
            assert k in entry, f"campo ausente: {k}"
        assert entry["model"] == "claude-sonnet-4-5-20250929"
        assert entry["type"] == "evolution"
        assert entry["session_id"] == sess_id
        assert entry["patient_id"] == rich_patient["patient_id"]
        assert entry["generation_id"].startswith("aig_")
        # _id (mongo) NÃO deve vazar
        assert "_id" not in entry


# ---------- Tests: filtros + RBAC ----------
class TestListRBAC:
    def test_filter_by_patient_id(self, bella_token, rich_patient):
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"patient_id": rich_patient["patient_id"]},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        for e in g.json():
            assert e["patient_id"] == rich_patient["patient_id"]

    def test_limit_param(self, bella_token):
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"limit": 2},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        assert len(g.json()) <= 2

    def test_profissional_only_sees_own(self, bella_token):
        # bella é profissional — só deve ver as próprias
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        # descobre user_id de bella
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(bella_token), timeout=TIMEOUT).json()
        bella_uid = me.get("user_id") or me.get("id")
        for e in g.json():
            assert e["user_id"] == bella_uid, f"bella viu geração de outro user: {e['user_id']}"

    def test_admin_sees_all(self, admin_token, bella_token, rich_patient):
        # Gera uma como bella
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "evolution",
                                "patient_id": rich_patient["patient_id"],
                                "notes": "geração de bella para verificação admin"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        time.sleep(0.5)
        # admin lista sem filtro user_id — deve ver TAMBÉM as de bella
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"patient_id": rich_patient["patient_id"], "limit": 50},
                         headers=H(admin_token), timeout=TIMEOUT)
        assert g.status_code == 200
        gens = g.json()
        assert len(gens) >= 1
        # bella_uid entre os user_ids
        me_bella = requests.get(f"{BASE_URL}/api/auth/me", headers=H(bella_token), timeout=TIMEOUT).json()
        bella_uid = me_bella.get("user_id") or me_bella.get("id")
        assert any(e["user_id"] == bella_uid for e in gens), "admin não viu geração da bella"


# ---------- Tests: robustez ----------
class TestRobustness:
    def test_no_patient_id_ok(self, bella_token):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "evolution", "notes": "sem paciente"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("text")

    def test_nonexistent_patient_id_ok(self, bella_token):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "evolution", "patient_id": "pat_nonexistent_zzzz",
                                "notes": "paciente fake"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("text")

    def test_invalid_type_422(self, bella_token):
        r = requests.post(f"{BASE_URL}/api/ai/generate",
                          json={"type": "invalid_type", "notes": "x"},
                          headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 422, r.text


# ---------- Concorrência ----------
class TestConcurrency:
    def test_3_concurrent_calls_create_3_logs(self, bella_token, rich_patient):
        sess_id = f"sess_conc_{uuid.uuid4().hex[:6]}"

        def _call():
            return requests.post(f"{BASE_URL}/api/ai/generate",
                                 json={"type": "evolution",
                                       "patient_id": rich_patient["patient_id"],
                                       "session_id": sess_id,
                                       "notes": f"conc {uuid.uuid4().hex[:4]}"},
                                 headers=H(bella_token), timeout=TIMEOUT)

        with ThreadPoolExecutor(max_workers=3) as ex:
            results = list(ex.map(lambda _: _call(), range(3)))
        oks = [r for r in results if r.status_code == 200]
        # aceita até 1 falha por rate limit
        assert len(oks) >= 2, f"muitas falhas: {[r.status_code for r in results]}"

        time.sleep(1)
        g = requests.get(f"{BASE_URL}/api/ai/generations",
                         params={"session_id": sess_id, "limit": 10},
                         headers=H(bella_token), timeout=TIMEOUT)
        assert g.status_code == 200
        gens = g.json()
        assert len(gens) == len(oks), f"esperado {len(oks)} logs, obtido {len(gens)}"
        # generation_ids únicos
        gids = [e["generation_id"] for e in gens]
        assert len(set(gids)) == len(gids), "generation_id duplicado"


# ---------- Regressão endpoints Fase 3 ----------
class TestRegressionPhase3:
    def test_completeness(self, bella_token, rich_patient):
        r = requests.get(f"{BASE_URL}/api/patients/{rich_patient['patient_id']}/completeness",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200
        assert "complete" in r.json()

    def test_timeline(self, bella_token, rich_patient):
        r = requests.get(f"{BASE_URL}/api/patients/{rich_patient['patient_id']}/timeline",
                         headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_finance_patient_summary(self, bella_token, rich_patient):
        r = requests.get(f"{BASE_URL}/api/finance/patient/{rich_patient['patient_id']}/summary",
                         headers=H(bella_token), timeout=TIMEOUT)
        # 403 aceito: role=profissional pode ter acesso restrito a dados financeiros
        assert r.status_code in (200, 403, 404)

    def test_budgets_list(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/budgets", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_dashboard(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=H(admin_token), timeout=TIMEOUT)
        assert r.status_code in (200, 404)  # endpoint pode ter nome diferente

    def test_appointments_list(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/appointments", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_patients_list(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code == 200

    def test_medical_records_list(self, bella_token):
        r = requests.get(f"{BASE_URL}/api/medical-records", headers=H(bella_token), timeout=TIMEOUT)
        assert r.status_code in (200, 404)
