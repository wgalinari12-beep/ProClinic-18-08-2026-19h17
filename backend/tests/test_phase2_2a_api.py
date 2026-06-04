"""ProClinic Phase 2.2A backend tests:
- Login by email AND by CPF (with/without punctuation)
- RBAC users CRUD (admin) + professionals-public
- Soft-delete + reset-password
- First-access change-password flow
- Signed URLs for /api/files (works WITHOUT auth via ?sig=)
- Appointments include professional_color + role filter
"""
import os
import io
import re
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@proclinic.com", "password": "admin123"}
BELLA_EMAIL = {"email": "dra.bella@proclinic.com", "password": "bella123"}
BELLA_CPF_FORMATTED = {"cpf": "111.222.333-44", "password": "bella123"}
BELLA_CPF_DIGITS = {"cpf": "11122233344", "password": "bella123"}
RECEP = {"email": "ana.recep@proclinic.com", "password": "ana123"}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload)
    return r


def _u(resp_json):
    """Login returns flat object; expose as if {token, user:{...}}."""
    return {"token": resp_json["token"], "user": resp_json}


@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def bella_token():
    r = _login(BELLA_EMAIL)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def recep_token():
    r = _login(RECEP)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ------------------- 1. Login email / CPF -------------------
class TestLogin:
    def test_login_admin_email(self):
        r = _login(ADMIN)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "admin"
        assert isinstance(d["token"], str) and len(d["token"]) > 20

    def test_login_bella_email(self):
        r = _login(BELLA_EMAIL)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "profissional"
        assert d.get("color") == "#B76E79"

    def test_login_bella_cpf_formatted(self):
        r = _login(BELLA_CPF_FORMATTED)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "profissional"
        assert d.get("color") == "#B76E79"

    def test_login_bella_cpf_digits(self):
        r = _login(BELLA_CPF_DIGITS)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "profissional"

    def test_login_invalid(self):
        r = _login({"email": "x@y.com", "password": "wrong"})
        assert r.status_code in (400, 401, 403)


# ------------------- 2. Users CRUD + RBAC -------------------
class TestUsers:
    def test_professionals_public_with_any_role(self, recep_token):
        h = {"Authorization": f"Bearer {recep_token}"}
        r = requests.get(f"{API}/users/professionals-public", headers=h)
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list)
        assert any(p.get("name", "").lower().find("bella") >= 0 for p in docs)
        for p in docs:
            assert "user_id" in p
            assert "name" in p
            assert "color" in p

    def test_list_users_admin(self, admin_h):
        r = requests.get(f"{API}/users", headers=admin_h)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_list_users_non_admin_forbidden(self, recep_token):
        h = {"Authorization": f"Bearer {recep_token}"}
        r = requests.get(f"{API}/users", headers=h)
        assert r.status_code == 403, r.text

    def test_create_user_and_login_flow(self, admin_h):
        suffix = uuid.uuid4().hex[:6]
        email = f"test_pro_{suffix}@proclinic.com"
        cpf = f"999.{suffix[:3]}.{suffix[3:6]}-00"
        payload = {
            "name": f"TEST_Pro_{suffix}",
            "email": email,
            "cpf": cpf,
            "role": "profissional",
            "color": "#34D399",
            "specialty": "Estética",
            "initial_password": "init123",
        }
        r = requests.post(f"{API}/users", json=payload, headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == email
        assert d["role"] == "profissional"
        assert d.get("password_change_required") is True
        assert d.get("color") == "#34D399"
        pytest.new_user_id = d["user_id"]
        pytest.new_user_email = email
        pytest.new_user_cpf = cpf

        # duplicate email
        r2 = requests.post(f"{API}/users", json=payload, headers=admin_h)
        assert r2.status_code == 400, r2.text

        # login as new user → password_change_required True, token returned
        login = _login({"email": email, "password": "init123"})
        assert login.status_code == 200, login.text
        ld = login.json()
        assert ld["password_change_required"] is True
        pytest.new_user_token = ld["token"]

    def test_change_password_first_access(self):
        h = {"Authorization": f"Bearer {pytest.new_user_token}"}
        r = requests.post(
            f"{API}/auth/change-password",
            json={"new_password": "newpass1"},
            headers=h,
        )
        assert r.status_code == 200, r.text

        # Re-login: password_change_required must be False now
        login = _login({"email": pytest.new_user_email, "password": "newpass1"})
        assert login.status_code == 200, login.text
        assert login.json()["password_change_required"] is False

    def test_update_user_initial_password_sets_flag(self, admin_h):
        # PUT requires full StaffUserIn fields
        payload = {
            "name": f"TEST_Pro_renamed",
            "email": pytest.new_user_email,
            "cpf": pytest.new_user_cpf,
            "role": "profissional",
            "color": "#34D399",
            "initial_password": "again123",
        }
        r = requests.put(f"{API}/users/{pytest.new_user_id}", json=payload, headers=admin_h)
        assert r.status_code == 200, r.text
        # next login flag should be True
        login = _login({"email": pytest.new_user_email, "password": "again123"})
        assert login.status_code == 200
        assert login.json()["password_change_required"] is True

    def test_reset_password_admin(self, admin_h):
        r = requests.post(
            f"{API}/users/{pytest.new_user_id}/reset-password",
            json={"new_password": "reset123"},
            headers=admin_h,
        )
        assert r.status_code == 200, r.text
        login = _login({"email": pytest.new_user_email, "password": "reset123"})
        assert login.status_code == 200
        assert login.json()["password_change_required"] is True

    def test_delete_user_soft(self, admin_h):
        r = requests.delete(f"{API}/users/{pytest.new_user_id}", headers=admin_h)
        assert r.status_code == 200, r.text
        # cannot login now
        login = _login({"email": pytest.new_user_email, "password": "reset123"})
        assert login.status_code in (400, 401, 403)


# ------------------- 3. Signed URLs (/api/uploads + /api/files) -------------------
class TestSignedUrls:
    def test_upload_and_signed_get(self, admin_h):
        # tiny 1x1 PNG
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff"
            b"\xff?\x00\x05\xfe\x02\xfe\xa7V\xbdY\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        files = {"file": ("tiny.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/uploads", files=files, headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d
        assert "?sig=" in d["url"], f"url missing ?sig= : {d['url']}"
        assert "file_id" in d
        assert "signature" in d

        url = d["url"]
        if url.startswith("/"):
            url = f"{BASE_URL}{url}"
        pytest.signed_url = url
        pytest.signed_sig = d["signature"]
        # extract path part for tampering tests
        path_match = re.search(r"/api/files/([^?]+)", url)
        assert path_match
        pytest.signed_path = path_match.group(1)

        # GET signed URL with NO auth header at all
        r2 = requests.get(url)  # explicitly no headers
        assert r2.status_code == 200, f"signed GET failed: {r2.status_code} {r2.text[:200]}"
        assert r2.content.startswith(b"\x89PNG"), "expected PNG bytes"
        assert r2.headers.get("content-type", "").startswith("image/")

    def test_invalid_sig(self):
        bad_url = f"{BASE_URL}/api/files/{pytest.signed_path}?sig=INVALID.TOKEN.XYZ"
        r = requests.get(bad_url)
        assert r.status_code in (401, 403, 404), r.status_code

    def test_no_sig_no_auth(self):
        no_sig = f"{BASE_URL}/api/files/{pytest.signed_path}"
        r = requests.get(no_sig)
        assert r.status_code in (401, 403), r.status_code


# ------------------- 4. Appointments professional_color + RBAC filter -------------------
class TestAppointmentsProfessional:
    def test_appointments_have_professional_color(self, admin_h):
        # Find Bella's user_id
        r = requests.get(f"{API}/users/professionals-public", headers=admin_h)
        pros = r.json()
        bella = next((p for p in pros if "bella" in p["name"].lower()), None)
        assert bella, "Bella professional not found"
        pytest.bella_user_id = bella["user_id"]
        pytest.bella_color = bella["color"]

        # Get a patient
        r = requests.get(f"{API}/patients", headers=admin_h)
        assert r.status_code == 200
        pats = r.json()
        assert pats
        patient_id = pats[0]["patient_id"]

        # Get a procedure
        r = requests.get(f"{API}/procedures", headers=admin_h)
        procs = r.json() if r.status_code == 200 else []
        proc_name = procs[0]["name"] if procs else "Consulta"

        payload = {
            "patient_id": patient_id,
            "procedure": proc_name,
            "start": "2026-12-30T10:00:00",
            "end": "2026-12-30T11:00:00",
            "professional_id": pytest.bella_user_id,
            "professional_name": bella["name"],
            "status": "agendado",
        }
        r = requests.post(f"{API}/appointments", json=payload, headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("professional_color") == pytest.bella_color, (
            f"expected {pytest.bella_color}, got {d.get('professional_color')}"
        )
        pytest.bella_appt_id = d["appointment_id"]

        # list endpoint includes color
        r2 = requests.get(f"{API}/appointments", headers=admin_h)
        assert r2.status_code == 200
        found = next((a for a in r2.json() if a["appointment_id"] == pytest.bella_appt_id), None)
        assert found and found.get("professional_color") == pytest.bella_color

    def test_professional_sees_only_own_appointments(self, bella_token):
        h = {"Authorization": f"Bearer {bella_token}"}
        r = requests.get(f"{API}/appointments", headers=h)
        assert r.status_code == 200, r.text
        apts = r.json()
        # all listed appointments must belong to Bella
        for a in apts:
            assert a.get("professional_id") == pytest.bella_user_id, (
                f"professional sees appointment not theirs: {a.get('professional_id')}"
            )

    def test_cleanup_appt(self, admin_h):
        if hasattr(pytest, "bella_appt_id"):
            requests.delete(f"{API}/appointments/{pytest.bella_appt_id}", headers=admin_h)
