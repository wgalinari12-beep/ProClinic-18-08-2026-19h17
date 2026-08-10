"""
Testing F1 (fotos atômicas $addToSet/$pull + autosave sem sobrescrever) e
F2 (assinatura pública QR → status aguardando_profissional + clinical_event +
finalize → clinical_event + timeline aditiva).
Bug crítico regression: TF2 — autosave da ficha NÃO deve apagar fotos vindas do mobile.
"""
import os
import io
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL não configurada")


BASE_URL = _load_backend_url()
PATIENT_ID = "pat_2a6bb93ecdd0"
TEMPLATE_ID = "tpl_82631c0096f9"

# Tiny valid PNG (1x1 red)
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c62f8cfc0000000ffff03000006000557b4b1600000000049454e44ae426082"
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@proclinic.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"] if "access_token" in r.json() else r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def uploaded_photo_url(headers):
    files = {"file": ("test.png", io.BytesIO(PNG_1X1), "image/png")}
    r = requests.post(f"{BASE_URL}/api/uploads", headers=headers, files=files, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["url"]


@pytest.fixture(scope="module")
def module_id(headers):
    """Cria (ou reusa) módulo corporal para o paciente."""
    r = requests.post(
        f"{BASE_URL}/api/anamnesis-modules",
        headers=headers,
        json={"patient_id": PATIENT_ID, "module": "corporal",
              "answers": {"q1": "TEST_initial"}, "photos": []},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["module_id"]


# --------------------------- F1: fotos atômicas ---------------------------

class TestF1Photos:
    def test_add_photo_via_atomic_endpoint(self, headers, module_id, uploaded_photo_url):
        r = requests.post(
            f"{BASE_URL}/api/anamnesis-modules/{module_id}/photos",
            headers=headers, json={"url": uploaded_photo_url}, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert uploaded_photo_url in data["photos"]

    def test_add_same_photo_returns_duplicate(self, headers, module_id, uploaded_photo_url):
        r = requests.post(
            f"{BASE_URL}/api/anamnesis-modules/{module_id}/photos",
            headers=headers, json={"url": uploaded_photo_url}, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("duplicate") is True
        # sem duplicar
        assert data["photos"].count(uploaded_photo_url) == 1

    def test_reject_external_url(self, headers, module_id):
        r = requests.post(
            f"{BASE_URL}/api/anamnesis-modules/{module_id}/photos",
            headers=headers, json={"url": "https://evil.com/x.png"}, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_autosave_without_photos_preserves_existing(self, headers, module_id, uploaded_photo_url):
        """BUG ORIGINAL TF2: autosave desktop com photos:[] NÃO pode apagar foto do mobile."""
        # Confirma foto está presente
        r = requests.get(f"{BASE_URL}/api/anamnesis-modules?patient_id={PATIENT_ID}",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        mods = [m for m in r.json() if m["module_id"] == module_id]
        assert mods and uploaded_photo_url in (mods[0].get("photos") or [])

        # Simula autosave stale (SEM photos)
        r = requests.post(
            f"{BASE_URL}/api/anamnesis-modules",
            headers=headers,
            json={"patient_id": PATIENT_ID, "module": "corporal",
                  "answers": {"q1": "TEST_updated_by_autosave"}, "photos": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # Foto DEVE persistir
        r = requests.get(f"{BASE_URL}/api/anamnesis-modules?patient_id={PATIENT_ID}",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        mods = [m for m in r.json() if m["module_id"] == module_id]
        assert mods, "módulo sumiu após autosave"
        assert uploaded_photo_url in (mods[0].get("photos") or []), \
            "REGRESSÃO CRÍTICA: autosave apagou fotos!"
        # Answer foi atualizada
        assert mods[0]["answers"].get("q1") == "TEST_updated_by_autosave"

    def test_delete_photo_removes_only_target_and_logs_event(self, headers, module_id, uploaded_photo_url):
        r = requests.delete(
            f"{BASE_URL}/api/anamnesis-modules/{module_id}/photos",
            headers=headers, json={"url": uploaded_photo_url}, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("removed") is True
        assert uploaded_photo_url not in data["photos"]

        # clinical_event registrado — verifica via timeline
        r = requests.get(f"{BASE_URL}/api/patients/{PATIENT_ID}/timeline",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        events = r.json().get("clinical_events") or []
        types = [e.get("type") for e in events]
        assert "photo_removed" in types, f"photo_removed event ausente. types={types}"


# --------------------------- F1: mobile QR upload ---------------------------

class TestF1MobileUpload:
    def test_mobile_init_upload_and_photo_persists(self, headers, module_id):
        # Gera token QR
        r = requests.post(
            f"{BASE_URL}/api/mobile-upload/init",
            headers=headers,
            json={"context_type": "anamnesis", "context_id": module_id},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        qr_token = r.json()["token"]

        # Upload SEM auth (é público via token)
        files = {"file": ("mobile.png", io.BytesIO(PNG_1X1), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/mobile-upload/upload?token={qr_token}",
            files=files, timeout=30,
        )
        assert r.status_code == 200, r.text
        mobile_url = r.json()["url"]

        # foto anexada ao módulo
        r = requests.get(f"{BASE_URL}/api/anamnesis-modules?patient_id={PATIENT_ID}",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        mod = next(m for m in r.json() if m["module_id"] == module_id)
        assert mobile_url in (mod.get("photos") or [])

        # Autosave sem photos DEVE preservar (bug original)
        requests.post(
            f"{BASE_URL}/api/anamnesis-modules",
            headers=headers,
            json={"patient_id": PATIENT_ID, "module": "corporal",
                  "answers": {"q1": "TEST_after_mobile"}, "photos": []},
            timeout=15,
        )
        r = requests.get(f"{BASE_URL}/api/anamnesis-modules?patient_id={PATIENT_ID}",
                         headers=headers, timeout=15)
        mod = next(m for m in r.json() if m["module_id"] == module_id)
        assert mobile_url in (mod.get("photos") or []), "REGRESSÃO: autosave apagou foto mobile!"

    def test_mobile_upload_invalid_module_returns_404(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/mobile-upload/init",
            headers=headers,
            json={"context_type": "anamnesis", "context_id": "anm_nao_existe_xxx"},
            timeout=15,
        )
        assert r.status_code == 200
        qr_token = r.json()["token"]
        files = {"file": ("mobile.png", io.BytesIO(PNG_1X1), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/mobile-upload/upload?token={qr_token}",
            files=files, timeout=15,
        )
        assert r.status_code == 404


# --------------------------- F2: assinatura pública + finalize ---------------------------

class TestF2PublicSignAndFinalize:
    @pytest.fixture(scope="class")
    def document(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/documents",
            headers=headers,
            json={"template_id": TEMPLATE_ID, "patient_id": PATIENT_ID},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_public_sign_patient_updates_status_and_logs_event(self, headers, document):
        doc_id = document["document_id"]
        pub_token = document["public_token"]
        sig_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        r = requests.post(
            f"{BASE_URL}/api/public/documents/{pub_token}/sign-patient",
            json={"signature": sig_b64, "device": "mobile-qr"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # status vira aguardando_profissional
        r = requests.get(f"{BASE_URL}/api/documents/{doc_id}", headers=headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "aguardando_profissional"
        assert d.get("patient_sign_user_agent") is not None
        assert d.get("signed_patient_at")

        # clinical event
        r = requests.get(f"{BASE_URL}/api/patients/{PATIENT_ID}/timeline",
                         headers=headers, timeout=15)
        events = r.json().get("clinical_events") or []
        assert any(e.get("type") == "document_signed_patient"
                   and e.get("meta", {}).get("document_id") == doc_id for e in events), \
               "document_signed_patient ausente"

    def test_sign_professional_and_finalize(self, headers, document):
        doc_id = document["document_id"]
        sig_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        r = requests.put(
            f"{BASE_URL}/api/documents/{doc_id}/sign-professional",
            headers=headers, json={"signature": sig_b64, "device": "desktop"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # finalize
        r = requests.post(f"{BASE_URL}/api/documents/{doc_id}/finalize",
                          headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "finalizado"
        pdf_url = d.get("pdf_url")
        assert pdf_url

        # PDF acessível
        r = requests.get(f"{BASE_URL}{pdf_url}", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf") or len(r.content) > 100

        # clinical event document_finalized
        r = requests.get(f"{BASE_URL}/api/patients/{PATIENT_ID}/timeline",
                         headers=headers, timeout=15)
        events = r.json().get("clinical_events") or []
        assert any(e.get("type") == "document_finalized"
                   and e.get("meta", {}).get("document_id") == doc_id for e in events)


# --------------------------- Timeline aditiva ---------------------------

class TestTimelineAdditive:
    def test_timeline_has_new_fields_without_breaking_old(self, headers):
        r = requests.get(f"{BASE_URL}/api/patients/{PATIENT_ID}/timeline",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Novos campos
        assert "patient_documents" in data
        assert "clinical_events" in data
        assert isinstance(data["patient_documents"], list)
        assert isinstance(data["clinical_events"], list)
        # Antigos preservados
        assert "sessions" in data
        assert "legacy_records" in data
        assert "counts" in data
        assert "patient" in data
