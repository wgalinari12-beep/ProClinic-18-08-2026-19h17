"""ProClinic Phase 2 backend tests:
- Patient completeness
- Anamnesis modules upsert
- Attendance sessions (start/idempotent, update, by-appointment, finalize)
- Uploads + serve files (auth via query param)
- AI generate (evolution/protocol/session_summary/anamnesis_summary)
- Messages center
- Auth protection (401 without token)
"""
import os
import io
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@proclinic.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def auth():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user": data,
            "headers": {"Authorization": f"Bearer {data['token']}"}}


@pytest.fixture(scope="session")
def seed_patient(auth):
    r = requests.get(f"{API}/patients", headers=auth["headers"])
    assert r.status_code == 200
    pats = r.json()
    assert pats
    return pats[0]


@pytest.fixture(scope="session")
def seed_appointment(auth):
    r = requests.get(f"{API}/appointments", headers=auth["headers"])
    assert r.status_code == 200
    apts = r.json()
    assert apts
    return apts[0]


# ---------- 1. Patient completeness ----------
class TestCompleteness:
    def test_completeness_structure(self, auth, seed_patient):
        pid = seed_patient["patient_id"]
        r = requests.get(f"{API}/patients/{pid}/completeness", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "complete" in data and isinstance(data["complete"], bool)
        assert "missing" in data and isinstance(data["missing"], list)
        assert "patient" in data
        assert data["patient"]["patient_id"] == pid

    def test_completeness_404(self, auth):
        r = requests.get(f"{API}/patients/nope_xxx/completeness", headers=auth["headers"])
        assert r.status_code == 404

    def test_completeness_unauth(self):
        r = requests.get(f"{API}/patients/whatever/completeness")
        assert r.status_code == 401


# ---------- 2. Anamnesis modules ----------
class TestAnamnesisModules:
    def test_upsert_module(self, auth, seed_patient):
        pid = seed_patient["patient_id"]
        payload = {"patient_id": pid, "module": "geral",
                   "answers": {"alergias": "nenhuma", "queixa_principal": "TEST_inicial"}}
        r1 = requests.post(f"{API}/anamnesis-modules", headers=auth["headers"], json=payload)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["module"] == "geral"
        assert d1["patient_id"] == pid
        mid = d1["module_id"]

        # update same module — should reuse module_id (upsert)
        payload["answers"]["queixa_principal"] = "TEST_atualizado"
        r2 = requests.post(f"{API}/anamnesis-modules", headers=auth["headers"], json=payload)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["module_id"] == mid
        assert d2["answers"]["queixa_principal"] == "TEST_atualizado"

    def test_list_modules(self, auth, seed_patient):
        pid = seed_patient["patient_id"]
        r = requests.get(f"{API}/anamnesis-modules?patient_id={pid}", headers=auth["headers"])
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        assert any(d["module"] == "geral" for d in docs)

    def test_unauth(self):
        r = requests.get(f"{API}/anamnesis-modules?patient_id=x")
        assert r.status_code == 401


# ---------- 3. Attendance sessions ----------
class TestAttendance:
    def test_start_idempotent(self, auth, seed_appointment):
        aid = seed_appointment["appointment_id"]
        r1 = requests.post(f"{API}/attendance/start",
                           headers=auth["headers"], json={"appointment_id": aid})
        assert r1.status_code == 200, r1.text
        s1 = r1.json()
        assert s1["appointment_id"] == aid
        sid1 = s1["session_id"]

        # second start should return same session
        r2 = requests.post(f"{API}/attendance/start",
                           headers=auth["headers"], json={"appointment_id": aid})
        assert r2.status_code == 200
        assert r2.json()["session_id"] == sid1

    def test_start_missing_payload(self, auth):
        r = requests.post(f"{API}/attendance/start", headers=auth["headers"], json={})
        assert r.status_code == 400

    def test_start_appointment_not_found(self, auth):
        r = requests.post(f"{API}/attendance/start", headers=auth["headers"],
                          json={"appointment_id": "apt_nonexistent"})
        assert r.status_code == 404

    def test_update_and_by_appointment(self, auth, seed_appointment):
        aid = seed_appointment["appointment_id"]
        start = requests.post(f"{API}/attendance/start",
                              headers=auth["headers"], json={"appointment_id": aid}).json()
        sid = start["session_id"]
        update = {"patient_id": start["patient_id"],
                  "evolution": "TEST_Evolução autosave",
                  "observations": "TEST_obs",
                  "duration_seconds": 42}
        r = requests.put(f"{API}/attendance/{sid}",
                         headers=auth["headers"], json=update)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["evolution"] == "TEST_Evolução autosave"
        assert d["duration_seconds"] == 42

        # by-appointment
        r2 = requests.get(f"{API}/attendance/by-appointment/{aid}", headers=auth["headers"])
        assert r2.status_code == 200
        b = r2.json()
        assert b is not None
        assert b["session_id"] == sid
        assert b["evolution"] == "TEST_Evolução autosave"

    def test_by_appointment_null_when_none(self, auth):
        # Create a fresh appointment without an attendance session, ensure by-appointment returns null
        pats = requests.get(f"{API}/patients", headers=auth["headers"]).json()
        pid = pats[0]["patient_id"]
        s = (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()
        e = (datetime.now(timezone.utc) + timedelta(days=20, hours=1)).isoformat()
        new_apt = requests.post(f"{API}/appointments", headers=auth["headers"], json={
            "patient_id": pid, "procedure": "TEST_no_attendance",
            "start": s, "end": e}).json()
        aid = new_apt["appointment_id"]
        r = requests.get(f"{API}/attendance/by-appointment/{aid}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json() is None
        # cleanup
        requests.delete(f"{API}/appointments/{aid}", headers=auth["headers"])

    def test_finalize_creates_record_and_marks_apt(self, auth):
        # Create appointment + start session + finalize
        pats = requests.get(f"{API}/patients", headers=auth["headers"]).json()
        pid = pats[0]["patient_id"]
        s = (datetime.now(timezone.utc) + timedelta(days=21)).isoformat()
        e = (datetime.now(timezone.utc) + timedelta(days=21, hours=1)).isoformat()
        apt = requests.post(f"{API}/appointments", headers=auth["headers"], json={
            "patient_id": pid, "procedure": "TEST_finalize_flow",
            "start": s, "end": e}).json()
        aid = apt["appointment_id"]
        sess = requests.post(f"{API}/attendance/start",
                             headers=auth["headers"], json={"appointment_id": aid}).json()
        sid = sess["session_id"]
        # autosave evolution
        requests.put(f"{API}/attendance/{sid}", headers=auth["headers"], json={
            "patient_id": pid, "evolution": "TEST_Final evol",
            "evolution_signature": "data:image/png;base64,AAAA"})
        # finalize
        r = requests.post(f"{API}/attendance/{sid}/finalize", headers=auth["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True and d.get("record_id")
        # verify appointment is concluido
        apt2 = requests.get(f"{API}/appointments", headers=auth["headers"]).json()
        same = [a for a in apt2 if a["appointment_id"] == aid]
        assert same and same[0]["status"] == "concluido"
        # verify record exists for patient
        recs = requests.get(f"{API}/medical-records?patient_id={pid}",
                            headers=auth["headers"]).json()
        assert any(r["record_id"] == d["record_id"] for r in recs)
        # cleanup
        requests.delete(f"{API}/appointments/{aid}", headers=auth["headers"])

    def test_unauth(self):
        r = requests.post(f"{API}/attendance/start", json={"appointment_id": "x"})
        assert r.status_code == 401


# ---------- 4. Uploads + file serve ----------
PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff"
    b"\xff?\x03\x00\x06\x00\x02\xfe\xa7\x83\x90\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestUploads:
    def test_upload_and_serve_via_signed_url(self, auth):
        files = {"file": ("tiny.png", io.BytesIO(PNG_1x1), "image/png")}
        # multipart upload — do not set content-type header
        r = requests.post(f"{API}/uploads",
                          headers={"Authorization": auth["headers"]["Authorization"]},
                          files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["file_id"] and data["url"] and data["path"]
        # url already includes the signature; serve with no Authorization at all
        url = f"{BASE_URL}{data['url']}"
        assert "?sig=" in url
        r2 = requests.get(url)
        assert r2.status_code == 200, r2.text
        assert r2.headers.get("Content-Type", "").startswith("image/")
        assert len(r2.content) > 0

    def test_serve_unauthorized(self, auth):
        files = {"file": ("tiny2.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{API}/uploads",
                          headers={"Authorization": auth["headers"]["Authorization"]},
                          files=files)
        path = r.json()["path"]
        r2 = requests.get(f"{BASE_URL}/api/files/{path}")
        assert r2.status_code == 401

    def test_upload_unauth(self):
        files = {"file": ("nope.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{API}/uploads", files=files)
        assert r.status_code == 401

    def test_upload_rejects_non_whitelisted_mime(self, auth):
        # text/plain not in whitelist → 400
        files = {"file": ("evil.txt", io.BytesIO(b"hello world"), "text/plain")}
        r = requests.post(f"{API}/uploads",
                          headers={"Authorization": auth["headers"]["Authorization"]},
                          files=files)
        assert r.status_code == 400, r.text
        assert "permitido" in r.text.lower() or "allowed" in r.text.lower() or "not" in r.text.lower()


# ---------- 5. AI generate ----------
class TestAIGenerate:
    @pytest.mark.parametrize("kind", ["evolution", "protocol", "session_summary", "anamnesis_summary"])
    def test_generate_returns_text(self, auth, seed_patient, kind):
        payload = {"type": kind, "patient_id": seed_patient["patient_id"],
                   "context": "Limpeza de pele", "notes": "Paciente reagiu bem"}
        r = requests.post(f"{API}/ai/generate", headers=auth["headers"],
                          json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "text" in data
        assert isinstance(data["text"], str)
        assert len(data["text"]) > 10

    def test_unauth(self):
        r = requests.post(f"{API}/ai/generate", json={"type": "evolution"})
        assert r.status_code == 401


# ---------- 6. Messages center ----------
class TestMessages:
    def test_create_and_list(self, auth, seed_patient):
        pid = seed_patient["patient_id"]
        body = f"TEST_msg {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/messages", headers=auth["headers"],
                          json={"patient_id": pid, "body": body, "channel": "whatsapp"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "queued"
        assert d["body"] == body
        assert d["clinic_id"] == auth["user"]["clinic_id"]
        msg_id = d["message_id"]

        # list (filter by patient)
        r2 = requests.get(f"{API}/messages?patient_id={pid}", headers=auth["headers"])
        assert r2.status_code == 200
        items = r2.json()
        assert any(m["message_id"] == msg_id for m in items)

        # list (no filter — still scoped to clinic)
        r3 = requests.get(f"{API}/messages", headers=auth["headers"])
        assert r3.status_code == 200
        assert any(m["message_id"] == msg_id for m in r3.json())

    def test_create_unknown_patient(self, auth):
        r = requests.post(f"{API}/messages", headers=auth["headers"],
                          json={"patient_id": "pat_nope", "body": "x"})
        assert r.status_code == 404

    def test_create_empty_body_rejected(self, auth, seed_patient):
        # body='' must fail with 422 (Field min_length=1)
        r = requests.post(f"{API}/messages", headers=auth["headers"],
                          json={"patient_id": seed_patient["patient_id"], "body": "", "channel": "whatsapp"})
        assert r.status_code == 422, r.text

    def test_unauth(self):
        r = requests.get(f"{API}/messages")
        assert r.status_code == 401
