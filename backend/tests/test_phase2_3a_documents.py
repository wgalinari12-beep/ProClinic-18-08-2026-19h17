"""Phase 2.3A — Documentos Jurídicos: backend test suite.

Covers:
- Variables list + RBAC (admin write, recepcao blocked, profissional read-only)
- Template CRUD
- Document creation with variable substitution (PACIENTE_NOME, PROFISSIONAL_NOME,
  CLINICA_NOME, PROCEDIMENTO, VALOR_PROCEDIMENTO formatted as 'R$ 1.500,00',
  DATA_ATUAL dd/mm/yyyy) and markdown→HTML conversion (h2/strong/ul)
- Sign patient/professional + finalize → PDF via xhtml2pdf + signed URL
- Sigilo: profissional só vê seus próprios; admin vê todos
- Recepcao: 403 em document-templates/documents
- Public endpoints: GET, sign-patient, validate
- Audit log: created, viewed, signed_patient, signed_professional, finalized
"""
import os
import re
import requests
import pytest
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@proclinic.com", "password": "admin123"}
BELLA = {"email": "dra.bella@proclinic.com", "password": "bella123"}
LAIS = {"email": "dra.lais@proclinic.com", "password": "lais123"}
RECEP = {"email": "ana.recep@proclinic.com", "password": "ana123"}

FAKE_SIG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0"
    "lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

TEMPLATE_MD = """# Termo de Consentimento

## Identificação
Paciente: **{{PACIENTE_NOME}}**
Profissional: **{{PROFISSIONAL_NOME}}**
Clínica: **{{CLINICA_NOME}}**
Data: {{DATA_ATUAL}}

## Procedimento
- Procedimento: {{PROCEDIMENTO}}
- Valor: {{VALOR_PROCEDIMENTO}}

## Termo
Declaro estar ciente do procedimento.
"""


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    body = r.json()
    return body.get("access_token") or body["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": _login(ADMIN),
        "bella": _login(BELLA),
        "lais": _login(LAIS),
        "recep": _login(RECEP),
    }


@pytest.fixture(scope="module")
def patient_id(tokens):
    r = requests.get(f"{API}/patients", headers=_h(tokens["admin"]), timeout=15)
    assert r.status_code == 200
    pats = r.json()
    assert len(pats) > 0, "Nenhum paciente seed disponível"
    return pats[0]["patient_id"]


@pytest.fixture(scope="module")
def admin_template(tokens):
    body = {
        "name": "TEST_ Termo Phase2.3A",
        "category": "consentimento",
        "content_md": TEMPLATE_MD,
        "description": "test template",
        "active": True,
    }
    r = requests.post(f"{API}/document-templates", headers=_h(tokens["admin"]), json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Variables ----------
class TestVariables:
    def test_variables_list(self, tokens):
        r = requests.get(f"{API}/document-templates/variables", headers=_h(tokens["admin"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "variables" in data
        vars_ = data["variables"]
        assert isinstance(vars_, list)
        assert len(vars_) == 16, f"Esperado 16 variáveis, recebido {len(vars_)}"
        for required in ["PACIENTE_NOME", "PROFISSIONAL_NOME", "CLINICA_NOME",
                         "DATA_ATUAL", "PROCEDIMENTO", "VALOR_PROCEDIMENTO"]:
            assert required in vars_

    def test_variables_recepcao_forbidden(self, tokens):
        r = requests.get(f"{API}/document-templates/variables", headers=_h(tokens["recep"]), timeout=10)
        assert r.status_code == 403


# ---------- 2. Templates RBAC ----------
class TestTemplatesRBAC:
    def test_admin_create(self, admin_template):
        assert admin_template["template_id"].startswith("tpl_")
        assert admin_template["category"] == "consentimento"
        assert admin_template["active"] is True

    def test_profissional_can_list(self, tokens, admin_template):
        r = requests.get(f"{API}/document-templates", headers=_h(tokens["bella"]), timeout=10)
        assert r.status_code == 200
        ids = [t["template_id"] for t in r.json()]
        assert admin_template["template_id"] in ids

    def test_profissional_cannot_create(self, tokens):
        body = {"name": "TEST_ deny", "category": "outro", "content_md": "x"}
        r = requests.post(f"{API}/document-templates", headers=_h(tokens["bella"]), json=body, timeout=10)
        assert r.status_code == 403

    def test_recepcao_get_forbidden(self, tokens):
        r = requests.get(f"{API}/document-templates", headers=_h(tokens["recep"]), timeout=10)
        assert r.status_code == 403


# ---------- 3. Document creation: variable substitution + markdown→HTML ----------
class TestDocumentCreation:
    def test_create_substitutes_variables(self, tokens, admin_template, patient_id):
        body = {
            "template_id": admin_template["template_id"],
            "patient_id": patient_id,
            "procedure": "Limpeza de pele profunda",
            "procedure_value": 1500.0,
        }
        r = requests.post(f"{API}/documents", headers=_h(tokens["bella"]), json=body, timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["status"] == "rascunho"
        assert doc["document_id"].startswith("doc_")
        # Persist for later tests
        TestDocumentCreation.doc = doc

        md_rendered = doc["content_md"]
        # Nenhum placeholder {{...}} deve sobrar
        assert "{{" not in md_rendered and "}}" not in md_rendered

        # Substitutions
        assert doc["patient_name"] in md_rendered
        assert doc["professional_name"] in md_rendered  # bella
        assert "Bella" in md_rendered or "bella" in md_rendered.lower()
        ctx = doc["context"]
        # PROCEDIMENTO + VALOR formatado
        assert "Limpeza de pele profunda" in md_rendered
        assert "R$ 1.500,00" in md_rendered, f"VALOR mal formatado em: {md_rendered}"
        assert ctx["VALOR_PROCEDIMENTO"] == "R$ 1.500,00"
        # DATA_ATUAL dd/mm/yyyy
        assert re.match(r"^\d{2}/\d{2}/\d{4}$", ctx["DATA_ATUAL"]), ctx["DATA_ATUAL"]
        # CLINICA_NOME presente
        assert ctx["CLINICA_NOME"]

    def test_content_html_has_markdown(self, tokens, admin_template, patient_id):
        # Re-use document created above
        doc = TestDocumentCreation.doc
        html = doc["content_html"]
        assert "<h2>" in html, html[:300]
        assert "<strong>" in html
        assert "<ul>" in html and "<li>" in html


# ---------- 4. Signing + Finalize + Signed URL ----------
class TestSignFinalize:
    def test_finalize_without_signatures_400(self, tokens):
        doc = TestDocumentCreation.doc
        r = requests.post(
            f"{API}/documents/{doc['document_id']}/finalize",
            headers=_h(tokens["bella"]), timeout=15,
        )
        assert r.status_code == 400

    def test_sign_patient(self, tokens):
        doc = TestDocumentCreation.doc
        r = requests.put(
            f"{API}/documents/{doc['document_id']}/sign-patient",
            headers=_h(tokens["bella"]),
            json={"signature": FAKE_SIG, "device": "desktop"},
            timeout=10,
        )
        assert r.status_code == 200
        # GET to verify
        g = requests.get(f"{API}/documents/{doc['document_id']}", headers=_h(tokens["bella"]), timeout=10)
        body = g.json()
        assert body["patient_signature"] == FAKE_SIG
        assert body["signed_patient_at"]
        assert body["patient_sign_device"] == "desktop"
        # IP capturado pelo backend (request.client.host); ok se string
        assert "patient_sign_ip" in body

    def test_sign_professional(self, tokens):
        doc = TestDocumentCreation.doc
        r = requests.put(
            f"{API}/documents/{doc['document_id']}/sign-professional",
            headers=_h(tokens["bella"]),
            json={"signature": FAKE_SIG, "device": "tablet"},
            timeout=10,
        )
        assert r.status_code == 200
        g = requests.get(f"{API}/documents/{doc['document_id']}", headers=_h(tokens["bella"]), timeout=10)
        body = g.json()
        assert body["professional_signature"] == FAKE_SIG
        assert body["signed_professional_at"]
        assert body["professional_sign_device"] == "tablet"

    def test_finalize_generates_pdf(self, tokens):
        doc = TestDocumentCreation.doc
        r = requests.post(
            f"{API}/documents/{doc['document_id']}/finalize",
            headers=_h(tokens["bella"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        final = r.json()
        assert final["status"] == "finalizado"
        assert final["pdf_url"].startswith("/api/files/")
        assert "sig=" in final["pdf_url"]
        TestSignFinalize.pdf_url = final["pdf_url"]
        TestSignFinalize.public_token = final.get("public_token")

    def test_pdf_download_no_auth(self):
        # signed URL must be fetchable WITHOUT Authorization
        url = f"{BASE_URL}{TestSignFinalize.pdf_url}"
        r = requests.get(url, timeout=30)
        assert r.status_code == 200, f"PDF fetch failed: {r.status_code}"
        assert r.headers.get("Content-Type", "").startswith("application/pdf")
        assert len(r.content) > 1024, f"PDF muito pequeno: {len(r.content)} bytes"


# ---------- 5. Sigilo entre profissionais ----------
class TestSigilo:
    def test_other_profissional_cannot_list(self, tokens):
        # lais não deve ver o doc criado por bella
        r = requests.get(f"{API}/documents", headers=_h(tokens["lais"]), timeout=10)
        assert r.status_code == 200
        ids = [d["document_id"] for d in r.json()]
        assert TestDocumentCreation.doc["document_id"] not in ids

    def test_other_profissional_cannot_get(self, tokens):
        r = requests.get(
            f"{API}/documents/{TestDocumentCreation.doc['document_id']}",
            headers=_h(tokens["lais"]), timeout=10,
        )
        assert r.status_code == 404  # filtered out by _doc_filter

    def test_admin_can_see(self, tokens):
        r = requests.get(
            f"{API}/documents/{TestDocumentCreation.doc['document_id']}",
            headers=_h(tokens["admin"]), timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["document_id"] == TestDocumentCreation.doc["document_id"]


# ---------- 6. Recepção: 403 em tudo ----------
class TestRecepcaoBlocked:
    def test_get_templates_403(self, tokens):
        assert requests.get(f"{API}/document-templates", headers=_h(tokens["recep"]), timeout=10).status_code == 403

    def test_get_documents_403(self, tokens):
        assert requests.get(f"{API}/documents", headers=_h(tokens["recep"]), timeout=10).status_code == 403

    def test_post_documents_403(self, tokens, admin_template, patient_id):
        body = {"template_id": admin_template["template_id"], "patient_id": patient_id}
        r = requests.post(f"{API}/documents", headers=_h(tokens["recep"]), json=body, timeout=10)
        assert r.status_code == 403


# ---------- 7. Public endpoints ----------
class TestPublic:
    def test_public_get(self, tokens):
        # need fresh token from a doc
        doc = TestDocumentCreation.doc
        full = requests.get(
            f"{API}/documents/{doc['document_id']}", headers=_h(tokens["bella"]), timeout=10
        ).json()
        token = full["public_token"]
        r = requests.get(f"{API}/public/documents/{token}", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "document" in body
        assert "clinic" in body
        assert "has_patient_signature" in body
        assert "has_professional_signature" in body
        # signatures redacted
        assert "patient_signature" not in body["document"]
        assert "professional_signature" not in body["document"]
        TestPublic.token = token

    def test_public_sign_patient_creates_audit(self, tokens):
        # Create a new draft so we can re-sign publicly
        body = {
            "template_id": _get_or_create_simple_template(tokens),
            "patient_id": _first_patient_id(tokens),
            "procedure": "X", "procedure_value": 100.0,
        }
        r = requests.post(f"{API}/documents", headers=_h(tokens["bella"]), json=body, timeout=10)
        assert r.status_code == 200
        new_doc = r.json()
        token = new_doc["public_token"]
        r2 = requests.post(
            f"{API}/public/documents/{token}/sign-patient",
            json={"signature": FAKE_SIG, "device": "mobile-qr"},
            timeout=10,
        )
        assert r2.status_code == 200
        # audit
        audit = requests.get(
            f"{API}/documents/{new_doc['document_id']}/audit",
            headers=_h(tokens["bella"]), timeout=10,
        ).json()
        roles = [a.get("user_role") for a in audit]
        assert "patient" in roles

    def test_public_validate(self, tokens):
        token = TestPublic.token
        r = requests.get(f"{API}/public/documents/{token}/validate", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["valid"] is True
        assert body["document_id"] == TestDocumentCreation.doc["document_id"]
        assert body["template_name"]
        assert body["patient_name"]
        assert body["professional_name"]
        assert body["status"] == "finalizado"
        assert body["finalized_at"]
        assert body["signed_patient_at"]


# ---------- 8. Audit log ----------
class TestAudit:
    def test_audit_actions(self, tokens):
        doc_id = TestDocumentCreation.doc["document_id"]
        r = requests.get(f"{API}/documents/{doc_id}/audit", headers=_h(tokens["bella"]), timeout=10)
        assert r.status_code == 200
        logs = r.json()
        actions = [l["action"] for l in logs]
        for a in ["created", "signed_patient", "signed_professional", "finalized"]:
            assert a in actions, f"missing audit action: {a}; got {actions}"


# Helpers used by Public tests
def _get_or_create_simple_template(tokens):
    r = requests.get(f"{API}/document-templates", headers=_h(tokens["admin"]), timeout=10)
    for t in r.json():
        if t["name"].startswith("TEST_"):
            return t["template_id"]
    r = requests.post(
        f"{API}/document-templates", headers=_h(tokens["admin"]),
        json={"name": "TEST_ simple", "category": "outro", "content_md": "Doc {{PACIENTE_NOME}}"},
        timeout=10,
    )
    return r.json()["template_id"]


def _first_patient_id(tokens):
    return requests.get(f"{API}/patients", headers=_h(tokens["admin"]), timeout=10).json()[0]["patient_id"]
