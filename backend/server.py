from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import re
import uuid
import asyncio
import logging
import bcrypt
import jwt
import httpx
import requests
import qrcode
import resend
import markdown as md
from xhtml2pdf import pisa
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Any, Dict

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query, UploadFile, File, Header
from fastapi.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr, field_validator

from emergentintegrations.llm.chat import LlmChat, UserMessage

# ============================================================
# Configuration
# ============================================================
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="ProClinic API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("proclinic")


# ============================================================
# Models
# ============================================================
RoleType = Literal["admin", "financeiro", "recepcao", "profissional", "marketing", "paciente"]


class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    role: RoleType
    clinic_id: str
    picture: Optional[str] = None
    auth_provider: str = "email"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: RoleType = "recepcao"


class LoginIn(BaseModel):
    email: Optional[EmailStr] = None
    cpf: Optional[str] = None
    password: str


class PatientIn(BaseModel):
    name: str
    cpf: Optional[str] = None
    birth_date: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    allergies: Optional[str] = None
    medications: Optional[str] = None
    emergency_contact: Optional[str] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None
    lgpd_consent: bool = False
    status: str = "ativo"
    is_pre_registered: bool = False


class PatientOut(PatientIn):
    patient_id: str
    clinic_id: str
    created_at: str


class AppointmentIn(BaseModel):
    patient_id: str
    professional_id: Optional[str] = None
    professional_name: Optional[str] = None
    professional_color: Optional[str] = None
    procedure: str
    procedure_id: Optional[str] = None
    start: str  # ISO datetime
    end: str
    status: str = "agendado"  # agendado, confirmado, concluido, cancelado, encaixe, em_atendimento
    room: Optional[str] = None
    notes: Optional[str] = None
    price: Optional[float] = 0


class AppointmentOut(AppointmentIn):
    appointment_id: str
    clinic_id: str
    patient_name: Optional[str] = None
    created_at: str


class MedicalRecordIn(BaseModel):
    patient_id: str
    procedure: str
    professional_name: Optional[str] = None
    evolution: str
    observations: Optional[str] = None
    photos_before: List[str] = []
    photos_after: List[str] = []
    prescriptions: Optional[str] = None
    protocols: Optional[str] = None
    signed: bool = False


class MedicalRecordOut(MedicalRecordIn):
    record_id: str
    clinic_id: str
    patient_name: Optional[str] = None
    created_at: str


class AnamnesisIn(BaseModel):
    patient_id: str
    template_name: str = "Estética Geral"
    answers: dict  # { question_key: answer }
    signature: Optional[str] = None  # base64 signature
    signed: bool = False


class AnamnesisOut(AnamnesisIn):
    anamnesis_id: str
    clinic_id: str
    patient_name: Optional[str] = None
    created_at: str


class FinancialEntryIn(BaseModel):
    type: Literal["receita", "despesa"]
    category: str
    description: str
    amount: float
    due_date: str
    paid: bool = False
    payment_method: Optional[str] = None
    patient_id: Optional[str] = None
    budget_id: Optional[str] = None
    appointment_id: Optional[str] = None
    procedure_id: Optional[str] = None
    professional_id: Optional[str] = None
    cost_center: Optional[str] = None
    notes: Optional[str] = None
    installment_group_id: Optional[str] = None
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None


class FinancialEntryPatch(BaseModel):
    """PATCH-style partial update — só campos enviados são alterados."""
    type: Optional[Literal["receita", "despesa"]] = None
    category: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    due_date: Optional[str] = None
    paid: Optional[bool] = None
    payment_method: Optional[str] = None
    patient_id: Optional[str] = None
    budget_id: Optional[str] = None
    appointment_id: Optional[str] = None
    procedure_id: Optional[str] = None
    professional_id: Optional[str] = None
    cost_center: Optional[str] = None
    notes: Optional[str] = None


class FinancialEntryOut(FinancialEntryIn):
    entry_id: str
    clinic_id: str
    created_at: str


class BudgetItemIn(BaseModel):
    procedure_id: Optional[str] = None
    name: str
    quantity: int = 1
    unit_price: float = 0
    discount_percent: float = 0  # 0..100
    discount_value: float = 0    # absolute R$ off (applied after percent)


class BudgetIn(BaseModel):
    patient_id: str
    appointment_id: Optional[str] = None
    items: List[BudgetItemIn] = []
    notes: Optional[str] = None
    payment_method: Optional[str] = None    # à vista | pix | cartão | boleto | parcelado
    installments: int = 1
    valid_until: Optional[str] = None  # ISO date
    status: Literal["rascunho", "enviado", "aprovado", "recusado", "expirado"] = "rascunho"
    patient_signature: Optional[str] = None  # base64 png


class AIChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None
    context: Optional[str] = None  # e.g. patient context


# ----- Documentos Jurídicos (Fase 2.3A) -----
class DocumentTemplateIn(BaseModel):
    name: str
    category: str = "consentimento"   # consentimento | contrato | termo | outro
    content_md: str                   # markdown source with {{VARS}}
    description: Optional[str] = None
    active: bool = True


class SignedDocumentIn(BaseModel):
    template_id: str
    patient_id: str
    appointment_id: Optional[str] = None
    procedure: Optional[str] = None
    procedure_value: Optional[float] = None
    # snapshot of rendered HTML (after variable substitution); created on POST
    # signatures are added via dedicated endpoints

# ============================================================
# Auth utils
# ============================================================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=86400,
        path="/",
    )


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        # Also try emergent session_token cookie
        sess = request.cookies.get("session_token")
        if sess:
            user = await db.users.find_one({"session_token": sess}, {"_id": 0, "password_hash": 0})
            if user:
                return user
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one(
            {"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0}
        )
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


# ============================================================
# Health
# ============================================================
@api_router.get("/")
async def root():
    return {"message": "ProClinic API", "status": "ok"}


# ============================================================
# Auth Endpoints
# ============================================================
@api_router.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    # default clinic for new signups
    clinic = await db.clinics.find_one({}, {"_id": 0})
    if not clinic:
        clinic_id = f"clinic_{uuid.uuid4().hex[:12]}"
        await db.clinics.insert_one({
            "clinic_id": clinic_id,
            "name": "Minha Clínica",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        clinic_id = clinic["clinic_id"]

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": data.name,
        "password_hash": hash_password(data.password),
        "role": data.role,
        "clinic_id": clinic_id,
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email)
    set_auth_cookie(response, token)
    return {
        "user_id": user_id, "email": email, "name": data.name,
        "role": data.role, "clinic_id": clinic_id, "auth_provider": "email",
        "token": token,
    }


@api_router.post("/auth/login")
async def login(data: LoginIn, response: Response):
    if not data.email and not data.cpf:
        raise HTTPException(status_code=400, detail="Email ou CPF obrigatório")
    if data.email:
        user = await db.users.find_one({"email": data.email.lower()})
    else:
        # normalize CPF: only digits
        cpf_digits = "".join(c for c in (data.cpf or "") if c.isdigit())
        user = await db.users.find_one({"cpf_digits": cpf_digits})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Usuário desativado")
    token = create_access_token(user["user_id"], user["email"])
    set_auth_cookie(response, token)
    return {
        "user_id": user["user_id"], "email": user["email"], "name": user["name"],
        "role": user["role"], "clinic_id": user["clinic_id"],
        "auth_provider": user.get("auth_provider", "email"),
        "picture": user.get("picture"),
        "color": user.get("color"),
        "password_change_required": user.get("password_change_required", False),
        "token": token,
    }


class ChangePasswordIn(BaseModel):
    current_password: Optional[str] = None
    new_password: str = Field(..., min_length=6)


@api_router.post("/auth/change-password")
async def change_password(data: ChangePasswordIn, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"user_id": user["user_id"]})
    # If not first-access change, require current password
    if not full.get("password_change_required") and data.current_password:
        if not verify_password(data.current_password, full["password_hash"]):
            raise HTTPException(status_code=400, detail="Senha atual incorreta")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "password_hash": hash_password(data.new_password),
            "password_change_required": False,
            "password_changed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "clinic_id": user["clinic_id"],
        "picture": user.get("picture"),
        "color": user.get("color"),
        "password_change_required": user.get("password_change_required", False),
        "auth_provider": user.get("auth_provider", "email"),
    }


@api_router.post("/auth/google/session")
async def google_session(request: Request, response: Response):
    """Exchange Emergent session_id for app session.
    Frontend posts {session_id: '...'} from URL fragment after Emergent OAuth."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id obrigatório")

    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Falha na autenticação Google")
    data = r.json()
    email = data["email"].lower()

    # find or create user
    user = await db.users.find_one({"email": email})
    if not user:
        # ensure default clinic
        clinic = await db.clinics.find_one({}, {"_id": 0})
        if not clinic:
            clinic_id = f"clinic_{uuid.uuid4().hex[:12]}"
            await db.clinics.insert_one({
                "clinic_id": clinic_id,
                "name": "Minha Clínica",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        else:
            clinic_id = clinic["clinic_id"]
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name", email),
            "picture": data.get("picture"),
            "role": "paciente",
            "clinic_id": clinic_id,
            "auth_provider": "google",
            "session_token": data["session_token"],
            "session_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one(
            {"email": email},
            {"$set": {
                "session_token": data["session_token"],
                "session_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                "picture": data.get("picture", user.get("picture")),
                "auth_provider": user.get("auth_provider", "google"),
            }},
        )

    # set both cookies
    response.set_cookie(
        key="session_token", value=data["session_token"],
        httponly=True, secure=True, samesite="none", max_age=7*86400, path="/",
    )
    token = create_access_token(user["user_id"], email)
    set_auth_cookie(response, token)
    return {
        "user_id": user["user_id"], "email": email, "name": user["name"],
        "role": user["role"], "clinic_id": user["clinic_id"],
        "picture": user.get("picture"), "auth_provider": "google",
    }


# ============================================================
# Patients
# ============================================================
@api_router.get("/patients")
async def list_patients(user: dict = Depends(get_current_user), search: str = ""):
    q = {"clinic_id": user["clinic_id"]}
    if search:
        q["name"] = {"$regex": search, "$options": "i"}
    docs = await db.patients.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/patients")
async def create_patient(data: PatientIn, user: dict = Depends(get_current_user)):
    patient_id = f"pat_{uuid.uuid4().hex[:12]}"
    doc = data.model_dump()
    doc.update({
        "patient_id": patient_id,
        "clinic_id": user["clinic_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.patients.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/patients/{patient_id}")
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)):
    doc = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    return doc


@api_router.put("/patients/{patient_id}")
async def update_patient(patient_id: str, data: PatientIn, user: dict = Depends(get_current_user)):
    res = await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": data.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    doc = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user: dict = Depends(get_current_user)):
    await db.patients.delete_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


# ============================================================
# Appointments
# ============================================================
def role_appointment_filter(user: dict) -> dict:
    """Filter for appointments: profissional sees only own; admin/recepcao see all."""
    q = {"clinic_id": user["clinic_id"]}
    if user.get("role") == "profissional":
        q["professional_id"] = user["user_id"]
    return q


def role_record_filter(user: dict) -> dict:
    """Filter for medical records / anamnesis modules. Profissional sees only own."""
    q = {"clinic_id": user["clinic_id"]}
    if user.get("role") == "profissional":
        q["created_by"] = user["user_id"]
    return q


@api_router.get("/appointments")
async def list_appointments(
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q = role_appointment_filter(user)
    if start and end:
        q["start"] = {"$gte": start, "$lte": end}
    docs = await db.appointments.find(q, {"_id": 0}).sort("start", 1).to_list(1000)
    for d in docs:
        if not d.get("patient_name"):
            p = await db.patients.find_one(
                {"patient_id": d["patient_id"]}, {"_id": 0, "name": 1}
            )
            d["patient_name"] = p["name"] if p else "Paciente"
    return docs


@api_router.post("/appointments")
async def create_appointment(data: AppointmentIn, user: dict = Depends(get_current_user)):
    appointment_id = f"apt_{uuid.uuid4().hex[:12]}"
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    # If no professional_id provided AND user is profissional, assign self
    professional_id = data.professional_id
    professional_name = data.professional_name
    professional_color = data.professional_color
    if not professional_id and user.get("role") == "profissional":
        professional_id = user["user_id"]
        professional_name = user["name"]
        professional_color = user.get("color")
    if professional_id and not professional_color:
        pro = await db.users.find_one(
            {"user_id": professional_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "color": 1, "name": 1},
        )
        if pro:
            professional_color = pro.get("color")
            if not professional_name:
                professional_name = pro.get("name")
    doc = data.model_dump()
    doc.update({
        "appointment_id": appointment_id,
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"] if p else "Paciente",
        "professional_id": professional_id,
        "professional_name": professional_name,
        "professional_color": professional_color,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.appointments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/appointments/{appointment_id}")
async def update_appointment(appointment_id: str, data: AppointmentIn, user: dict = Depends(get_current_user)):
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1}
    )
    update_doc = data.model_dump()
    update_doc["patient_name"] = p["name"] if p else "Paciente"
    res = await db.appointments.update_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]},
        {"$set": update_doc},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    doc = await db.appointments.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, user: dict = Depends(get_current_user)):
    await db.appointments.delete_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


# ============================================================
# Medical Records
# ============================================================
@api_router.get("/medical-records")
async def list_records(patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = role_record_filter(user)
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.medical_records.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/medical-records")
async def create_record(data: MedicalRecordIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    record_id = f"rec_{uuid.uuid4().hex[:12]}"
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1}
    )
    doc = data.model_dump()
    doc.update({
        "record_id": record_id,
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"] if p else "Paciente",
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.medical_records.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ============================================================
# Anamnesis
# ============================================================
@api_router.get("/anamnesis")
async def list_anamnesis(patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.anamnesis.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/anamnesis")
async def create_anamnesis(data: AnamnesisIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    anamnesis_id = f"ana_{uuid.uuid4().hex[:12]}"
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1}
    )
    doc = data.model_dump()
    doc.update({
        "anamnesis_id": anamnesis_id,
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"] if p else "Paciente",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.anamnesis.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ============================================================
# Finance
# ============================================================
@api_router.get("/finance/entries")
async def list_entries(
    user: dict = Depends(get_current_user),
    patient_id: Optional[str] = None,
    type: Optional[Literal["receita", "despesa"]] = None,
    paid: Optional[bool] = None,
    date_from: Optional[str] = None,       # YYYY-MM-DD inclusive
    date_to: Optional[str] = None,         # YYYY-MM-DD inclusive
    installment_group_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1000,
):
    require_finance_read(user)
    q: Dict[str, Any] = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    if type:
        q["type"] = type
    if paid is not None:
        q["paid"] = paid
    if installment_group_id:
        q["installment_group_id"] = installment_group_id
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["due_date"] = rng
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        q["$or"] = [{"description": rx}, {"category": rx}, {"notes": rx}]
    docs = await db.financial_entries.find(q, {"_id": 0}).sort("due_date", -1).limit(min(max(1, limit), 5000)).to_list(limit)
    return docs


@api_router.post("/finance/entries")
async def create_entry(data: FinancialEntryIn, user: dict = Depends(get_current_user)):
    require_finance_write(user)
    entry_id = f"fin_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = data.model_dump()
    doc.update({
        "entry_id": entry_id,
        "clinic_id": user["clinic_id"],
        "created_at": now_iso,
        "created_by": user["user_id"],
        "updated_at": now_iso,
    })
    if doc.get("paid") and not doc.get("paid_at"):
        doc["paid_at"] = now_iso
    # single-entry defaults for installment metadata (None → default)
    if doc.get("installment_group_id") is None:
        doc["installment_group_id"] = entry_id
    if doc.get("installment_number") is None:
        doc["installment_number"] = 1
    if doc.get("installment_total") is None:
        doc["installment_total"] = 1
    await db.financial_entries.insert_one(doc)
    doc.pop("_id", None)
    # Auto-generate receipt if created already paid (only for receitas)
    if doc.get("paid") and doc.get("type") == "receita":
        try:
            r = await _generate_receipt_for_entry(entry_id, user["clinic_id"])
            if r:
                doc["receipt_number"] = r["receipt_number"]
                doc["receipt_url"] = r["receipt_url"]
        except Exception as e:
            logger.warning("auto receipt on create failed: %s", e)
    return doc


@api_router.put("/finance/entries/{entry_id}")
async def update_entry(entry_id: str, data: FinancialEntryPatch, user: dict = Depends(get_current_user)):
    require_finance_write(user)
    existing = await db.financial_entries.find_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    changes = data.model_dump(exclude_unset=True)
    # paid_at bookkeeping
    if "paid" in changes:
        if changes["paid"] and not existing.get("paid_at"):
            changes["paid_at"] = datetime.now(timezone.utc).isoformat()
        elif changes["paid"] is False:
            changes["paid_at"] = None
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    changes["updated_by"] = user["user_id"]
    await db.financial_entries.update_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]},
        {"$set": changes},
    )
    doc = await db.financial_entries.find_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    # Auto-generate receipt on paid→true transition (only receitas)
    if (
        changes.get("paid") is True
        and existing.get("paid") is not True
        and doc.get("type") == "receita"
    ):
        try:
            await _generate_receipt_for_entry(entry_id, user["clinic_id"])
            doc = await db.financial_entries.find_one(
                {"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
            )
        except Exception as e:
            logger.warning("auto receipt on PUT failed: %s", e)
    return doc


@api_router.delete("/finance/entries/{entry_id}")
async def delete_entry(entry_id: str, user: dict = Depends(get_current_user)):
    require_finance_write(user)
    await db.financial_entries.delete_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


@api_router.get("/finance/summary")
async def finance_summary(user: dict = Depends(get_current_user)):
    require_finance_read(user)
    docs = await db.financial_entries.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    ).to_list(5000)
    receitas = sum(d["amount"] for d in docs if d["type"] == "receita" and d.get("paid"))
    despesas = sum(d["amount"] for d in docs if d["type"] == "despesa" and d.get("paid"))
    a_receber = sum(d["amount"] for d in docs if d["type"] == "receita" and not d.get("paid"))
    a_pagar = sum(d["amount"] for d in docs if d["type"] == "despesa" and not d.get("paid"))
    # last 6 months chart (calendar-month arithmetic, no duplicates near boundaries)
    today = datetime.now(timezone.utc)
    months = []
    y, mo = today.year, today.month
    buckets = []
    for _ in range(6):
        buckets.append(f"{y:04d}-{mo:02d}")
        mo -= 1
        if mo == 0:
            mo = 12
            y -= 1
    months = list(reversed(buckets))
    chart = []
    for m in months:
        rev = sum(d["amount"] for d in docs if d["type"] == "receita" and d["due_date"].startswith(m))
        exp = sum(d["amount"] for d in docs if d["type"] == "despesa" and d["due_date"].startswith(m))
        chart.append({"mes": m, "receita": rev, "despesa": exp})
    return {
        "receitas": receitas, "despesas": despesas, "saldo": receitas - despesas,
        "a_receber": a_receber, "a_pagar": a_pagar, "chart": chart,
    }


# ============================================================
# Finance — Patient view + Receipts (Fase 2.5C)
# ============================================================
@api_router.get("/finance/patient/{patient_id}/summary")
async def finance_patient_summary(patient_id: str, user: dict = Depends(get_current_user)):
    """Financeiro consolidado de UM paciente: totais + próximas cobranças + histórico."""
    require_finance_read(user)
    q = {"clinic_id": user["clinic_id"], "patient_id": patient_id}
    docs = await db.financial_entries.find(q, {"_id": 0}).sort("due_date", -1).to_list(500)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_pago = sum(d["amount"] for d in docs if d["type"] == "receita" and d.get("paid"))
    total_pendente = sum(d["amount"] for d in docs if d["type"] == "receita" and not d.get("paid"))
    total_vencido = sum(d["amount"] for d in docs if d["type"] == "receita" and not d.get("paid") and (d.get("due_date") or "") < today)
    pending = [d for d in docs if not d.get("paid")]
    proximo_vencimento = min((d.get("due_date") for d in pending if d.get("due_date")), default=None)
    return {
        "total_pago": total_pago,
        "total_pendente": total_pendente,
        "total_vencido": total_vencido,
        "proximo_vencimento": proximo_vencimento,
        "count_total": len(docs),
        "count_pendente": len(pending),
        "entries": docs,
    }


async def _next_receipt_number(clinic_id: str) -> str:
    """REC-YYYY-#### sequencial por clínica+ano (atômico)."""
    year = datetime.now(timezone.utc).year
    res = await db.receipt_counters.find_one_and_update(
        {"clinic_id": clinic_id, "year": year},
        {"$inc": {"next_number": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = int((res or {}).get("next_number", 1))
    return f"REC-{year}-{seq:04d}"


def _build_receipt_pdf(entry: Dict[str, Any], patient: Dict[str, Any], clinic: Dict[str, Any], receipt_number: str) -> bytes:
    amount = float(entry.get("amount") or 0)
    amount_br = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    paid_at_raw = entry.get("paid_at") or entry.get("due_date") or datetime.now(timezone.utc).isoformat()
    try:
        paid_dt = datetime.fromisoformat(paid_at_raw.replace("Z", "+00:00")) if "T" in paid_at_raw else datetime.strptime(paid_at_raw, "%Y-%m-%d")
        paid_str = paid_dt.strftime("%d/%m/%Y")
    except Exception:
        paid_str = paid_at_raw[:10]
    primary = (clinic.get("primary_color") or "#B76E79") if clinic else "#B76E79"
    clinic_name = (clinic.get("name") if clinic else None) or "ProClinic"
    clinic_cnpj = (clinic.get("cnpj") if clinic else None) or "—"
    clinic_addr = (clinic.get("address") if clinic else None) or ""
    method = (entry.get("payment_method") or "—").upper() if entry.get("payment_method") else "—"
    parcel_info = ""
    if entry.get("installment_total") and int(entry["installment_total"]) > 1 and entry.get("installment_number"):
        parcel_info = f"<div>Parcela {entry['installment_number']}/{entry['installment_total']}</div>"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page {{ size: A4; margin: 22mm 20mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; }}
      .brand {{ font-family: Georgia, serif; font-size: 11pt; letter-spacing: 3pt; color: {primary}; text-transform: uppercase; }}
      h1 {{ font-family: Georgia, serif; font-size: 24pt; margin: 2pt 0 6pt; color: #1a1a1a; }}
      .num {{ font-family: monospace; font-size: 12pt; color: #666; margin-bottom: 24pt; }}
      .box {{ border: 1px solid #e6ded7; border-radius: 8pt; padding: 14pt 18pt; margin-bottom: 14pt; }}
      .row {{ display: table; width: 100%; margin: 4pt 0; }}
      .k {{ display: table-cell; width: 40%; color: #7a7a7a; font-size: 10pt; text-transform: uppercase; letter-spacing: 1pt; }}
      .v {{ display: table-cell; font-size: 12pt; }}
      .amount {{ font-family: Georgia, serif; font-size: 32pt; color: {primary}; text-align: right; margin: 20pt 0 4pt; }}
      .paidbox {{ background: #f2fbef; border: 1px solid #cfe9c4; color: #3d7a2a; padding: 10pt 14pt; border-radius: 8pt; font-size: 11pt; text-align: center; margin: 14pt 0; }}
      .footer {{ margin-top: 30pt; font-size: 9pt; color: #999; text-align: center; line-height: 1.5; }}
    </style></head><body>
      <div class="brand">Recibo de Pagamento</div>
      <h1>{clinic_name}</h1>
      <div class="num">Nº <strong>{receipt_number}</strong> · Emitido em {datetime.now(timezone.utc).strftime('%d/%m/%Y')}</div>

      <div class="box">
        <div class="row"><div class="k">Recebemos de</div><div class="v"><strong>{patient.get('name','—')}</strong></div></div>
        {'<div class="row"><div class="k">CPF</div><div class="v">' + patient['cpf'] + '</div></div>' if patient.get('cpf') else ''}
        {'<div class="row"><div class="k">E-mail</div><div class="v">' + patient['email'] + '</div></div>' if patient.get('email') else ''}
      </div>

      <div class="box">
        <div class="row"><div class="k">Referente a</div><div class="v">{entry.get('description','—')}</div></div>
        <div class="row"><div class="k">Categoria</div><div class="v">{entry.get('category','—')}</div></div>
        <div class="row"><div class="k">Forma de pagamento</div><div class="v">{method}</div></div>
        <div class="row"><div class="k">Data do pagamento</div><div class="v">{paid_str}</div></div>
        {parcel_info}
      </div>

      <div class="amount">R$ {amount_br}</div>
      <div class="paidbox">✓ Pagamento confirmado</div>

      <div class="footer">
        <strong>{clinic_name}</strong>{' · CNPJ ' + clinic_cnpj if clinic_cnpj != '—' else ''}<br/>
        {clinic_addr}<br/>
        Este recibo é gerado eletronicamente e válido sem assinatura.
      </div>
    </body></html>"""
    buf = io.BytesIO()
    pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    return buf.getvalue()


async def _persist_receipt_pdf(clinic_id: str, receipt_number: str, pdf_bytes: bytes) -> Dict[str, str]:
    rel_path = f"{APP_NAME}/{clinic_id}/receipts/{receipt_number}.pdf"
    result = put_object(rel_path, pdf_bytes, "application/pdf")
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    sig = make_file_signature(file_id, clinic_id)
    await db.files.insert_one({
        "file_id": file_id, "storage_path": result["path"],
        "original_filename": f"{receipt_number}.pdf", "content_type": "application/pdf",
        "size": result.get("size", len(pdf_bytes)), "clinic_id": clinic_id,
        "is_deleted": False, "signature": sig,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"], "url": f"/api/files/{result['path']}?sig={sig}"}


async def _generate_receipt_for_entry(entry_id: str, clinic_id: str, force: bool = False) -> Optional[Dict[str, Any]]:
    """Idempotent: gera recibo apenas quando entry.paid=True e ainda não tem receipt_number
    (a menos que force=True)."""
    entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": clinic_id}, {"_id": 0})
    if not entry:
        return None
    if not entry.get("paid"):
        return None
    if entry.get("type") != "receita":
        return None
    if entry.get("receipt_number") and not force:
        return {"receipt_number": entry["receipt_number"], "receipt_url": entry.get("receipt_url")}
    receipt_number = await _next_receipt_number(clinic_id)
    patient = {}
    if entry.get("patient_id"):
        patient = await db.patients.find_one({"patient_id": entry["patient_id"], "clinic_id": clinic_id}, {"_id": 0}) or {}
    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0}) or {}
    pdf_bytes = _build_receipt_pdf(entry, patient, clinic, receipt_number)
    stored = await _persist_receipt_pdf(clinic_id, receipt_number, pdf_bytes)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.financial_entries.update_one(
        {"entry_id": entry_id, "clinic_id": clinic_id},
        {"$set": {
            "receipt_number": receipt_number,
            "receipt_url": stored["url"],
            "receipt_generated_at": now_iso,
        }},
    )
    return {"receipt_number": receipt_number, "receipt_url": stored["url"]}


@api_router.post("/finance/entries/{entry_id}/receipt")
async def issue_receipt(entry_id: str, force: bool = False, user: dict = Depends(get_current_user)):
    """Gera ou re-emite o recibo (força regeneração se force=true)."""
    require_finance_write(user)
    result = await _generate_receipt_for_entry(entry_id, user["clinic_id"], force=force)
    if not result:
        raise HTTPException(status_code=400, detail="Lançamento não elegível para recibo (deve ser receita paga)")
    return result


@api_router.get("/finance/entries/{entry_id}/receipt")
async def get_receipt(entry_id: str, user: dict = Depends(get_current_user)):
    require_finance_read(user)
    entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    if not entry.get("receipt_number"):
        # try auto-generate if eligible
        result = await _generate_receipt_for_entry(entry_id, user["clinic_id"])
        if not result:
            raise HTTPException(status_code=404, detail="Recibo ainda não gerado")
        return result
    return {"receipt_number": entry["receipt_number"], "receipt_url": entry.get("receipt_url")}


@api_router.post("/finance/entries/{entry_id}/receipt/email")
async def email_receipt(entry_id: str, payload: Optional[Dict[str, Any]] = None, user: dict = Depends(get_current_user)):
    """Envia o recibo por email para o paciente (ou email custom via payload.email)."""
    require_finance_write(user)
    entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    if not entry.get("paid"):
        raise HTTPException(status_code=400, detail="Só é possível enviar recibo de lançamento pago")
    # ensure receipt exists
    if not entry.get("receipt_number"):
        await _generate_receipt_for_entry(entry_id, user["clinic_id"])
        entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    payload = payload or {}
    to = (payload.get("email") or "").strip()
    patient = {}
    if entry.get("patient_id"):
        patient = await db.patients.find_one({"patient_id": entry["patient_id"], "clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    if not to:
        to = (patient.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Paciente sem email — informe um destinatário via payload.email")
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    # download pdf bytes
    pdf_bytes = None
    try:
        raw_path = entry["receipt_url"].split("?")[0].replace("/api/files/", "")
        # need to lookup file storage_path via files collection
        f_doc = await db.files.find_one({"original_filename": f"{entry['receipt_number']}.pdf", "clinic_id": user["clinic_id"]}, {"_id": 0, "storage_path": 1})
        if f_doc:
            fetched = get_object(f_doc["storage_path"])
            pdf_bytes = fetched[0] if isinstance(fetched, tuple) else fetched
    except Exception as e:
        logger.warning("get_object receipt failed: %s", e)
    if not pdf_bytes:
        pdf_bytes = _build_receipt_pdf(entry, patient, clinic, entry["receipt_number"])
    import base64
    b64 = base64.b64encode(pdf_bytes).decode("ascii") if isinstance(pdf_bytes, (bytes, bytearray)) else None

    amount = float(entry.get("amount") or 0)
    amount_br = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    subject = f"Recibo {entry['receipt_number']} — {clinic.get('name') or 'ProClinic'}"

    def _html(email_log_id: Optional[str], clinic_ctx: Dict[str, Any]) -> str:
        body = f"""
        <p>Olá <strong>{patient.get('name') or 'cliente'}</strong>,</p>
        <p>Segue o recibo do seu pagamento no valor de <strong>R$ {amount_br}</strong> referente a <em>{entry.get('description','')}</em>.</p>
        <p>O recibo em PDF está anexo a este email.</p>
        <p>Agradecemos pela preferência!</p>"""
        return _email_shell(
            title=f"Recibo {entry['receipt_number']}",
            body_html=body,
            clinic=clinic_ctx,
            email_log_id=email_log_id,
        )

    attachment = None
    if b64:
        attachment = {"filename": f"{entry['receipt_number']}.pdf", "content": b64, "content_type": "application/pdf"}
    idem = f"receipt_email:{entry['entry_id']}:{to}"
    email_id = await send_email(
        to=to,
        subject=subject,
        html_builder=_html,
        idempotency_key=idem,
        attachment=attachment,
        clinic_id=user["clinic_id"],
    )
    await db.financial_entries.update_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]},
        {"$set": {"receipt_sent_email_at": datetime.now(timezone.utc).isoformat(), "receipt_sent_email_to": to}},
    )
    return {"ok": True, "email_id": email_id, "to": to}


@api_router.get("/finance/entries/{entry_id}/receipt/whatsapp-link")
async def whatsapp_receipt_link(entry_id: str, user: dict = Depends(get_current_user)):
    """Retorna um link wa.me pronto para o usuário abrir/compartilhar no WhatsApp com o paciente.
    Não depende da Evolution API — usa o link nativo do WhatsApp."""
    require_finance_read(user)
    entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    if not entry.get("paid"):
        raise HTTPException(status_code=400, detail="Só é possível compartilhar recibo de lançamento pago")
    if not entry.get("receipt_number"):
        await _generate_receipt_for_entry(entry_id, user["clinic_id"])
        entry = await db.financial_entries.find_one({"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    patient = {}
    if entry.get("patient_id"):
        patient = await db.patients.find_one({"patient_id": entry["patient_id"], "clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    phone_raw = patient.get("phone") or ""
    phone_digits = re.sub(r"\D", "", phone_raw)
    # Prepend BR country code if missing (best-effort)
    if phone_digits and not phone_digits.startswith("55") and len(phone_digits) in (10, 11):
        phone_digits = "55" + phone_digits
    amount = float(entry.get("amount") or 0)
    amount_br = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    full_url = f"{frontend_url}{entry.get('receipt_url','')}" if entry.get("receipt_url","").startswith("/") else entry.get("receipt_url","")
    msg = (
        f"Olá {patient.get('name') or 'cliente'}! Aqui está o seu recibo *{entry['receipt_number']}* "
        f"no valor de *R$ {amount_br}* referente a: {entry.get('description','')}.\n\n"
        f"Acesse o PDF: {full_url}\n\n"
        f"— {clinic.get('name') or 'ProClinic'}"
    )
    import urllib.parse
    encoded = urllib.parse.quote(msg)
    wa_link = f"https://wa.me/{phone_digits}?text={encoded}" if phone_digits else f"https://wa.me/?text={encoded}"
    return {"whatsapp_url": wa_link, "phone": phone_digits or None, "receipt_number": entry["receipt_number"]}


# ============================================================
# Dashboard
# ============================================================
@api_router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    clinic_id = user["clinic_id"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")

    total_patients = await db.patients.count_documents({"clinic_id": clinic_id})
    new_this_month = await db.patients.count_documents({
        "clinic_id": clinic_id,
        "created_at": {"$regex": f"^{month_prefix}"},
    })
    today_apts = await db.appointments.find(
        {"clinic_id": clinic_id, "start": {"$gte": today, "$lt": tomorrow}},
        {"_id": 0},
    ).sort("start", 1).to_list(100)
    confirmed_today = sum(1 for a in today_apts if a["status"] == "confirmado")

    # revenue this month (paid receitas)
    fin = await db.financial_entries.find(
        {"clinic_id": clinic_id, "type": "receita", "paid": True,
         "due_date": {"$regex": f"^{month_prefix}"}}, {"_id": 0, "amount": 1}
    ).to_list(2000)
    revenue_month = sum(f["amount"] for f in fin)

    # aniversariantes (mês atual)
    month_num = datetime.now(timezone.utc).strftime("-%m-")
    bdays = await db.patients.find(
        {"clinic_id": clinic_id, "birth_date": {"$regex": month_num}},
        {"_id": 0, "name": 1, "birth_date": 1, "photo_url": 1, "patient_id": 1},
    ).to_list(50)

    # ocupação agenda hoje
    occupancy_pct = min(100, int((len(today_apts) / 12) * 100))  # assume 12 slots/day

    # top procedimentos
    pipeline = [
        {"$match": {"clinic_id": clinic_id, "start": {"$regex": f"^{month_prefix}"}}},
        {"$group": {"_id": "$procedure", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]
    top_proc_raw = await db.appointments.aggregate(pipeline).to_list(10)
    top_procedures = [{"name": p["_id"], "count": p["count"]} for p in top_proc_raw]

    return {
        "total_patients": total_patients,
        "new_this_month": new_this_month,
        "appointments_today": len(today_apts),
        "confirmed_today": confirmed_today,
        "revenue_month": revenue_month,
        "today_agenda": today_apts,
        "birthdays": bdays,
        "occupancy_pct": occupancy_pct,
        "top_procedures": top_procedures,
    }


# ============================================================
# AI Assistant
# ============================================================
@api_router.post("/ai/chat")
async def ai_chat(data: AIChatIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    await require_feature("ai", user)
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Chave LLM não configurada")
    session_id = data.session_id or f"sess_{user['user_id']}_{uuid.uuid4().hex[:8]}"
    system = (
        "Você é uma assistente clínica especializada em estética avançada e harmonização facial, "
        "integrada ao sistema ProClinic. Sua função é apoiar profissionais e equipe administrativa "
        "com: sugestões de protocolos clínicos (sempre lembrando que decisão final é do profissional), "
        "resumos clínicos, recomendações pós-procedimento, organização administrativa e orientações gerais. "
        "Responda sempre em português do Brasil, de forma sofisticada, clara e objetiva. "
        "Use formatação limpa (listas curtas, negrito quando necessário). Nunca prescreva medicamentos."
    )
    if data.context:
        system += f"\n\nContexto do paciente atual: {data.context}"

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    msg = UserMessage(text=data.message)
    try:
        reply = await chat.send_message(msg)
    except Exception as e:
        logger.exception("AI chat error")
        raise HTTPException(status_code=500, detail=f"Erro IA: {str(e)}")
    # save history
    await db.ai_messages.insert_one({
        "session_id": session_id,
        "user_id": user["user_id"],
        "role": "user",
        "content": data.message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.ai_messages.insert_one({
        "session_id": session_id,
        "user_id": user["user_id"],
        "role": "assistant",
        "content": reply,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"reply": reply, "session_id": session_id}


@api_router.get("/ai/history")
async def ai_history(session_id: str, user: dict = Depends(get_current_user)):
    docs = await db.ai_messages.find(
        {"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return docs


# ============================================================
# Seed Data
# ============================================================
async def seed_data():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.patients.create_index("patient_id", unique=True)
    await db.appointments.create_index("appointment_id", unique=True)

    # Clinic
    clinic = await db.clinics.find_one({}, {"_id": 0})
    if not clinic:
        clinic_id = f"clinic_{uuid.uuid4().hex[:12]}"
        await db.clinics.insert_one({
            "clinic_id": clinic_id,
            "name": "ProClinic Demo",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        clinic_id = clinic["clinic_id"]

    # Admin user
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@proclinic.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    admin = await db.users.find_one({"email": admin_email})
    if not admin:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "name": "Administrador",
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "clinic_id": clinic_id,
            "auth_provider": "email",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Admin seeded: {admin_email}")
    elif not verify_password(admin_password, admin["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )

    # Demo professionals
    prof = await db.users.find_one({"email": "dra.bella@proclinic.com"})
    if not prof:
        prof_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": prof_id,
            "email": "dra.bella@proclinic.com",
            "name": "Dra. Bella Castro",
            "cpf": "111.222.333-44",
            "cpf_digits": "11122233344",
            "password_hash": hash_password("bella123"),
            "role": "profissional",
            "clinic_id": clinic_id,
            "auth_provider": "email",
            "council": "CRM",
            "council_number": "12345",
            "specialty": "Dermatologia",
            "color": "#B76E79",
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        prof = await db.users.find_one({"email": "dra.bella@proclinic.com"})

    prof2 = await db.users.find_one({"email": "dra.lais@proclinic.com"})
    if not prof2:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": "dra.lais@proclinic.com",
            "name": "Dra. Laís Monteiro",
            "cpf": "222.333.444-55",
            "cpf_digits": "22233344455",
            "password_hash": hash_password("lais123"),
            "role": "profissional",
            "clinic_id": clinic_id,
            "auth_provider": "email",
            "council": "CRBM",
            "council_number": "67890",
            "specialty": "Biomedicina Estética",
            "color": "#7F9CF5",
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Demo receptionist
    rec = await db.users.find_one({"email": "ana.recep@proclinic.com"})
    if not rec:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": "ana.recep@proclinic.com",
            "name": "Ana Recepção",
            "cpf": "333.444.555-66",
            "cpf_digits": "33344455566",
            "password_hash": hash_password("ana123"),
            "role": "recepcao",
            "clinic_id": clinic_id,
            "auth_provider": "email",
            "color": "#A0AEC0",
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Demo patients
    if await db.patients.count_documents({"clinic_id": clinic_id}) == 0:
        demo_patients = [
            {"name": "Marina Albuquerque", "cpf": "123.456.789-00", "birth_date": "1990-03-15",
             "phone": "(11) 99876-1234", "whatsapp": "(11) 99876-1234",
             "email": "marina@example.com", "city": "São Paulo", "state": "SP",
             "allergies": "Lidocaína", "lgpd_consent": True},
            {"name": "Camila Ribeiro", "cpf": "987.654.321-00", "birth_date": "1988-07-22",
             "phone": "(11) 98765-4321", "email": "camila@example.com",
             "city": "São Paulo", "state": "SP", "lgpd_consent": True},
            {"name": "Helena Vasconcelos", "cpf": "456.789.123-00", "birth_date": "1995-11-08",
             "phone": "(11) 97654-3210", "email": "helena@example.com",
             "city": "Rio de Janeiro", "state": "RJ", "lgpd_consent": True},
            {"name": "Renata Monteiro", "cpf": "321.654.987-00", "birth_date": "1985-02-28",
             "phone": "(11) 96543-2109", "email": "renata@example.com",
             "city": "São Paulo", "state": "SP", "lgpd_consent": True},
        ]
        for p in demo_patients:
            p.update({
                "patient_id": f"pat_{uuid.uuid4().hex[:12]}",
                "clinic_id": clinic_id,
                "status": "ativo",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.patients.insert_one(p)

        # Demo appointments for today + week
        patients_list = await db.patients.find({"clinic_id": clinic_id}, {"_id": 0}).to_list(20)
        profs = await db.users.find({"clinic_id": clinic_id, "role": "profissional"}, {"_id": 0}).to_list(10)
        today = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
        procedures = ["Botox", "Preenchimento Labial", "Limpeza de Pele", "Microagulhamento",
                      "Bioestimulador", "Ultraformer", "Harmonização Facial", "Laser Facial"]
        statuses = ["confirmado", "agendado", "confirmado", "concluido", "agendado"]
        for i, pat in enumerate(patients_list):
            for day_offset in range(0, 5):
                start = today + timedelta(days=day_offset, hours=i*2)
                end = start + timedelta(hours=1, minutes=30)
                pr = profs[(i + day_offset) % len(profs)] if profs else None
                await db.appointments.insert_one({
                    "appointment_id": f"apt_{uuid.uuid4().hex[:12]}",
                    "clinic_id": clinic_id,
                    "patient_id": pat["patient_id"],
                    "patient_name": pat["name"],
                    "professional_id": pr.get("user_id") if pr else None,
                    "professional_name": pr.get("name") if pr else "Dra. Bella Castro",
                    "professional_color": pr.get("color") if pr else "#B76E79",
                    "procedure": procedures[(i + day_offset) % len(procedures)],
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "status": statuses[(i + day_offset) % len(statuses)],
                    "room": f"Sala {((i + day_offset) % 3) + 1}",
                    "price": 500 + (i * 100),
                    "notes": "",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

        # Financial entries
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        prev_month = (datetime.now(timezone.utc).replace(day=1) - timedelta(days=15)).strftime("%Y-%m")
        for entry in [
            {"type": "receita", "category": "Procedimentos", "description": "Botox - Marina",
             "amount": 1200, "due_date": f"{month}-05", "paid": True, "payment_method": "pix"},
            {"type": "receita", "category": "Procedimentos", "description": "Preenchimento - Camila",
             "amount": 1800, "due_date": f"{month}-08", "paid": True, "payment_method": "cartão"},
            {"type": "receita", "category": "Procedimentos", "description": "Ultraformer - Helena",
             "amount": 3500, "due_date": f"{month}-12", "paid": False, "payment_method": "pix"},
            {"type": "despesa", "category": "Insumos", "description": "Toxina botulínica - lote",
             "amount": 4500, "due_date": f"{month}-03", "paid": True, "payment_method": "boleto"},
            {"type": "despesa", "category": "Aluguel", "description": "Aluguel Sala 1",
             "amount": 2800, "due_date": f"{month}-10", "paid": True, "payment_method": "boleto"},
            {"type": "receita", "category": "Pacote", "description": "Pacote Laser - Renata",
             "amount": 4200, "due_date": f"{prev_month}-15", "paid": True, "payment_method": "cartão"},
            {"type": "despesa", "category": "Marketing", "description": "Anúncios Instagram",
             "amount": 800, "due_date": f"{prev_month}-20", "paid": True, "payment_method": "cartão"},
        ]:
            entry.update({
                "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                "clinic_id": clinic_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.financial_entries.insert_one(entry)

    # Migration: ensure seeded professionals have all required fields
    seed_cpfs = {
        "dra.bella@proclinic.com": ("111.222.333-44", "Dermatologia", "CRM", "12345", "#B76E79"),
        "dra.lais@proclinic.com": ("222.333.444-55", "Biomedicina Estética", "CRBM", "67890", "#7F9CF5"),
        "ana.recep@proclinic.com": ("333.444.555-66", None, None, None, "#A0AEC0"),
    }
    async for u in db.users.find({"clinic_id": clinic_id}):
        updates = {}
        seed = seed_cpfs.get(u["email"])
        if seed and not u.get("cpf"):
            updates["cpf"] = seed[0]
            updates["specialty"] = seed[1]
            updates["council"] = seed[2]
            updates["council_number"] = seed[3]
            updates["color"] = seed[4]
        if u.get("cpf") and not u.get("cpf_digits"):
            updates["cpf_digits"] = "".join(c for c in u["cpf"] if c.isdigit())
        if not u.get("color") and u.get("role") == "profissional":
            updates["color"] = "#B76E79"
        if "active" not in u:
            updates["active"] = True
        if updates:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": updates})

    logger.info("Seed complete")


# ============================================================
# Object Storage (Emergent)
# ============================================================
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "proclinic"
_storage_key: Optional[str] = None


def init_storage() -> Optional[str]:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_LLM_KEY:
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        logger.info("Object storage initialized")
        return _storage_key
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Object storage indisponível")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 403:
        # refresh key
        global _storage_key
        _storage_key = None
        key = init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    r.raise_for_status()
    return r.json()


def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Object storage indisponível")
    r = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


_MIME_BY_EXT = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
}


def make_file_signature(file_id: str, clinic_id: str) -> str:
    """Long-lived signature for serving image files without runtime user auth."""
    payload = {
        "scope": "file_sig",
        "fid": file_id,
        "clinic": clinic_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=365),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


_ALLOWED_UPLOAD_MIMES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
}


@api_router.post("/uploads")
async def upload_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    raw = await file.read()
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 12MB")
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower()
    content_type = file.content_type or _MIME_BY_EXT.get(ext, "application/octet-stream")
    if content_type not in _ALLOWED_UPLOAD_MIMES:
        raise HTTPException(status_code=400, detail=f"Tipo de arquivo não permitido: {content_type}")
    if ".." in file.filename or "/" in file.filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido")
    path = f"{APP_NAME}/{user['clinic_id']}/{user['user_id']}/{uuid.uuid4()}.{ext}"
    result = put_object(path, raw, content_type)
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    sig = make_file_signature(file_id, user["clinic_id"])
    doc = {
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(raw)),
        "clinic_id": user["clinic_id"],
        "uploaded_by": user["user_id"],
        "uploaded_by_name": user.get("name"),
        "is_deleted": False,
        "signature": sig,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(doc)
    return {
        "file_id": file_id,
        "url": f"/api/files/{result['path']}?sig={sig}",
        "path": result["path"],
        "signature": sig,
        "content_type": content_type,
        "size": doc["size"],
        "uploaded_at": doc["created_at"],
        "uploaded_by_name": user.get("name"),
    }


@api_router.get("/files/{path:path}")
async def serve_file(path: str, request: Request, sig: Optional[str] = Query(None), auth: Optional[str] = Query(None)):
    """Serve image file. Auth via signed URL (preferred, long-lived) OR user auth fallback."""
    # 1. Try signed URL (no DB lookup yet, validate token only)
    if sig:
        try:
            p = jwt.decode(sig, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if p.get("scope") == "file_sig":
                rec = await db.files.find_one(
                    {"storage_path": path, "is_deleted": False, "clinic_id": p["clinic"]},
                    {"_id": 0},
                )
                if rec:
                    data, ct = get_object(path)
                    return Response(content=data, media_type=rec.get("content_type", ct))
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Link de imagem expirado")
        except jwt.InvalidTokenError:
            pass
    # 2. Fallback to user auth
    if auth:
        try:
            payload = jwt.decode(auth, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
            if not user:
                raise HTTPException(status_code=401, detail="Inválido")
        except Exception:
            raise HTTPException(status_code=401, detail="Inválido")
    else:
        user = await get_current_user(request)
    rec = await db.files.find_one(
        {"storage_path": path, "is_deleted": False, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    data, ct = get_object(path)
    return Response(content=data, media_type=rec.get("content_type", ct))


# ============================================================
# Premium Anamnesis (multi-module)
# ============================================================
class AnamnesisModuleIn(BaseModel):
    patient_id: str
    module: Literal["geral", "facial", "corporal", "capilar"]
    answers: Dict[str, Any]
    photos: Optional[List[str]] = None
    signature: Optional[str] = None  # base64 png
    signed: bool = False


@api_router.get("/anamnesis-modules")
async def list_anamnesis_modules(user: dict = Depends(get_current_user), patient_id: Optional[str] = None):
    forbid_recepcao_clinical(user)
    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id é obrigatório")
    q = role_record_filter(user)
    q["patient_id"] = patient_id
    docs = await db.anamnesis_modules.find(q, {"_id": 0}).to_list(20)
    return docs


@api_router.post("/anamnesis-modules")
async def save_anamnesis_module(data: AnamnesisModuleIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    # Each profissional has own module; admin shares per clinic
    q = {"patient_id": data.patient_id, "clinic_id": user["clinic_id"], "module": data.module}
    if user.get("role") == "profissional":
        q["created_by"] = user["user_id"]
    existing = await db.anamnesis_modules.find_one(q, {"_id": 0})
    doc = data.model_dump()
    doc.update({
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"],
        "created_by": existing.get("created_by") if existing else user["user_id"],
        "created_by_name": existing.get("created_by_name") if existing else user["name"],
        "updated_by": user["user_id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    if existing:
        doc["module_id"] = existing["module_id"]
        doc["created_at"] = existing.get("created_at", doc["updated_at"])
        await db.anamnesis_modules.update_one(
            {"module_id": existing["module_id"]}, {"$set": doc}
        )
    else:
        doc["module_id"] = f"anm_{uuid.uuid4().hex[:12]}"
        doc["created_at"] = doc["updated_at"]
        await db.anamnesis_modules.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ============================================================
# Attendance Sessions (atendimento clínico)
# ============================================================
class AttendanceSessionIn(BaseModel):
    appointment_id: Optional[str] = None
    patient_id: str
    procedure: Optional[str] = None
    professional_name: Optional[str] = None
    evolution: Optional[str] = ""
    observations: Optional[str] = ""
    protocols: Optional[str] = ""
    prescriptions: Optional[str] = ""
    products_used: Optional[str] = ""
    photos_before: List[str] = []
    photos_after: List[str] = []
    consent_signature: Optional[str] = None  # base64
    evolution_signature: Optional[str] = None  # base64
    status: Literal["rascunho", "concluido"] = "rascunho"
    duration_seconds: Optional[int] = 0


@api_router.post("/attendance/start")
async def start_attendance(
    payload: Dict[str, Any], user: dict = Depends(get_current_user)
):
    """Start (or resume) an attendance session for an appointment."""
    forbid_recepcao_clinical(user)
    appointment_id = payload.get("appointment_id")
    if not appointment_id:
        raise HTTPException(status_code=400, detail="appointment_id obrigatório")
    apt = await db.appointments.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    existing = await db.attendance_sessions.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if existing:
        return existing
    now_iso = datetime.now(timezone.utc).isoformat()
    session = {
        "session_id": f"att_{uuid.uuid4().hex[:12]}",
        "appointment_id": appointment_id,
        "patient_id": apt["patient_id"],
        "patient_name": apt.get("patient_name", ""),
        "procedure": apt.get("procedure"),
        "procedure_id": apt.get("procedure_id"),                # ⭐ carrega FK
        "professional_id": apt.get("professional_id"),          # ⭐ carrega FK
        "professional_name": apt.get("professional_name"),
        "clinic_id": user["clinic_id"],
        "status": "rascunho",
        "evolution": "",
        "observations": "",
        "protocols": "",
        "prescriptions": "",
        "products_used": "",
        "photos_before": [],
        "photos_after": [],
        "consent_signature": None,
        "evolution_signature": None,
        "duration_seconds": 0,
        "started_at": now_iso,
        "started_by": user["user_id"],                          # ⭐ auditoria
        "updated_at": now_iso,
    }
    await db.attendance_sessions.insert_one(session)
    session.pop("_id", None)
    # ⭐ Problema 2: marca o appointment como "em_atendimento"
    await db.appointments.update_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"],
         "status": {"$nin": ["concluido", "cancelado"]}},
        {"$set": {
            "status": "em_atendimento",
            "attendance_started_at": now_iso,
            "attendance_started_by": user["user_id"],
        }},
    )
    return session


@api_router.put("/attendance/{session_id}")
async def update_attendance(
    session_id: str, data: AttendanceSessionIn, request: Request, user: dict = Depends(get_current_user)
):
    """Autosave attendance session draft. Identity fields (appointment_id, patient_id)
    cannot be mutated here — only session content."""
    forbid_recepcao_clinical(user)
    update = data.model_dump(exclude_unset=True)
    # Identity fields are immutable post-creation
    update.pop("appointment_id", None)
    update.pop("patient_id", None)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.attendance_sessions.update_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    doc = await db.attendance_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.post("/attendance/{session_id}/sign")
async def sign_attendance(
    session_id: str,
    payload: Dict[str, Any],
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Captura assinatura com METADADOS forenses (Correção 4+5):
    payload = {type: 'consent'|'evolution', signature: <base64 PNG>, timezone?: str}
    Persiste também: signed_at (server-side), signed_by (user_id), signed_by_name,
    ip (best-effort), timezone (client-side), session_id, appointment_id, patient_id, sha256 hash.
    """
    forbid_recepcao_clinical(user)
    sig_type = payload.get("type")
    signature = payload.get("signature")
    tz = payload.get("timezone") or "UTC"
    if sig_type not in {"consent", "evolution"}:
        raise HTTPException(status_code=400, detail="type deve ser 'consent' ou 'evolution'")
    if not signature or not isinstance(signature, str) or len(signature) < 100:
        raise HTTPException(status_code=400, detail="Assinatura vazia ou inválida")

    sess = await db.attendance_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not sess:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    import hashlib
    sig_hash = hashlib.sha256(signature.encode("utf-8")).hexdigest()
    client_ip = None
    try:
        # Best-effort — priorizando X-Forwarded-For (proxies)
        xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
        client_ip = (xff.split(",")[0].strip() if xff else None) or (request.client.host if request.client else None)
    except Exception:
        client_ip = None
    now_iso = datetime.now(timezone.utc).isoformat()
    meta = {
        "signed_at": now_iso,
        "signed_by": user["user_id"],
        "signed_by_name": user.get("name"),
        "timezone": tz,
        "ip": client_ip,
        "session_id": session_id,
        "appointment_id": sess.get("appointment_id"),
        "patient_id": sess.get("patient_id"),
        "sha256": sig_hash,
    }
    field_sig = f"{sig_type}_signature"      # consent_signature | evolution_signature
    field_meta = f"{sig_type}_signature_meta"  # consent_signature_meta | evolution_signature_meta
    await db.attendance_sessions.update_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"$set": {field_sig: signature, field_meta: meta,
                  "updated_at": now_iso}},
    )
    return {"ok": True, "meta": meta}


class FinalizeAttendanceIn(BaseModel):
    payment_status: Optional[Literal["pago", "parcial", "nao_pago"]] = None
    amount_total: Optional[float] = None       # if not provided, uses appt.price or budget.total
    amount_paid: Optional[float] = None        # required for parcial
    payment_method: Optional[str] = None       # pix | cartão | dinheiro | boleto | parcelado
    budget_id: Optional[str] = None            # link to a budget if any
    due_date: Optional[str] = None             # for parcial/nao_pago balance (first installment)
    installments: int = 1                      # ⭐ intelligent installments (1..48)
    installment_interval_days: int = 30        # spacing between due dates


@api_router.post("/attendance/{session_id}/finalize")
async def finalize_attendance(
    session_id: str,
    payload: Optional[FinalizeAttendanceIn] = None,
    request: Request = None,
    user: dict = Depends(get_current_user),
):
    """Finalize: marks session concluida, copies into medical_records, marks appointment concluido,
    and (optionally) creates financial entry(ies) based on payment_status.
    ⭐ IDEMPOTENTE: se a sessão já foi finalizada, retorna o resultado cacheado sem duplicar."""
    forbid_recepcao_clinical(user)
    sess = await db.attendance_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not sess:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # ===== IDEMPOTÊNCIA (Fase 2.5D) =====
    # Se a sessão já foi finalizada, retorna o resultado cacheado — não duplica nada
    if sess.get("status") == "concluido" and sess.get("finalized_result"):
        return sess["finalized_result"]

    # Lock transacional: marca "finalizing" imediatamente para bloquear requisições paralelas
    now_iso = datetime.now(timezone.utc).isoformat()
    lock_res = await db.attendance_sessions.update_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"],
         "status": {"$ne": "concluido"}, "finalizing": {"$ne": True}},
        {"$set": {"finalizing": True, "finalizing_at": now_iso}},
    )
    if lock_res.matched_count == 0:
        # Alguém pegou o lock antes — busca resultado cacheado
        sess = await db.attendance_sessions.find_one(
            {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
        )
        if sess and sess.get("finalized_result"):
            return sess["finalized_result"]
        raise HTTPException(status_code=409, detail="Sessão já está sendo finalizada")

    try:
        # ===== session_number sequencial (Problema 3) =====
        year = datetime.now(timezone.utc).year
        counter_res = await db.session_counters.find_one_and_update(
            {"clinic_id": user["clinic_id"], "year": year},
            {"$inc": {"next_number": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        seq = int((counter_res or {}).get("next_number", 1))
        session_number = f"ATT-{year}-{seq:06d}"

        # ===== enrichment para medical_record =====
        appt_ctx = None
        if sess.get("appointment_id"):
            appt_ctx = await db.appointments.find_one(
                {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
                {"_id": 0},
            )
        professional_id_ctx = (appt_ctx or {}).get("professional_id") or sess.get("professional_id")
        procedure_id_ctx = (appt_ctx or {}).get("procedure_id") or sess.get("procedure_id")

        # ===== Fase 2 - Integridade Clínica: snapshot da FichaForm =====
        # Snapshot dos módulos de anamnese (geral/facial/corporal/capilar) do paciente
        # NO MOMENTO do finalize. Preserva o estado da ficha nesta sessão específica.
        ficha_query = {"clinic_id": user["clinic_id"], "patient_id": sess["patient_id"]}
        # Se profissional, restringir aos módulos do próprio profissional
        if user.get("role") == "profissional":
            ficha_query["created_by"] = user["user_id"]
        ficha_docs = await db.anamnesis_modules.find(ficha_query, {"_id": 0}).to_list(20)
        ficha_snapshot = {}
        for fd in ficha_docs:
            mod_name = fd.get("module")
            if mod_name in {"geral", "facial", "corporal", "capilar"}:
                ficha_snapshot[mod_name] = {
                    "module_id": fd.get("module_id"),
                    "answers": fd.get("answers") or {},
                    "photos": fd.get("photos") or [],
                    "captured_at": fd.get("updated_at") or fd.get("created_at"),
                }

        # create medical record (com session_id + session_number + IDs relacionais + snapshot da ficha)
        record = {
            "record_id": f"rec_{uuid.uuid4().hex[:12]}",
            "session_id": session_id,                       # ⭐ vínculo direto (Problema 3)
            "session_number": session_number,               # ⭐ ATT-YYYY-######
            "appointment_id": sess.get("appointment_id"),   # ⭐ FK explícita
            "professional_id": professional_id_ctx,         # ⭐ FK explícita
            "procedure_id": procedure_id_ctx,               # ⭐ FK ao catálogo
            "clinic_id": user["clinic_id"],
            "patient_id": sess["patient_id"],
            "patient_name": sess.get("patient_name"),
            "procedure": sess.get("procedure") or "Atendimento",
            "professional_name": sess.get("professional_name"),
            "evolution": sess.get("evolution") or "",
            "observations": sess.get("observations") or "",
            "protocols": sess.get("protocols") or "",
            "prescriptions": sess.get("prescriptions") or "",
            "photos_before": sess.get("photos_before") or [],
            "photos_after": sess.get("photos_after") or [],
            "signed": bool(sess.get("evolution_signature")),
            "signature": sess.get("evolution_signature"),
            "consent_signature": sess.get("consent_signature"),  # ⭐ agora preservado
            "consent_signature_meta": sess.get("consent_signature_meta"),      # ⭐ Correção 4+5
            "evolution_signature_meta": sess.get("evolution_signature_meta"),  # ⭐ Correção 5
            "ficha_snapshot": ficha_snapshot,                                   # ⭐ Fase 2 (Integridade Clínica)
            "duration_seconds": sess.get("duration_seconds") or 0,
            "created_by": user["user_id"],
            "created_by_name": user["name"],
            "created_at": now_iso,
        }
        await db.medical_records.insert_one(record)
        record.pop("_id", None)

        # mark session concluida
        duration_min = round((sess.get("duration_seconds") or 0) / 60)
        await db.attendance_sessions.update_one(
            {"session_id": session_id},
            {"$set": {
                "status": "concluido",
                "session_number": session_number,
                "finalized_at": now_iso,
                "finalized_by": user["user_id"],
                "finalizing": False,
            }},
        )
        # mark appointment concluido + finished metadata (Problema 2)
        if sess.get("appointment_id"):
            await db.appointments.update_one(
                {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
                {"$set": {
                    "status": "concluido",
                    "finished_at": now_iso,
                    "finished_by": user["user_id"],
                    "duration_minutes": duration_min,
                }},
            )

        # ===== Automatic financial registration =====
        fin_created: List[str] = []
        if payload and payload.payment_status:
            # determine total: budget total > payload.amount_total > appointment.price > 0
            total = None
            budget_doc = None
            if payload.budget_id:
                budget_doc = await db.budgets.find_one(
                    {"budget_id": payload.budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
                )
                if budget_doc:
                    total = budget_doc.get("total")
            appt_doc = None
            if sess.get("appointment_id"):
                appt_doc = await db.appointments.find_one(
                    {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
                    {"_id": 0},
                )
            if total is None and payload.amount_total is not None:
                total = float(payload.amount_total)
            if total is None and appt_doc:
                total = float(appt_doc.get("price") or 0)
            total = float(total or 0)
    
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            category = "Procedimentos"
            description = f"{sess.get('procedure') or 'Atendimento'} — {sess.get('patient_name') or ''}".strip(" —")
            # enrich professional_id + procedure_id from appointment or session
            procedure_id_ctx = (appt_doc or {}).get("procedure_id") or sess.get("procedure_id")
            professional_id_ctx = (appt_doc or {}).get("professional_id") or sess.get("professional_id")
            now_iso = datetime.now(timezone.utc).isoformat()
            base_entry = {
                "clinic_id": user["clinic_id"],
                "type": "receita",
                "category": category,
                "patient_id": sess["patient_id"],
                "appointment_id": sess.get("appointment_id"),
                "session_id": session_id,
                "session_number": session_number,
                "budget_id": payload.budget_id,
                "procedure_id": procedure_id_ctx,
                "professional_id": professional_id_ctx,
                "payment_method": payload.payment_method,
                "created_at": now_iso,
                "updated_at": now_iso,
                "created_by": user["user_id"],
            }
    
            n_installments = max(1, min(48, int(payload.installments or 1)))
            interval_days = max(1, int(payload.installment_interval_days or 30))
            group_id = f"grp_{uuid.uuid4().hex[:12]}" if n_installments > 1 else None
    
            def _add_days(iso_ymd: str, days: int) -> str:
                try:
                    dt = datetime.strptime(iso_ymd, "%Y-%m-%d")
                except Exception:
                    dt = datetime.now(timezone.utc)
                return (dt + timedelta(days=days)).strftime("%Y-%m-%d")
    
            if payload.payment_status == "pago":
                entry = {**base_entry,
                         "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                         "description": description,
                         "amount": total,
                         "due_date": today,
                         "paid": True,
                         "paid_at": now_iso,
                         "installment_group_id": None,
                         "installment_number": 1,
                         "installment_total": 1}
                entry["installment_group_id"] = entry["entry_id"]
                await db.financial_entries.insert_one(entry)
                fin_created.append(entry["entry_id"])
            elif payload.payment_status == "parcial":
                paid_amt = float(payload.amount_paid or 0)
                if paid_amt > total:
                    raise HTTPException(status_code=400, detail="Valor pago não pode ser maior que o total")
                balance = max(0.0, total - paid_amt)
                if paid_amt > 0:
                    e1 = {**base_entry,
                          "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                          "description": f"{description} (entrada)",
                          "amount": paid_amt,
                          "due_date": today,
                          "paid": True,
                          "paid_at": now_iso}
                    e1["installment_group_id"] = group_id or e1["entry_id"]
                    e1["installment_number"] = 0  # entrada
                    e1["installment_total"] = n_installments
                    await db.financial_entries.insert_one(e1)
                    fin_created.append(e1["entry_id"])
                if balance > 0:
                    # Split balance into n_installments
                    base_first_due = payload.due_date or _add_days(today, interval_days)
                    per_installment = round(balance / n_installments, 2)
                    remainder = round(balance - per_installment * n_installments, 2)
                    for i in range(n_installments):
                        amt = per_installment + (remainder if i == n_installments - 1 else 0)
                        due = _add_days(base_first_due, i * interval_days)
                        ei = {**base_entry,
                              "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                              "description": f"{description} (parcela {i+1}/{n_installments})" if n_installments > 1 else f"{description} (saldo)",
                              "amount": amt,
                              "due_date": due,
                              "paid": False,
                              "installment_group_id": group_id or f"grp_{uuid.uuid4().hex[:12]}",
                              "installment_number": i + 1,
                              "installment_total": n_installments}
                        await db.financial_entries.insert_one(ei)
                        fin_created.append(ei["entry_id"])
            elif payload.payment_status == "nao_pago":
                base_first_due = payload.due_date or today
                per_installment = round(total / n_installments, 2)
                remainder = round(total - per_installment * n_installments, 2)
                for i in range(n_installments):
                    amt = per_installment + (remainder if i == n_installments - 1 else 0)
                    due = _add_days(base_first_due, i * interval_days)
                    ei = {**base_entry,
                          "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                          "description": f"{description} (parcela {i+1}/{n_installments})" if n_installments > 1 else description,
                          "amount": amt,
                          "due_date": due,
                          "paid": False,
                          "installment_group_id": group_id or f"grp_{uuid.uuid4().hex[:12]}",
                          "installment_number": i + 1,
                          "installment_total": n_installments}
                    await db.financial_entries.insert_one(ei)
                    fin_created.append(ei["entry_id"])
    
            # link budget → approved
            if budget_doc:
                await db.budgets.update_one(
                    {"budget_id": payload.budget_id},
                    {"$set": {"status": "aprovado", "approved_at": datetime.now(timezone.utc).isoformat()}},
                )
    
            # Auto-generate receipts for every paid entry created here
            for eid in fin_created:
                try:
                    e_doc = await db.financial_entries.find_one({"entry_id": eid, "clinic_id": user["clinic_id"]}, {"_id": 0, "paid": 1, "type": 1})
                    if e_doc and e_doc.get("paid") and e_doc.get("type") == "receita":
                        await _generate_receipt_for_entry(eid, user["clinic_id"])
                except Exception as e:
                    logger.warning("auto receipt on finalize failed for %s: %s", eid, e)

        # Cache o resultado no session para idempotência de re-chamadas
        result = {
            "ok": True,
            "record_id": record["record_id"],
            "session_number": session_number,
            "financial_entries": fin_created,
        }
        await db.attendance_sessions.update_one(
            {"session_id": session_id, "clinic_id": user["clinic_id"]},
            {"$set": {"finalized_result": result}},
        )
        return result
    except HTTPException:
        # Libera o lock em erro de negócio
        await db.attendance_sessions.update_one(
            {"session_id": session_id, "clinic_id": user["clinic_id"], "status": {"$ne": "concluido"}},
            {"$set": {"finalizing": False}},
        )
        raise
    except Exception as e:
        # Libera o lock em erro inesperado
        logger.exception("finalize_attendance failed: %s", e)
        await db.attendance_sessions.update_one(
            {"session_id": session_id, "clinic_id": user["clinic_id"], "status": {"$ne": "concluido"}},
            {"$set": {"finalizing": False}},
        )
        raise HTTPException(status_code=500, detail=f"Erro ao finalizar: {str(e)}")


@api_router.get("/attendance/by-appointment/{appointment_id}")
async def get_attendance_by_appointment(appointment_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    sess = await db.attendance_sessions.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not sess:
        return None
    return sess


# ============================================================
# Budgets (Orçamentos)
# ============================================================
def _compute_budget_totals(items: List[Dict[str, Any]]) -> Dict[str, float]:
    subtotal = 0.0
    discount = 0.0
    for it in items:
        qty = float(it.get("quantity") or 0)
        unit = float(it.get("unit_price") or 0)
        line_gross = qty * unit
        pct = float(it.get("discount_percent") or 0)
        val = float(it.get("discount_value") or 0)
        line_discount = (line_gross * pct / 100.0) + val
        line_discount = min(line_discount, line_gross)
        subtotal += line_gross
        discount += line_discount
    total = max(0.0, subtotal - discount)
    return {"subtotal": round(subtotal, 2), "discount": round(discount, 2), "total": round(total, 2)}


def _budget_public_token(budget_id: str, clinic_id: str) -> str:
    payload = {
        "scope": "budget",
        "bid": budget_id,
        "clinic": clinic_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=60),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@api_router.get("/budgets")
async def list_budgets(
    patient_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    forbid_recepcao_clinical(user)
    q = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    if user.get("role") == "profissional":
        q["created_by"] = user["user_id"]
    docs = await db.budgets.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.get("/budgets/{budget_id}")
async def get_budget(budget_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    doc = await db.budgets.find_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    return doc


@api_router.post("/budgets")
async def create_budget(data: BudgetIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    items = [i.model_dump() for i in data.items]
    totals = _compute_budget_totals(items)
    budget_id = f"bud_{uuid.uuid4().hex[:12]}"
    doc = {
        "budget_id": budget_id,
        "clinic_id": user["clinic_id"],
        "patient_id": data.patient_id,
        "patient_name": p["name"],
        "appointment_id": data.appointment_id,
        "items": items,
        "notes": data.notes,
        "payment_method": data.payment_method,
        "installments": data.installments,
        "valid_until": data.valid_until,
        "status": data.status,
        "patient_signature": data.patient_signature,
        "subtotal": totals["subtotal"],
        "discount": totals["discount"],
        "total": totals["total"],
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["public_token"] = _budget_public_token(budget_id, user["clinic_id"])
    await db.budgets.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/budgets/{budget_id}")
async def update_budget(budget_id: str, data: BudgetIn, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    target = await db.budgets.find_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    items = [i.model_dump() for i in data.items]
    totals = _compute_budget_totals(items)
    update = data.model_dump()
    update["items"] = items
    update.update({
        "subtotal": totals["subtotal"],
        "discount": totals["discount"],
        "total": totals["total"],
        "updated_by": user["user_id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.budgets.update_one({"budget_id": budget_id}, {"$set": update})
    doc = await db.budgets.find_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    await db.budgets.delete_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


@api_router.post("/budgets/{budget_id}/generate-charges")
async def generate_charges_from_budget(
    budget_id: str,
    payload: Optional[Dict[str, Any]] = None,
    user: dict = Depends(get_current_user),
):
    """Após um orçamento aprovado (via link público ou manualmente), a clínica revisa
    e dispara a geração das cobranças financeiras (parcelas). Idempotente por budget_id."""
    require_finance_write(user)
    doc = await db.budgets.find_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    if doc.get("status") != "aprovado":
        raise HTTPException(status_code=400, detail="Orçamento não está aprovado")
    # Idempotência: se já existem entries para este budget, retorna elas.
    existing = await db.financial_entries.find(
        {"clinic_id": user["clinic_id"], "budget_id": budget_id}, {"_id": 0}
    ).to_list(200)
    if existing:
        return {"ok": True, "financial_entries": [e["entry_id"] for e in existing], "already_generated": True}

    payload = payload or {}
    total = float(doc.get("total") or 0)
    n_installments = max(1, min(48, int(payload.get("installments") or doc.get("installments") or 1)))
    interval_days = max(1, int(payload.get("installment_interval_days") or 30))
    first_due = payload.get("first_due_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payment_method = payload.get("payment_method") or doc.get("payment_method")

    def _add_days(iso_ymd: str, days: int) -> str:
        try:
            dt = datetime.strptime(iso_ymd, "%Y-%m-%d")
        except Exception:
            dt = datetime.now(timezone.utc)
        return (dt + timedelta(days=days)).strftime("%Y-%m-%d")

    now_iso = datetime.now(timezone.utc).isoformat()
    group_id = f"grp_{uuid.uuid4().hex[:12]}"
    per = round(total / n_installments, 2) if n_installments else total
    remainder = round(total - per * n_installments, 2)
    created: List[str] = []
    description_base = f"Orçamento {budget_id[:8]} — {doc.get('patient_name') or ''}".strip(" —")
    for i in range(n_installments):
        amt = per + (remainder if i == n_installments - 1 else 0)
        due = _add_days(first_due, i * interval_days)
        ei = {
            "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
            "clinic_id": user["clinic_id"],
            "type": "receita",
            "category": "Procedimentos",
            "description": f"{description_base} (parcela {i+1}/{n_installments})" if n_installments > 1 else description_base,
            "amount": amt,
            "due_date": due,
            "paid": False,
            "patient_id": doc.get("patient_id"),
            "appointment_id": doc.get("appointment_id"),
            "budget_id": budget_id,
            "payment_method": payment_method,
            "installment_group_id": group_id,
            "installment_number": i + 1,
            "installment_total": n_installments,
            "created_at": now_iso,
            "updated_at": now_iso,
            "created_by": user["user_id"],
        }
        await db.financial_entries.insert_one(ei)
        created.append(ei["entry_id"])

    await db.budgets.update_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]},
        {"$set": {"pending_charge_generation": False, "charges_generated_at": now_iso}},
    )
    return {"ok": True, "financial_entries": created, "already_generated": False}


@api_router.get("/budgets/{budget_id}/public-link")
async def budget_public_link(budget_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    doc = await db.budgets.find_one(
        {"budget_id": budget_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    token = doc.get("public_token") or _budget_public_token(budget_id, user["clinic_id"])
    if not doc.get("public_token"):
        await db.budgets.update_one({"budget_id": budget_id}, {"$set": {"public_token": token}})
    return {"token": token}


@api_router.get("/public/budgets/{token}")
async def get_public_budget(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Token inválido")
    if payload.get("scope") != "budget":
        raise HTTPException(status_code=400, detail="Token inválido")
    doc = await db.budgets.find_one(
        {"budget_id": payload["bid"], "clinic_id": payload["clinic"]},
        {"_id": 0, "public_token": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    clinic = await db.clinics.find_one({"clinic_id": payload["clinic"]}, {"_id": 0})
    return {"budget": doc, "clinic": clinic}


@api_router.post("/public/budgets/{token}/sign")
async def sign_public_budget(token: str, payload: Dict[str, Any]):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Token inválido")
    if p.get("scope") != "budget":
        raise HTTPException(status_code=400, detail="Token inválido")
    action = payload.get("action")
    if action not in {"aprovar", "recusar"}:
        raise HTTPException(status_code=400, detail="Ação inválida")
    update = {
        "status": "aprovado" if action == "aprovar" else "recusado",
        "responded_at": datetime.now(timezone.utc).isoformat(),
    }
    if action == "aprovar":
        # Flag para a clínica revisar e gerar as cobranças (parcelas) manualmente.
        # A geração automática só acontece via /attendance/{session}/finalize.
        update["pending_charge_generation"] = True
    if action == "aprovar" and payload.get("signature"):
        update["patient_signature"] = payload["signature"]
    await db.budgets.update_one(
        {"budget_id": p["bid"], "clinic_id": p["clinic"]},
        {"$set": update},
    )
    return {"ok": True, "status": update["status"]}


# ============================================================
# AI Clinical Helpers
# ============================================================
class AISummaryIn(BaseModel):
    type: Literal["evolution", "protocol", "session_summary", "anamnesis_summary"]
    patient_id: Optional[str] = None
    context: Optional[str] = None
    notes: Optional[str] = None


@api_router.post("/ai/generate")
async def ai_generate(data: AISummaryIn, user: dict = Depends(get_current_user)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Chave LLM não configurada")
    patient_ctx = ""
    if data.patient_id:
        p = await db.patients.find_one(
            {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
        )
        if p:
            patient_ctx = f"Paciente: {p.get('name')} | Alergias: {p.get('allergies') or '—'} | Medicamentos: {p.get('medications') or '—'}"
    PROMPTS = {
        "evolution": (
            "Você é uma assistente clínica. Com base nos dados abaixo, escreva uma EVOLUÇÃO CLÍNICA "
            "concisa (até 6 linhas), em português do Brasil, técnica, sem diagnósticos, sem prescrições. "
            f"\n{patient_ctx}\nObservações do profissional: {data.notes or '—'}\nContexto: {data.context or '—'}"
        ),
        "protocol": (
            "Sugira um PROTOCOLO de até 4 sessões para o caso abaixo. Liste objetivo de cada sessão, "
            "intervalo entre sessões e cuidados pós. Português do Brasil. Não prescreva medicamentos. "
            "Lembre que a decisão final é sempre do profissional.\n"
            f"{patient_ctx}\nDemanda: {data.context or '—'}\nNotas: {data.notes or '—'}"
        ),
        "session_summary": (
            "Faça um RESUMO da sessão clínica abaixo, em até 4 linhas, em português do Brasil. "
            "Use linguagem técnica e objetiva.\n"
            f"{patient_ctx}\nDados da sessão: {data.notes or '—'}"
        ),
        "anamnesis_summary": (
            "Resuma a anamnese abaixo em até 5 linhas destacando pontos clinicamente relevantes "
            "(alergias, medicações, contraindicações, queixas principais). Português do Brasil.\n"
            f"{patient_ctx}\nAnamnese: {data.notes or '—'}"
        ),
    }
    prompt = PROMPTS[data.type]
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"gen_{user['user_id']}_{uuid.uuid4().hex[:8]}",
        system_message=(
            "Você é uma assistente clínica do ProClinic, atuando como apoio operacional. "
            "NÃO diagnostique. NÃO prescreva medicamentos. Sempre lembre que a avaliação "
            "final é do profissional. Responda em português do Brasil de forma técnica e objetiva."
        ),
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro IA: {e}")
    return {"text": reply}


# ============================================================
# Patient quick-completion (check if profile complete)
# ============================================================
@api_router.get("/patients/{patient_id}/completeness")
async def patient_completeness(patient_id: str, user: dict = Depends(get_current_user)):
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    required = ["name", "cpf", "birth_date", "phone", "lgpd_consent"]
    missing = [k for k in required if not p.get(k)]
    return {"complete": len(missing) == 0, "missing": missing, "patient": p}


@api_router.get("/patients/{patient_id}/timeline")
async def patient_timeline(patient_id: str, user: dict = Depends(get_current_user)):
    """Timeline clínica consolidada por sessão (Fase 2 - Integridade Clínica).
    Retorna cada sessão de atendimento do paciente com todos os artefatos relacionados
    (dados clínicos, ficha, evolução, assinaturas) — agrupados e ordenados
    cronologicamente (mais recentes primeiro)."""
    forbid_recepcao_clinical(user)
    # Verificar acesso ao paciente
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")

    # RBAC: profissional só vê próprias sessões
    sess_query: Dict[str, Any] = {"clinic_id": user["clinic_id"], "patient_id": patient_id}
    if user.get("role") == "profissional":
        sess_query["started_by"] = user["user_id"]

    sessions = await db.attendance_sessions.find(sess_query, {"_id": 0}).sort("started_at", -1).to_list(200)

    timeline: List[Dict[str, Any]] = []
    for sess in sessions:
        sid = sess.get("session_id")
        # medical record dessa sessão (se já finalizada)
        rec = await db.medical_records.find_one(
            {"clinic_id": user["clinic_id"], "session_id": sid}, {"_id": 0}
        )
        # appointment
        appt = None
        if sess.get("appointment_id"):
            appt = await db.appointments.find_one(
                {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
                {"_id": 0},
            )
        # financial entries vinculadas à sessão
        entries = await db.financial_entries.find(
            {"clinic_id": user["clinic_id"], "session_id": sid}, {"_id": 0}
        ).sort("due_date", 1).to_list(50)
        # budget vinculado ao appointment (se houver)
        budget = None
        if sess.get("appointment_id"):
            budget = await db.budgets.find_one(
                {"clinic_id": user["clinic_id"], "appointment_id": sess["appointment_id"]},
                {"_id": 0},
            )
        # receipts (extraídos dos entries com receipt_number)
        receipts = [
            {"receipt_number": e["receipt_number"], "receipt_url": e.get("receipt_url"),
             "entry_id": e["entry_id"], "amount": e.get("amount")}
            for e in entries if e.get("receipt_number")
        ]
        # ficha snapshot: do medical_record se existe, senão dos anamnesis_modules em vôo
        ficha = None
        if rec and rec.get("ficha_snapshot"):
            ficha = rec["ficha_snapshot"]
        else:
            # Session ainda não finalizada — usa snapshot em vôo dos módulos atuais
            fq: Dict[str, Any] = {"clinic_id": user["clinic_id"], "patient_id": patient_id}
            if user.get("role") == "profissional":
                fq["created_by"] = user["user_id"]
            mods = await db.anamnesis_modules.find(fq, {"_id": 0}).to_list(20)
            ficha = {m["module"]: {
                "answers": m.get("answers") or {},
                "photos": m.get("photos") or [],
                "captured_at": m.get("updated_at") or m.get("created_at"),
            } for m in mods if m.get("module") in {"geral", "facial", "corporal", "capilar"}}

        # signed_docs vinculados ao appointment
        signed_docs = []
        if sess.get("appointment_id"):
            signed_docs = await db.documents.find(
                {"clinic_id": user["clinic_id"], "appointment_id": sess["appointment_id"]},
                {"_id": 0, "document_id": 1, "template_name": 1, "status": 1, "pdf_url": 1, "created_at": 1},
            ).to_list(20)

        timeline.append({
            "session_id": sid,
            "session_number": sess.get("session_number") or rec and rec.get("session_number"),
            "status": sess.get("status"),
            "started_at": sess.get("started_at"),
            "finalized_at": sess.get("finalized_at"),
            "duration_seconds": sess.get("duration_seconds") or 0,
            "procedure": sess.get("procedure"),
            "procedure_id": sess.get("procedure_id"),
            "professional_id": sess.get("professional_id"),
            "professional_name": sess.get("professional_name"),
            "appointment": appt,
            "medical_record": rec,
            "ficha_snapshot": ficha,
            "budget": budget,
            "financial_entries": entries,
            "receipts": receipts,
            "signed_documents": signed_docs,
            "signatures": {
                "consent": bool(sess.get("consent_signature")),
                "evolution": bool(sess.get("evolution_signature")),
                "consent_meta": sess.get("consent_signature_meta"),
                "evolution_meta": sess.get("evolution_signature_meta"),
            },
        })

    # Legado: medical_records ORFÃOS (sem session_id) — criados manualmente antes do finalize automático
    legacy_records = await db.medical_records.find(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id,
         "$or": [{"session_id": None}, {"session_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    return {
        "patient": {"patient_id": p["patient_id"], "name": p.get("name"), "cpf": p.get("cpf")},
        "sessions": timeline,
        "legacy_records": legacy_records,
        "counts": {
            "sessions": len(timeline),
            "concluidas": sum(1 for s in timeline if s["status"] == "concluido"),
            "em_andamento": sum(1 for s in timeline if s["status"] != "concluido"),
            "legacy": len(legacy_records),
        },
    }


# ============================================================
# Message Center (WhatsApp scaffolding — provider stub now)
# ============================================================
class MessageIn(BaseModel):
    patient_id: str
    template: Optional[str] = None
    body: str = Field(..., min_length=1)
    channel: Literal["whatsapp", "sms", "email"] = "whatsapp"


@api_router.post("/messages")
async def send_message(data: MessageIn, user: dict = Depends(get_current_user)):
    """Enqueue a message. Provider integration plugged in later (Evolution API)."""
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1, "whatsapp": 1, "phone": 1, "email": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    doc = {
        "message_id": msg_id,
        "clinic_id": user["clinic_id"],
        "patient_id": data.patient_id,
        "patient_name": p["name"],
        "destination": p.get("whatsapp") or p.get("phone") or p.get("email"),
        "channel": data.channel,
        "template": data.template,
        "body": data.body,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sent_at": None,
        "error": None,
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/messages")
async def list_messages(
    patient_id: Optional[str] = None, user: dict = Depends(get_current_user)
):
    q = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


# ============================================================
# Procedures (catálogo de procedimentos da clínica)
# ============================================================
class ProcedureIn(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    price: float = 0
    duration_minutes: int = 60
    category: Optional[str] = None
    active: bool = True


@api_router.get("/procedures")
async def list_procedures(active_only: bool = False, user: dict = Depends(get_current_user)):
    q = {"clinic_id": user["clinic_id"]}
    if active_only:
        q["active"] = True
    docs = await db.procedures.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/procedures")
async def create_procedure(data: ProcedureIn, user: dict = Depends(get_current_user)):
    proc_id = f"proc_{uuid.uuid4().hex[:12]}"
    doc = data.model_dump()
    doc.update({
        "procedure_id": proc_id,
        "clinic_id": user["clinic_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.procedures.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/procedures/{procedure_id}")
async def update_procedure(procedure_id: str, data: ProcedureIn, user: dict = Depends(get_current_user)):
    res = await db.procedures.update_one(
        {"procedure_id": procedure_id, "clinic_id": user["clinic_id"]},
        {"$set": data.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Procedimento não encontrado")
    doc = await db.procedures.find_one(
        {"procedure_id": procedure_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.delete("/procedures/{procedure_id}")
async def delete_procedure(procedure_id: str, user: dict = Depends(get_current_user)):
    await db.procedures.delete_one(
        {"procedure_id": procedure_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


# ============================================================
# Clinic Settings (Minha Clínica)
# ============================================================
class ClinicSettingsIn(BaseModel):
    name: Optional[str] = None
    legal_name: Optional[str] = None
    cnpj: Optional[str] = None
    state_registration: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    zipcode: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = "Brasil"
    technical_responsible_name: Optional[str] = None
    technical_responsible_council: Optional[str] = None
    technical_responsible_number: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    tiktok: Optional[str] = None
    youtube: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


@api_router.get("/clinic")
async def get_clinic(user: dict = Depends(get_current_user)):
    doc = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc or {"clinic_id": user["clinic_id"], "name": "Minha Clínica"}


@api_router.put("/clinic")
async def update_clinic(data: ClinicSettingsIn, user: dict = Depends(get_current_user)):
    update = data.model_dump(exclude_none=False)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.clinics.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": update},
        upsert=True,
    )
    doc = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


# ============================================================
# Public appointment confirmation (no auth)
# ============================================================
def make_confirmation_token(appointment_id: str) -> str:
    payload = {
        "apt": appointment_id,
        "scope": "confirmation",
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_confirmation_token(token: str) -> str:
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if p.get("scope") != "confirmation":
            raise HTTPException(status_code=401, detail="Token inválido")
        return p["apt"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Link inválido")


@api_router.get("/appointments/{appointment_id}/confirmation-link")
async def get_confirmation_link(appointment_id: str, user: dict = Depends(get_current_user)):
    apt = await db.appointments.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not apt:
        raise HTTPException(status_code=404, detail="Não encontrado")
    token = make_confirmation_token(appointment_id)
    return {"token": token}


@api_router.get("/public/appointment/{token}")
async def public_get_appointment(token: str):
    apt_id = decode_confirmation_token(token)
    apt = await db.appointments.find_one({"appointment_id": apt_id}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    clinic = await db.clinics.find_one({"clinic_id": apt["clinic_id"]}, {"_id": 0}) or {}
    patient = await db.patients.find_one({"patient_id": apt["patient_id"]}, {"_id": 0, "name": 1}) or {}
    return {
        "appointment": {
            "patient_name": patient.get("name") or apt.get("patient_name"),
            "procedure": apt.get("procedure"),
            "professional_name": apt.get("professional_name"),
            "start": apt.get("start"),
            "end": apt.get("end"),
            "room": apt.get("room"),
            "status": apt.get("status"),
            "confirmation_status": apt.get("confirmation_status"),
        },
        "clinic": {
            "name": clinic.get("name") or "Clínica",
            "logo_url": clinic.get("logo_url"),
            "phone": clinic.get("phone"),
            "whatsapp": clinic.get("whatsapp"),
            "address": clinic.get("address"),
            "city": clinic.get("city"),
            "state": clinic.get("state"),
            "instagram": clinic.get("instagram"),
        },
    }


class PublicActionIn(BaseModel):
    action: Literal["confirm", "cancel", "reschedule"]
    reschedule_note: Optional[str] = None


@api_router.post("/public/appointment/{token}/action")
async def public_action_appointment(token: str, data: PublicActionIn):
    apt_id = decode_confirmation_token(token)
    apt = await db.appointments.find_one({"appointment_id": apt_id}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    update: Dict[str, Any] = {"confirmation_action_at": datetime.now(timezone.utc).isoformat()}
    if data.action == "confirm":
        update["confirmation_status"] = "CONFIRMADO"
        update["status"] = "confirmado"
    elif data.action == "cancel":
        update["confirmation_status"] = "CANCELADO"
        update["status"] = "cancelado"
    elif data.action == "reschedule":
        update["confirmation_status"] = "REAGENDAMENTO_SOLICITADO"
        update["reschedule_note"] = data.reschedule_note or ""
    await db.appointments.update_one({"appointment_id": apt_id}, {"$set": update})
    return {"ok": True, "confirmation_status": update["confirmation_status"]}


# ============================================================
# Mobile upload token (QR Code → mobile camera)
# ============================================================
class MobileUploadInitIn(BaseModel):
    context_type: Literal["anamnesis", "session"] = "anamnesis"
    context_id: str  # module_id, session_id, etc.
    label: Optional[str] = None  # ficha module name


def make_mobile_upload_token(clinic_id: str, user_id: str, context_type: str, context_id: str) -> str:
    payload = {
        "scope": "mobile_upload",
        "clinic_id": clinic_id,
        "user_id": user_id,
        "ctx_type": context_type,
        "ctx_id": context_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=20),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@api_router.post("/mobile-upload/init")
async def mobile_upload_init(data: MobileUploadInitIn, user: dict = Depends(get_current_user)):
    token = make_mobile_upload_token(user["clinic_id"], user["user_id"], data.context_type, data.context_id)
    return {"token": token, "expires_in_minutes": 20}


@api_router.get("/mobile-upload/verify/{token}")
async def mobile_upload_verify(token: str):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if p.get("scope") != "mobile_upload":
            raise HTTPException(status_code=401, detail="Token inválido")
        return {"ok": True, "context_type": p["ctx_type"], "context_id": p["ctx_id"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="QR Code expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


@api_router.post("/mobile-upload/upload")
async def mobile_upload_upload(
    token: str = Query(...),
    file: UploadFile = File(...),
):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if p.get("scope") != "mobile_upload":
            raise HTTPException(status_code=401, detail="Token inválido")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="QR Code expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    clinic_id = p["clinic_id"]
    user_id = p["user_id"]
    raw = await file.read()
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 12MB")
    ext = (file.filename or "jpg").rsplit(".", 1)[-1].lower()
    content_type = file.content_type or _MIME_BY_EXT.get(ext, "application/octet-stream")
    if content_type not in _ALLOWED_UPLOAD_MIMES:
        raise HTTPException(status_code=400, detail=f"Tipo não permitido: {content_type}")
    path = f"{APP_NAME}/{clinic_id}/{user_id}/{uuid.uuid4()}.{ext}"
    result = put_object(path, raw, content_type)
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    sig = make_file_signature(file_id, clinic_id)
    doc = {
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(raw)),
        "clinic_id": clinic_id,
        "uploaded_by": user_id,
        "is_deleted": False,
        "context_type": p["ctx_type"],
        "context_id": p["ctx_id"],
        "from_mobile": True,
        "signature": sig,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(doc)
    public_url = f"/api/files/{result['path']}?sig={sig}"
    # If anamnesis context, append URL to module.photos
    if p["ctx_type"] == "anamnesis":
        await db.anamnesis_modules.update_one(
            {"module_id": p["ctx_id"]},
            {"$push": {"photos": public_url}},
        )
    return {"ok": True, "url": public_url}


@api_router.get("/mobile-upload/files/{token}")
async def mobile_upload_files(token: str):
    """List uploaded files for a context (polled by desktop UI to refresh)."""
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if p.get("scope") != "mobile_upload":
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")
    docs = await db.files.find(
        {"context_type": p["ctx_type"], "context_id": p["ctx_id"], "is_deleted": False},
        {"_id": 0, "storage_path": 1, "signature": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(50)
    return [{
        "url": f"/api/files/{d['storage_path']}?sig={d.get('signature', '')}",
        "created_at": d["created_at"],
    } for d in docs]


# ============================================================
# Users management (admin-only CRUD for staff: profissionais, recepcionistas)
# ============================================================
def require_admin(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Apenas administradores")


def require_finance_read(user: dict):
    """Leitura financeira: admin, financeiro, recepcao."""
    if user.get("role") not in {"admin", "financeiro", "recepcao", "super_admin"}:
        raise HTTPException(status_code=403, detail="Acesso financeiro restrito")


def require_finance_write(user: dict):
    """Escrita/edição/exclusão financeira: admin, financeiro."""
    if user.get("role") not in {"admin", "financeiro"}:
        raise HTTPException(status_code=403, detail="Somente admin ou financeiro podem alterar o financeiro")


def forbid_recepcao_clinical(user: dict):
    """Recepcionistas não podem acessar dados clínicos (prontuário/anamnese/atendimento)."""
    if user.get("role") == "recepcao":
        raise HTTPException(status_code=403, detail="Recepção não tem acesso a dados clínicos")


class StaffUserIn(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    cpf: Optional[str] = None
    role: Literal["profissional", "recepcao", "financeiro", "marketing", "admin"]
    phone: Optional[str] = None
    birth_date: Optional[str] = None
    council: Optional[str] = None
    council_number: Optional[str] = None
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    color: Optional[str] = "#B76E79"
    picture: Optional[str] = None
    signature_url: Optional[str] = None
    active: bool = True
    initial_password: Optional[str] = None  # required on create only


@api_router.get("/users")
async def list_users(user: dict = Depends(get_current_user), role: Optional[str] = None):
    require_admin(user)
    q = {"clinic_id": user["clinic_id"]}
    if role:
        q["role"] = role
    docs = await db.users.find(q, {"_id": 0, "password_hash": 0, "session_token": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.get("/users/professionals-public")
async def list_professionals_public(user: dict = Depends(get_current_user)):
    """All users can see basic info of professionals (for dropdowns)."""
    docs = await db.users.find(
        {"clinic_id": user["clinic_id"], "role": "profissional", "active": True},
        {"_id": 0, "user_id": 1, "name": 1, "color": 1, "specialty": 1, "picture": 1},
    ).sort("name", 1).to_list(200)
    return docs


@api_router.post("/users")
async def create_user(data: StaffUserIn, user: dict = Depends(get_current_user)):
    require_admin(user)
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    cpf_digits = "".join(c for c in (data.cpf or "") if c.isdigit()) if data.cpf else None
    if cpf_digits and await db.users.find_one({"cpf_digits": cpf_digits}):
        raise HTTPException(status_code=400, detail="CPF já cadastrado")
    if not data.initial_password or len(data.initial_password) < 6:
        raise HTTPException(status_code=400, detail="Senha inicial obrigatória (mín. 6 caracteres)")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": data.name,
        "cpf": data.cpf,
        "cpf_digits": cpf_digits,
        "phone": data.phone,
        "birth_date": data.birth_date,
        "role": data.role,
        "council": data.council,
        "council_number": data.council_number,
        "specialty": data.specialty,
        "subspecialty": data.subspecialty,
        "color": data.color or "#B76E79",
        "picture": data.picture,
        "signature_url": data.signature_url,
        "active": data.active,
        "clinic_id": user["clinic_id"],
        "auth_provider": "email",
        "password_hash": hash_password(data.initial_password),
        "password_change_required": True,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    return doc


@api_router.put("/users/{user_id}")
async def update_user(user_id: str, data: StaffUserIn, user: dict = Depends(get_current_user)):
    require_admin(user)
    target = await db.users.find_one({"user_id": user_id, "clinic_id": user["clinic_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    cpf_digits = "".join(c for c in (data.cpf or "") if c.isdigit()) if data.cpf else target.get("cpf_digits")
    update = {
        "name": data.name,
        "cpf": data.cpf,
        "cpf_digits": cpf_digits,
        "phone": data.phone,
        "birth_date": data.birth_date,
        "role": data.role,
        "council": data.council,
        "council_number": data.council_number,
        "specialty": data.specialty,
        "subspecialty": data.subspecialty,
        "color": data.color or target.get("color", "#B76E79"),
        "active": data.active,
        "picture": data.picture,
        "signature_url": data.signature_url,
        "updated_by": user["user_id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if data.initial_password and len(data.initial_password) >= 6:
        update["password_hash"] = hash_password(data.initial_password)
        update["password_change_required"] = True
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    doc = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "password_hash": 0, "session_token": 0}
    )
    return doc


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Não é possível remover a si mesmo")
    # soft-delete by deactivating to preserve audit trail
    await db.users.update_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": False, "deactivated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@api_router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, payload: Dict[str, str], user: dict = Depends(get_current_user)):
    require_admin(user)
    new_pwd = payload.get("new_password") or ""
    if len(new_pwd) < 6:
        raise HTTPException(status_code=400, detail="Senha mínimo 6 caracteres")
    await db.users.update_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]},
        {"$set": {
            "password_hash": hash_password(new_pwd),
            "password_change_required": True,
        }},
    )
    return {"ok": True}


# ============================================================
# Documentos Jurídicos (Fase 2.3A)
# ============================================================
VARS_AVAILABLE = [
    "PACIENTE_NOME", "PACIENTE_CPF", "PACIENTE_RG", "PACIENTE_ENDERECO",
    "PACIENTE_TELEFONE", "PACIENTE_DATA_NASCIMENTO",
    "PROFISSIONAL_NOME", "PROFISSIONAL_CPF", "PROFISSIONAL_CONSELHO", "PROFISSIONAL_REGISTRO",
    "CLINICA_NOME", "CLINICA_CNPJ", "CLINICA_ENDERECO",
    "DATA_ATUAL", "PROCEDIMENTO", "VALOR_PROCEDIMENTO",
]


def _doc_public_token(document_id: str, clinic_id: str, scope: str = "doc") -> str:
    payload = {
        "scope": scope, "doc": document_id, "clinic": clinic_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=180),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _render_template_vars(content_md: str, ctx: Dict[str, str]) -> str:
    """Replace {{VAR}} occurrences (case-sensitive). Missing vars become empty string + flag."""
    def repl(m):
        key = m.group(1).strip()
        return str(ctx.get(key, ""))
    return re.sub(r"\{\{\s*([A-Z_]+)\s*\}\}", repl, content_md or "")


def _money_br(v: Optional[float]) -> str:
    if v is None:
        return ""
    try:
        return f"R$ {float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return ""


async def _build_doc_context(
    patient: Dict[str, Any], professional: Dict[str, Any],
    clinic: Dict[str, Any], procedure: Optional[str], value: Optional[float],
) -> Dict[str, str]:
    return {
        "PACIENTE_NOME": patient.get("name", ""),
        "PACIENTE_CPF": patient.get("cpf", ""),
        "PACIENTE_RG": patient.get("rg", ""),
        "PACIENTE_ENDERECO": patient.get("address", ""),
        "PACIENTE_TELEFONE": patient.get("phone", ""),
        "PACIENTE_DATA_NASCIMENTO": patient.get("birth_date", ""),
        "PROFISSIONAL_NOME": professional.get("name", ""),
        "PROFISSIONAL_CPF": professional.get("cpf", ""),
        "PROFISSIONAL_CONSELHO": professional.get("conselho", professional.get("council", "")),
        "PROFISSIONAL_REGISTRO": professional.get("registro", professional.get("registration", "")),
        "CLINICA_NOME": (clinic or {}).get("name", ""),
        "CLINICA_CNPJ": (clinic or {}).get("cnpj", ""),
        "CLINICA_ENDERECO": (clinic or {}).get("address", ""),
        "DATA_ATUAL": datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y"),
        "PROCEDIMENTO": procedure or "",
        "VALOR_PROCEDIMENTO": _money_br(value),
    }


async def _audit_log(action: str, *, user: Dict[str, Any], document_id: str,
                     ip: Optional[str] = None, extra: Optional[Dict[str, Any]] = None):
    await db.audit_logs.insert_one({
        "audit_id": f"aud_{uuid.uuid4().hex[:12]}",
        "action": action,
        "document_id": document_id,
        "clinic_id": user.get("clinic_id"),
        "user_id": user.get("user_id"),
        "user_name": user.get("name"),
        "user_role": user.get("role"),
        "ip": ip,
        "extra": extra or {},
        "at": datetime.now(timezone.utc).isoformat(),
    })


# ---------- Templates (admin write, all clinical roles read) ----------
@api_router.get("/document-templates/variables")
async def list_doc_variables(user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    return {"variables": VARS_AVAILABLE}


@api_router.get("/document-templates")
async def list_doc_templates(active_only: bool = False, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = {"clinic_id": user["clinic_id"]}
    if active_only:
        q["active"] = True
    docs = await db.document_templates.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/document-templates")
async def create_doc_template(data: DocumentTemplateIn, user: dict = Depends(get_current_user)):
    require_admin(user)
    template_id = f"tpl_{uuid.uuid4().hex[:12]}"
    doc = {
        "template_id": template_id,
        "clinic_id": user["clinic_id"],
        "name": data.name,
        "category": data.category,
        "content_md": data.content_md,
        "description": data.description,
        "active": data.active,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.document_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/document-templates/{template_id}")
async def update_doc_template(template_id: str, data: DocumentTemplateIn, user: dict = Depends(get_current_user)):
    require_admin(user)
    update = data.model_dump()
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_by"] = user["user_id"]
    res = await db.document_templates.update_one(
        {"template_id": template_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    doc = await db.document_templates.find_one({"template_id": template_id}, {"_id": 0})
    return doc


@api_router.delete("/document-templates/{template_id}")
async def delete_doc_template(template_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await db.document_templates.delete_one(
        {"template_id": template_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


# ---------- Documents (signed) ----------
def _doc_filter(user: dict) -> Dict[str, Any]:
    q = {"clinic_id": user["clinic_id"]}
    if user.get("role") == "profissional":
        q["created_by"] = user["user_id"]
    return q


@api_router.get("/documents")
async def list_documents(patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.documents.find(q, {"_id": 0, "content_html": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.get("/documents/{document_id}")
async def get_document(document_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    q["document_id"] = document_id
    doc = await db.documents.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    await _audit_log("viewed", user=user, document_id=document_id)
    return doc


@api_router.post("/documents")
async def create_document(data: SignedDocumentIn, request: Request, user: dict = Depends(get_current_user)):
    """Create a document from a template — auto-fills variables. Status = 'rascunho'."""
    forbid_recepcao_clinical(user)
    await require_feature("documents", user)
    template = await db.document_templates.find_one(
        {"template_id": data.template_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not template:
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    patient = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    professional = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}) or user
    ctx = await _build_doc_context(patient, professional, clinic, data.procedure, data.procedure_value)
    rendered_md = _render_template_vars(template["content_md"], ctx)
    content_html = md.markdown(rendered_md, extensions=["extra", "nl2br"])
    document_id = f"doc_{uuid.uuid4().hex[:12]}"
    doc = {
        "document_id": document_id,
        "clinic_id": user["clinic_id"],
        "template_id": template["template_id"],
        "template_name": template["name"],
        "category": template.get("category", "outro"),
        "patient_id": data.patient_id,
        "patient_name": patient.get("name"),
        "professional_id": user["user_id"],
        "professional_name": professional.get("name"),
        "appointment_id": data.appointment_id,
        "procedure": data.procedure,
        "procedure_value": data.procedure_value,
        "context": ctx,
        "content_md": rendered_md,
        "content_html": content_html,
        "status": "rascunho",   # rascunho | aguardando_paciente | finalizado
        "patient_signature": None,
        "professional_signature": None,
        "signed_patient_at": None,
        "signed_professional_at": None,
        "pdf_path": None,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["public_token"] = _doc_public_token(document_id, user["clinic_id"], scope="doc-sign")
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    await _audit_log(
        "created", user=user, document_id=document_id,
        ip=request.client.host if request.client else None,
        extra={"template_id": template["template_id"]},
    )
    return doc


class DocumentSignIn(BaseModel):
    signature: str            # base64 png
    device: Optional[str] = None  # e.g. "tablet-ipad" / "desktop" / "mobile-qr"


@api_router.put("/documents/{document_id}/sign-patient")
async def sign_patient(document_id: str, data: DocumentSignIn, request: Request, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    q["document_id"] = document_id
    doc = await db.documents.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    upd = {
        "patient_signature": data.signature,
        "signed_patient_at": datetime.now(timezone.utc).isoformat(),
        "patient_sign_device": data.device or "desktop",
        "patient_sign_ip": request.client.host if request.client else None,
        "status": "aguardando_profissional" if not doc.get("professional_signature") else doc["status"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.documents.update_one({"document_id": document_id}, {"$set": upd})
    await _audit_log("signed_patient", user=user, document_id=document_id,
                     ip=request.client.host if request.client else None)
    return {"ok": True}


@api_router.put("/documents/{document_id}/sign-professional")
async def sign_professional(document_id: str, data: DocumentSignIn, request: Request, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    q["document_id"] = document_id
    doc = await db.documents.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    upd = {
        "professional_signature": data.signature,
        "signed_professional_at": datetime.now(timezone.utc).isoformat(),
        "professional_sign_device": data.device or "desktop",
        "professional_sign_ip": request.client.host if request.client else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.documents.update_one({"document_id": document_id}, {"$set": upd})
    await _audit_log("signed_professional", user=user, document_id=document_id,
                     ip=request.client.host if request.client else None)
    return {"ok": True}


def _build_pdf_html(doc: Dict[str, Any], qr_data_url: str) -> str:
    """Compose a clean printable HTML document."""
    pat_sig = f'<img src="{doc["patient_signature"]}" />' if doc.get("patient_signature") else "<em>(não assinado)</em>"
    pro_sig = f'<img src="{doc["professional_signature"]}" />' if doc.get("professional_signature") else "<em>(não assinado)</em>"
    pat_when = doc.get("signed_patient_at") or "—"
    pro_when = doc.get("signed_professional_at") or "—"
    return f"""
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
  @page {{ size: A4; margin: 18mm 16mm 22mm 16mm; }}
  body {{ font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }}
  h1, h2, h3 {{ color: #0a0a0a; font-family: Georgia, 'Times New Roman', serif; }}
  h1 {{ font-size: 16pt; margin: 0 0 6pt; }}
  h2 {{ font-size: 13pt; margin: 12pt 0 4pt; }}
  p  {{ margin: 0 0 6pt; line-height: 1.45; text-align: justify; }}
  ul, ol {{ margin: 4pt 0 8pt 18pt; }}
  .header {{ border-bottom: 1px solid #d6c9bf; padding-bottom: 6pt; margin-bottom: 12pt; }}
  .meta {{ color: #6b6b6b; font-size: 9pt; }}
  .signatures {{ margin-top: 20pt; display: block; }}
  .sigblock {{ display: inline-block; width: 46%; vertical-align: top; padding: 6pt 0; }}
  .sigblock .label {{ font-size: 9pt; color: #6b6b6b; text-transform: uppercase; letter-spacing: 1pt; }}
  .sigblock img {{ height: 60pt; max-width: 100%; }}
  .footer-qr {{ position: absolute; bottom: 8mm; right: 14mm; text-align: right; font-size: 8pt; color: #999; }}
  .footer-qr img {{ width: 60pt; height: 60pt; }}
</style></head><body>
<div class="header">
  <h1>{doc.get('template_name','Documento')}</h1>
  <p class="meta">{doc.get('context',{}).get('CLINICA_NOME','')} · CNPJ {doc.get('context',{}).get('CLINICA_CNPJ','—')} · {doc.get('context',{}).get('CLINICA_ENDERECO','')}</p>
  <p class="meta">Paciente: <strong>{doc.get('patient_name')}</strong> · Profissional: <strong>{doc.get('professional_name')}</strong> · Data: {doc.get('context',{}).get('DATA_ATUAL','')}</p>
</div>
<div>{doc.get('content_html','')}</div>
<div class="signatures">
  <div class="sigblock">
    <div class="label">Assinatura do Paciente</div>
    {pat_sig}
    <div class="meta">{pat_when}</div>
  </div>
  <div class="sigblock" style="margin-left:4%;">
    <div class="label">Assinatura do Profissional</div>
    {pro_sig}
    <div class="meta">{pro_when}</div>
  </div>
</div>
<div class="footer-qr">
  <img src="{qr_data_url}" />
  <div>Documento {doc.get('document_id')}<br/>Verifique em /documento/{doc.get('document_id')}/validar</div>
</div>
</body></html>
"""


def _generate_qr_data_url(text: str) -> str:
    img = qrcode.make(text)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    import base64
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@api_router.post("/documents/{document_id}/finalize")
async def finalize_document(document_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Generate the final PDF and persist it. Both signatures must be present."""
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    q["document_id"] = document_id
    doc = await db.documents.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    if not doc.get("patient_signature") or not doc.get("professional_signature"):
        raise HTTPException(status_code=400, detail="Ambas assinaturas são obrigatórias antes de finalizar")
    # build QR URL pointing to validation public page
    validation_url = f"/documento/{document_id}/validar?t={doc.get('public_token','')}"
    qr_url = _generate_qr_data_url(validation_url)
    html_str = _build_pdf_html(doc, qr_url)
    # generate PDF in memory
    pdf_buf = io.BytesIO()
    result = pisa.CreatePDF(src=html_str, dest=pdf_buf, encoding="utf-8")
    if result.err:
        raise HTTPException(status_code=500, detail="Erro ao gerar PDF")
    pdf_bytes = pdf_buf.getvalue()
    # persist via Emergent object storage (same as /uploads)
    rel_path = f"{APP_NAME}/{user['clinic_id']}/{user['user_id']}/doc-{document_id}.pdf"
    result = put_object(rel_path, pdf_bytes, "application/pdf")
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    sig = make_file_signature(file_id, user["clinic_id"])
    await db.files.insert_one({
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": f"{doc.get('template_name','documento')}.pdf",
        "content_type": "application/pdf",
        "size": result.get("size", len(pdf_bytes)),
        "clinic_id": user["clinic_id"],
        "uploaded_by": user["user_id"],
        "uploaded_by_name": user.get("name"),
        "is_deleted": False,
        "signature": sig,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    file_url = f"/api/files/{result['path']}?sig={sig}"
    await db.documents.update_one(
        {"document_id": document_id},
        {"$set": {
            "status": "finalizado",
            "pdf_path": result["path"],
            "pdf_url": file_url,
            "pdf_file_id": file_id,
            "finalized_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await _audit_log("finalized", user=user, document_id=document_id,
                     ip=request.client.host if request.client else None)
    updated = await db.documents.find_one({"document_id": document_id}, {"_id": 0})
    return updated


# ---------- Public endpoints (mobile signing + validation) ----------
@api_router.get("/public/documents/{token}")
async def get_public_doc(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Token inválido")
    if payload.get("scope") not in {"doc-sign", "doc"}:
        raise HTTPException(status_code=400, detail="Token inválido")
    doc = await db.documents.find_one(
        {"document_id": payload["doc"], "clinic_id": payload["clinic"]},
        {"_id": 0, "patient_signature": 0, "professional_signature": 0, "public_token": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    clinic = await db.clinics.find_one({"clinic_id": payload["clinic"]}, {"_id": 0})
    return {
        "document": doc,
        "clinic": clinic,
        "has_patient_signature": bool(doc.get("signed_patient_at")),
        "has_professional_signature": bool(doc.get("signed_professional_at")),
    }


@api_router.post("/public/documents/{token}/sign-patient")
async def public_sign_patient(token: str, payload: Dict[str, Any], request: Request):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Token inválido")
    if p.get("scope") != "doc-sign":
        raise HTTPException(status_code=400, detail="Token inválido")
    if not payload.get("signature"):
        raise HTTPException(status_code=400, detail="Assinatura requerida")
    upd = {
        "patient_signature": payload["signature"],
        "signed_patient_at": datetime.now(timezone.utc).isoformat(),
        "patient_sign_device": payload.get("device") or "mobile-qr",
        "patient_sign_ip": request.client.host if request.client else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.documents.update_one({"document_id": p["doc"], "clinic_id": p["clinic"]}, {"$set": upd})
    await db.audit_logs.insert_one({
        "audit_id": f"aud_{uuid.uuid4().hex[:12]}",
        "action": "signed_patient_public",
        "document_id": p["doc"], "clinic_id": p["clinic"],
        "user_id": None, "user_role": "patient",
        "ip": request.client.host if request.client else None,
        "extra": {"device": payload.get("device") or "mobile-qr"},
        "at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api_router.get("/public/documents/{token}/validate")
async def public_validate(token: str):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Token inválido")
    doc = await db.documents.find_one(
        {"document_id": p["doc"], "clinic_id": p["clinic"]},
        {"_id": 0, "patient_signature": 0, "professional_signature": 0,
         "content_html": 0, "content_md": 0, "public_token": 0, "context": 0},
    )
    if not doc:
        return {"valid": False, "reason": "not_found"}
    clinic = await db.clinics.find_one({"clinic_id": p["clinic"]}, {"_id": 0, "name": 1})
    return {
        "valid": True,
        "document_id": doc.get("document_id"),
        "template_name": doc.get("template_name"),
        "patient_name": doc.get("patient_name"),
        "professional_name": doc.get("professional_name"),
        "status": doc.get("status"),
        "finalized_at": doc.get("finalized_at"),
        "signed_patient_at": doc.get("signed_patient_at"),
        "signed_professional_at": doc.get("signed_professional_at"),
        "clinic_name": (clinic or {}).get("name"),
    }


# ---------- Audit ----------
@api_router.get("/documents/{document_id}/audit")
async def doc_audit(document_id: str, user: dict = Depends(get_current_user)):
    forbid_recepcao_clinical(user)
    q = _doc_filter(user)
    q["document_id"] = document_id
    doc = await db.documents.find_one(q, {"_id": 0, "document_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    logs = await db.audit_logs.find(
        {"document_id": document_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    ).sort("at", -1).to_list(500)
    return logs


# ============================================================
# Subscriptions (Asaas) — Fase 2.4A
# ============================================================
ASAAS_BASE_URL = os.environ.get("ASAAS_BASE_URL", "https://api-sandbox.asaas.com/v3")
ASAAS_API_KEY = os.environ.get("ASAAS_API_KEY", "")
ASAAS_WEBHOOK_TOKEN = os.environ.get("ASAAS_WEBHOOK_TOKEN", "")

# Plan catalog (persisted on startup)
PLAN_CATALOG = [
    {"plan_key": "starter",      "name": "Starter",      "price": 59.90,  "annual_price": 574.80,  "description": "Ideal para começar",
     "features": {"max_professionals": 1,    "max_patients": 200,  "ai": False, "whatsapp": False, "documents": False, "advanced_reports": False, "audit_logs": False}},
    {"plan_key": "professional", "name": "Professional", "price": 99.90,  "annual_price": 958.80,  "description": "Para clínicas em crescimento",
     "features": {"max_professionals": 5,    "max_patients": None, "ai": True,  "whatsapp": False, "documents": True,  "advanced_reports": False, "audit_logs": False}},
    {"plan_key": "premium",      "name": "Premium",      "price": 149.90, "annual_price": 1438.80, "description": "Recursos completos + WhatsApp",
     "features": {"max_professionals": None, "max_patients": None, "ai": True,  "whatsapp": True,  "documents": True,  "advanced_reports": True,  "audit_logs": True}},
]

PLAN_FEATURES = {p["plan_key"]: p["features"] for p in PLAN_CATALOG}
PLAN_PRICE_MAP = {p["plan_key"]: {"monthly": p["price"], "yearly": p["annual_price"]} for p in PLAN_CATALOG}


async def seed_plans():
    for p in PLAN_CATALOG:
        await db.plans.update_one(
            {"plan_key": p["plan_key"]},
            {"$set": {**p, "active": True, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )


async def ensure_trial_subscription(clinic_id: str, user_id: str):
    """Ensure the clinic has at least a trial subscription (7d)."""
    existing = await db.subscriptions.find_one({"clinic_id": clinic_id})
    if existing:
        return existing
    now = datetime.now(timezone.utc)
    doc = {
        "subscription_id": f"sub_{uuid.uuid4().hex[:12]}",
        "clinic_id": clinic_id,
        "plan_key": "professional",   # trial concede acesso do Professional
        "billing_cycle": "monthly",
        "status": "trial",
        "started_at": now.isoformat(),
        "trial_ends_at": (now + timedelta(days=7)).isoformat(),
        "read_only_until": (now + timedelta(days=10)).isoformat(),
        "gateway_subscription_id": None,
        "gateway_customer_id": None,
        "value": 0.0,
        "cancelled_at": None,
        "created_by": user_id,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.subscriptions.insert_one(doc)
    doc.pop("_id", None)
    # fire welcome email (background — don't block)
    try:
        asyncio.create_task(send_email_trial_welcome(clinic_id))
    except Exception as e:
        logger.warning("welcome email schedule failed: %s", e)
    return doc


def _asaas_headers():
    return {
        "access_token": ASAAS_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "ProClinic/1.0 (FastAPI)",
    }


async def asaas_request(method: str, path: str, json: Optional[dict] = None, params: Optional[dict] = None):
    if not ASAAS_API_KEY:
        raise HTTPException(status_code=500, detail="ASAAS_API_KEY não configurada")
    url = f"{ASAAS_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(method, url, headers=_asaas_headers(), json=json, params=params)
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        logger.warning("Asaas %s %s → %s %s", method, path, resp.status_code, detail)
        raise HTTPException(status_code=502, detail={"gateway_status": resp.status_code, "gateway_error": detail})
    return resp.json()


# ---------- helpers ----------
def _sub_status_effective(sub: Dict[str, Any]) -> str:
    """Compute effective status based on trial/read_only deadlines."""
    status = sub.get("status")
    now = datetime.now(timezone.utc)
    if status == "trial":
        try:
            trial_end = datetime.fromisoformat(sub["trial_ends_at"].replace("Z", "+00:00"))
            if now > trial_end:
                # inside grace read-only window?
                ro_until = datetime.fromisoformat(sub.get("read_only_until", "").replace("Z", "+00:00")) if sub.get("read_only_until") else None
                if ro_until and now < ro_until:
                    return "read_only"
                return "expired"
        except Exception:
            return status
    return status


async def get_clinic_subscription(clinic_id: str) -> Dict[str, Any]:
    sub = await db.subscriptions.find_one({"clinic_id": clinic_id}, {"_id": 0})
    return sub or {}


def _plan_allows(plan_key: Optional[str], feature: str) -> bool:
    return bool(PLAN_FEATURES.get(plan_key or "starter", {}).get(feature))


async def require_feature(feature: str, user: dict):
    sub = await get_clinic_subscription(user["clinic_id"])
    if not sub:
        raise HTTPException(status_code=402, detail="Assinatura necessária")
    effective = _sub_status_effective(sub)
    if effective in {"expired", "cancelled"}:
        raise HTTPException(status_code=402, detail={"code": "subscription_required", "message": "Assinatura expirada — reative para acessar este recurso"})
    if not _plan_allows(sub.get("plan_key"), feature):
        raise HTTPException(status_code=403, detail={"code": "plan_upgrade_required", "message": f"Recurso '{feature}' não incluso no seu plano"})


# ---------- Public endpoints ----------
@api_router.get("/plans")
async def list_plans():
    docs = await db.plans.find({"active": True}, {"_id": 0}).to_list(20)
    return docs


@api_router.get("/subscriptions/me")
async def my_subscription(user: dict = Depends(get_current_user)):
    sub = await get_clinic_subscription(user["clinic_id"])
    if not sub:
        return None
    plan = await db.plans.find_one({"plan_key": sub.get("plan_key")}, {"_id": 0})
    days_left = None
    if sub.get("status") == "trial" and sub.get("trial_ends_at"):
        try:
            d = datetime.fromisoformat(sub["trial_ends_at"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
            days_left = max(0, d.days + (1 if d.seconds > 0 else 0))
        except Exception:
            pass
    return {
        **sub,
        "plan": plan,
        "effective_status": _sub_status_effective(sub),
        "trial_days_left": days_left,
        "features": PLAN_FEATURES.get(sub.get("plan_key") or "starter", {}),
    }


class CheckoutIn(BaseModel):
    plan_key: Literal["starter", "professional", "premium"]
    billing_cycle: Literal["monthly", "yearly"] = "monthly"
    billing_type: Literal["PIX", "BOLETO", "CREDIT_CARD"] = "PIX"
    coupon_code: Optional[str] = None
    # customer info (used only if we don't have an Asaas customer yet)
    cpf_cnpj: Optional[str] = None
    holder_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    # credit card (when billing_type == CREDIT_CARD)
    card_number: Optional[str] = None
    card_holder: Optional[str] = None
    card_expiry_month: Optional[str] = None
    card_expiry_year: Optional[str] = None
    card_ccv: Optional[str] = None


@api_router.post("/subscriptions/checkout")
async def checkout(payload: CheckoutIn, request: Request, user: dict = Depends(get_current_user)):
    """Create/upsert an Asaas customer + subscription and persist locally."""
    require_admin(user)
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    sub = await get_clinic_subscription(user["clinic_id"])
    # 1) ensure customer
    customer_id = (sub or {}).get("gateway_customer_id")
    if not customer_id:
        cpf = (payload.cpf_cnpj or clinic.get("cnpj") or "").replace(".", "").replace("/", "").replace("-", "")
        if not cpf:
            raise HTTPException(status_code=400, detail="CPF/CNPJ é obrigatório")
        cust_body = {
            "name": payload.holder_name or clinic.get("name") or user.get("name"),
            "cpfCnpj": cpf,
            "email": payload.email or user.get("email"),
            "mobilePhone": (payload.phone or clinic.get("phone") or "").replace("(", "").replace(")", "").replace("-", "").replace(" ", ""),
            "externalReference": user["clinic_id"],
        }
        cust = await asaas_request("POST", "/customers", json=cust_body)
        customer_id = cust["id"]
    # 2) price with coupon (first-payment discount applied via one-shot discount)
    price = PLAN_PRICE_MAP[payload.plan_key][payload.billing_cycle]
    coupon = None
    discounted_price = price
    if payload.coupon_code:
        coupon = await db.coupons.find_one({"code": payload.coupon_code.strip().upper(), "active": True}, {"_id": 0})
        if coupon:
            discounted_price = _apply_coupon(price, coupon)
    cycle = "YEARLY" if payload.billing_cycle == "yearly" else "MONTHLY"
    # 3) subscription
    next_due = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    body = {
        "customer": customer_id,
        "billingType": payload.billing_type,
        "value": price,
        "nextDueDate": next_due,
        "cycle": cycle,
        "description": f"ProClinic {payload.plan_key.capitalize()} ({payload.billing_cycle})",
        "externalReference": user["clinic_id"],
    }
    # First-payment coupon: apply a "discount" on the first payment via Asaas subscription discount block
    if coupon and coupon.get("first_payment_only") and discounted_price < price:
        body["discount"] = {"value": round(price - discounted_price, 2), "dueDateLimitDays": 30, "type": "FIXED"}
    elif coupon and not coupon.get("first_payment_only"):
        # Persistent discount: send a lower recurring value
        body["value"] = discounted_price
    if payload.billing_type == "CREDIT_CARD":
        if not (payload.card_number and payload.card_holder and payload.card_expiry_month and payload.card_expiry_year and payload.card_ccv):
            raise HTTPException(status_code=400, detail="Dados do cartão incompletos")
        body["creditCard"] = {
            "holderName": payload.card_holder,
            "number": payload.card_number.replace(" ", ""),
            "expiryMonth": payload.card_expiry_month,
            "expiryYear": payload.card_expiry_year,
            "ccv": payload.card_ccv,
        }
        body["creditCardHolderInfo"] = {
            "name": payload.card_holder,
            "email": payload.email or user.get("email"),
            "cpfCnpj": (payload.cpf_cnpj or "").replace(".", "").replace("-", ""),
            "postalCode": clinic.get("postal_code", "00000000"),
            "addressNumber": clinic.get("address_number", "1"),
            "phone": (payload.phone or "1100000000").replace(" ", ""),
        }
        body["remoteIp"] = request.client.host if request.client else "127.0.0.1"

    result = await asaas_request("POST", "/subscriptions", json=body)
    # 4) persist locally
    now = datetime.now(timezone.utc)
    upd = {
        "clinic_id": user["clinic_id"],
        "plan_key": payload.plan_key,
        "billing_cycle": payload.billing_cycle,
        "billing_type": payload.billing_type,
        "value": price,
        "status": "pending",
        "gateway_subscription_id": result.get("id"),
        "gateway_customer_id": customer_id,
        "next_billing_date": result.get("nextDueDate"),
        "updated_at": now.isoformat(),
    }
    if sub:
        await db.subscriptions.update_one({"clinic_id": user["clinic_id"]}, {"$set": upd})
    else:
        upd["subscription_id"] = f"sub_{uuid.uuid4().hex[:12]}"
        upd["started_at"] = now.isoformat()
        upd["created_at"] = now.isoformat()
        await db.subscriptions.insert_one(upd)
    # increment coupon uses count
    if coupon:
        await db.coupons.update_one({"coupon_id": coupon["coupon_id"]}, {"$inc": {"uses_count": 1}})
    return {"ok": True, "gateway_subscription_id": result.get("id"), "status": "pending",
            "final_price": upd["value"], "coupon_applied": coupon["code"] if coupon else None}


@api_router.post("/subscriptions/cancel")
async def cancel_subscription(user: dict = Depends(get_current_user)):
    require_admin(user)
    sub = await get_clinic_subscription(user["clinic_id"])
    if not sub or not sub.get("gateway_subscription_id"):
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    await asaas_request("DELETE", f"/subscriptions/{sub['gateway_subscription_id']}")
    await db.subscriptions.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@api_router.post("/subscriptions/change-plan")
async def change_plan(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    require_admin(user)
    new_plan = payload.get("plan_key")
    cycle = payload.get("billing_cycle", "monthly")
    if new_plan not in PLAN_FEATURES:
        raise HTTPException(status_code=400, detail="Plano inválido")
    sub = await get_clinic_subscription(user["clinic_id"])
    if not sub or not sub.get("gateway_subscription_id"):
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    new_value = PLAN_PRICE_MAP[new_plan][cycle]
    await asaas_request(
        "PUT",
        f"/subscriptions/{sub['gateway_subscription_id']}",
        json={"value": new_value, "cycle": "YEARLY" if cycle == "yearly" else "MONTHLY", "updatePendingPayments": True},
    )
    await db.subscriptions.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {"plan_key": new_plan, "billing_cycle": cycle, "value": new_value,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True, "plan_key": new_plan, "value": new_value}


@api_router.get("/subscriptions/payments")
async def list_subscription_payments(user: dict = Depends(get_current_user)):
    sub = await get_clinic_subscription(user["clinic_id"])
    if not sub:
        return []
    docs = await db.payments.find({"clinic_id": user["clinic_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


# ---------- Webhook ----------
@api_router.post("/webhooks/asaas")
async def asaas_webhook(request: Request, asaas_access_token: str = Header(default="", alias="asaas-access-token")):
    if not ASAAS_WEBHOOK_TOKEN or asaas_access_token != ASAAS_WEBHOOK_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid webhook token")
    body = await request.json()
    event_id = body.get("id")
    if not event_id:
        raise HTTPException(status_code=400, detail="Webhook payload missing 'id'")
    # idempotency
    if await db.webhook_events.find_one({"event_id": event_id}):
        return {"ok": True, "duplicate": True}
    await db.webhook_events.insert_one({
        "event_id": event_id,
        "event": body.get("event"),
        "payload": body,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })
    event = body.get("event", "")
    payment = body.get("payment") or {}
    subscription_ref = payment.get("subscription")
    external_ref = payment.get("externalReference")
    clinic_id = external_ref

    if not clinic_id and subscription_ref:
        s = await db.subscriptions.find_one({"gateway_subscription_id": subscription_ref})
        clinic_id = s and s.get("clinic_id")

    now = datetime.now(timezone.utc).isoformat()

    if event in {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"} and clinic_id:
        await db.subscriptions.update_one(
            {"clinic_id": clinic_id},
            {"$set": {"status": "active", "activated_at": now, "updated_at": now,
                      "last_payment_at": now, "next_billing_date": payment.get("nextDueDate")}},
        )
        # Generate invoice PDF and persist
        clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0}) or {}
        sub_doc = await db.subscriptions.find_one({"clinic_id": clinic_id}, {"_id": 0}) or {}
        payment_id_local = f"pay_{uuid.uuid4().hex[:12]}"
        invoice_url = None
        try:
            pdf_bytes = _build_invoice_pdf({**payment, "payment_id": payment_id_local}, clinic, sub_doc)
            inv = await _persist_invoice_pdf(clinic_id, payment_id_local, pdf_bytes)
            invoice_url = inv["url"]
        except Exception as e:
            logger.warning("Invoice PDF gen failed: %s", e)
            pdf_bytes = None
        await db.payments.insert_one({
            "payment_id": payment_id_local,
            "clinic_id": clinic_id,
            "gateway_payment_id": payment.get("id"),
            "gateway_subscription_id": subscription_ref,
            "amount": payment.get("value"),
            "payment_method": payment.get("billingType"),
            "status": "paid",
            "paid_at": payment.get("paymentDate") or now,
            "invoice_url": invoice_url,
            "created_at": now,
        })
        # Send confirmation email
        try:
            await send_email_payment_confirmed(clinic_id, payment, pdf_bytes)
        except Exception as e:
            logger.warning("send_email_payment_confirmed failed: %s", e)
    elif event == "PAYMENT_OVERDUE" and clinic_id:
        await db.subscriptions.update_one(
            {"clinic_id": clinic_id},
            {"$set": {"status": "past_due", "updated_at": now}},
        )
        try:
            await send_email_payment_overdue(clinic_id)
        except Exception as e:
            logger.warning("send_email_payment_overdue failed: %s", e)
    elif event == "PAYMENT_DELETED" and clinic_id:
        # do nothing more than logging
        pass
    elif event in {"SUBSCRIPTION_UPDATED", "SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"} and clinic_id:
        if event in {"SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"}:
            await db.subscriptions.update_one(
                {"clinic_id": clinic_id},
                {"$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now}},
            )
    return {"ok": True}


# ---------- Admin financial dashboard (super-admin/tenant-wide) ----------
@api_router.get("/admin/finance/summary")
async def admin_finance_summary(user: dict = Depends(get_current_user)):
    """MRR/ARR, active count etc. — Fase 2.4A básico.
    Scoped to caller's clinic — super-admin cross-tenant view fica para 2.4B."""
    require_admin(user)
    subs = await db.subscriptions.find({"clinic_id": user["clinic_id"]}, {"_id": 0}).to_list(2000)
    active = [s for s in subs if s.get("status") == "active"]
    trial = [s for s in subs if s.get("status") == "trial"]
    past_due = [s for s in subs if s.get("status") == "past_due"]
    cancelled = [s for s in subs if s.get("status") == "cancelled"]
    mrr = sum(float(s.get("value") or 0) if s.get("billing_cycle") == "monthly" else float(s.get("value") or 0) / 12 for s in active)
    arr = mrr * 12
    return {
        "active": len(active),
        "trial": len(trial),
        "past_due": len(past_due),
        "cancelled": len(cancelled),
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "conversion_rate": round(len(active) / max(1, len(active) + len(trial)) * 100, 1),
    }


# ============================================================
# Coupons + Super-admin + Emails + Invoices — Fase 2.4B
# ============================================================
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def require_super_admin(user: dict):
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Apenas super-admin")


# ---------- Coupons ----------
class CouponIn(BaseModel):
    code: str
    kind: Literal["percent", "fixed"] = "percent"
    value: float = Field(ge=0)                              # percent (0-100) OU R$
    applies_to: List[Literal["starter", "professional", "premium"]] = []
    first_payment_only: bool = True
    max_uses: Optional[int] = None                          # None = ilimitado
    valid_until: Optional[str] = None                       # ISO date
    active: bool = True

    @field_validator("value")
    @classmethod
    def _validate_percent_range(cls, v, info):
        if info.data.get("kind") == "percent" and v > 100:
            raise ValueError("Percentual não pode ser maior que 100")
        return v


@api_router.get("/coupons")
async def list_coupons(user: dict = Depends(get_current_user)):
    require_super_admin(user)
    docs = await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/coupons")
async def create_coupon(data: CouponIn, user: dict = Depends(get_current_user)):
    require_super_admin(user)
    code = data.code.strip().upper()
    if await db.coupons.find_one({"code": code}):
        raise HTTPException(status_code=400, detail="Cupom já existe")
    doc = {
        **data.model_dump(),
        "coupon_id": f"cpn_{uuid.uuid4().hex[:10]}",
        "code": code,
        "uses_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["user_id"],
    }
    await db.coupons.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/coupons/{coupon_id}")
async def update_coupon(coupon_id: str, data: CouponIn, user: dict = Depends(get_current_user)):
    require_super_admin(user)
    upd = data.model_dump()
    upd["code"] = upd["code"].strip().upper()
    res = await db.coupons.update_one({"coupon_id": coupon_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cupom não encontrado")
    doc = await db.coupons.find_one({"coupon_id": coupon_id}, {"_id": 0})
    return doc


@api_router.delete("/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str, user: dict = Depends(get_current_user)):
    require_super_admin(user)
    await db.coupons.delete_one({"coupon_id": coupon_id})
    return {"ok": True}


@api_router.get("/coupons/validate/{code}")
async def validate_coupon(code: str, plan_key: str, user: dict = Depends(get_current_user)):
    """Checked by client at checkout page. Returns discounted price."""
    doc = await db.coupons.find_one({"code": code.strip().upper(), "active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Cupom inválido")
    if doc.get("valid_until"):
        try:
            if datetime.fromisoformat(doc["valid_until"].replace("Z", "+00:00")) < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Cupom expirado")
        except ValueError:
            pass
    if doc.get("max_uses") is not None and doc.get("uses_count", 0) >= doc["max_uses"]:
        raise HTTPException(status_code=410, detail="Cupom esgotado")
    if doc.get("applies_to") and plan_key not in doc["applies_to"]:
        raise HTTPException(status_code=400, detail=f"Cupom não aplicável ao plano {plan_key}")
    return {
        "code": doc["code"], "kind": doc["kind"], "value": doc["value"],
        "first_payment_only": doc.get("first_payment_only", True),
    }


def _apply_coupon(price: float, coupon: Optional[Dict[str, Any]]) -> float:
    if not coupon:
        return price
    if coupon["kind"] == "percent":
        return max(0.0, round(price * (1 - float(coupon["value"]) / 100), 2))
    return max(0.0, round(price - float(coupon["value"]), 2))


# ---------- Super-admin dashboard ----------
@api_router.get("/super-admin/summary")
async def super_admin_summary(user: dict = Depends(get_current_user)):
    require_super_admin(user)
    subs = await db.subscriptions.find({}, {"_id": 0}).to_list(5000)
    active = [s for s in subs if s.get("status") == "active"]
    trial = [s for s in subs if s.get("status") == "trial"]
    past_due = [s for s in subs if s.get("status") == "past_due"]
    cancelled = [s for s in subs if s.get("status") == "cancelled"]
    expired = [s for s in subs if _sub_status_effective(s) == "expired"]
    mrr = sum(
        (float(s.get("value") or 0) if s.get("billing_cycle") == "monthly"
         else float(s.get("value") or 0) / 12)
        for s in active
    )
    total_clinics = await db.clinics.count_documents({})
    total_payments = await db.payments.count_documents({"status": "paid"})
    revenue_total = 0.0
    async for p in db.payments.find({"status": "paid"}, {"_id": 0, "amount": 1}):
        revenue_total += float(p.get("amount") or 0)
    churn = round(len(cancelled) / max(1, len(cancelled) + len(active)) * 100, 1)
    return {
        "clinics": total_clinics,
        "active": len(active),
        "trial": len(trial),
        "past_due": len(past_due),
        "cancelled": len(cancelled),
        "expired": len(expired),
        "mrr": round(mrr, 2),
        "arr": round(mrr * 12, 2),
        "total_revenue": round(revenue_total, 2),
        "total_payments": total_payments,
        "conversion_rate": round(len(active) / max(1, len(active) + len(trial)) * 100, 1),
        "churn_rate": churn,
    }


@api_router.get("/super-admin/clinics")
async def super_admin_clinics(user: dict = Depends(get_current_user)):
    require_super_admin(user)
    clinics = await db.clinics.find({}, {"_id": 0}).to_list(2000)
    out = []
    for c in clinics:
        sub = await db.subscriptions.find_one({"clinic_id": c["clinic_id"]}, {"_id": 0}) or {}
        user_count = await db.users.count_documents({"clinic_id": c["clinic_id"], "active": {"$ne": False}})
        pat_count = await db.patients.count_documents({"clinic_id": c["clinic_id"]})
        out.append({
            **c,
            "subscription": {
                "plan_key": sub.get("plan_key"),
                "status": sub.get("status"),
                "effective_status": _sub_status_effective(sub) if sub else None,
                "value": sub.get("value"),
                "trial_ends_at": sub.get("trial_ends_at"),
                "next_billing_date": sub.get("next_billing_date"),
            },
            "user_count": user_count,
            "patient_count": pat_count,
        })
    return out


# ---------- Emails via Resend ----------
def _email_shell(title: str, body_html: str,
                 cta_text: Optional[str] = None, cta_url: Optional[str] = None,
                 clinic: Optional[Dict[str, Any]] = None,
                 email_log_id: Optional[str] = None,
                 backend_public_url: Optional[str] = None) -> str:
    """Premium branded email — respects clinic logo, primary color, and dark mode.
    Adds a 1x1 open-tracking pixel and click-tracking wrapper on the CTA."""
    clinic = clinic or {}
    primary = clinic.get("primary_color") or "#B76E79"
    logo_url = clinic.get("logo_url")
    brand_name = clinic.get("name") or "ProClinic"
    backend = backend_public_url or os.environ.get("FRONTEND_URL", "") + "/api"
    # click-tracking wrapper
    tracked_cta_url = cta_url
    if cta_url and email_log_id:
        import urllib.parse
        tracked_cta_url = f"{backend}/email-tracking/click/{email_log_id}?u={urllib.parse.quote(cta_url, safe='')}"
    # tracking pixel
    pixel = ""
    if email_log_id:
        pixel = f'<img src="{backend}/email-tracking/open/{email_log_id}.png" alt="" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0;" />'
    button = ""
    if cta_text and tracked_cta_url:
        button = f"""<tr><td align="center" style="padding:20px 0 8px;">
        <a href="{tracked_cta_url}" style="display:inline-block;padding:14px 28px;background:{primary};color:#ffffff;text-decoration:none;border-radius:12px;font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:.6px;font-weight:600;">{cta_text}</a>
        </td></tr>"""
    header_logo = f'<img src="{logo_url}" alt="{brand_name}" style="height:36px;max-width:180px;display:block;" />' if logo_url else \
        f'<div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:{primary};">{brand_name}</div>'
    return f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      @media (prefers-color-scheme: dark) {{
        .email-bg {{ background:#0e0c0d !important; }}
        .email-card {{ background:#181516 !important; box-shadow:0 4px 24px rgba(0,0,0,.5) !important; }}
        .email-title {{ color:#f5efeb !important; }}
        .email-body {{ color:#d4c9c1 !important; }}
        .email-meta {{ color:#a8998f !important; border-color:#2b2426 !important; }}
        .email-eyebrow {{ color:#e8a4ad !important; }}
      }}
    </style></head><body class="email-bg" style="margin:0;background:#faf7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2426;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:transparent;">
      <tr><td align="center">
        <table class="email-card" role="presentation" width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 6px 32px rgba(120,60,50,.08);">
          <tr><td style="padding:28px 32px 8px;">
            {header_logo}
            <div class="email-eyebrow" style="font-family:Georgia,serif;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:{primary};margin-top:14px;">ProClinic</div>
            <h1 class="email-title" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;margin:6px 0 8px;color:#1a1a1a;font-weight:600;">{title}</h1>
          </td></tr>
          <tr><td class="email-body" style="padding:8px 32px 24px;font-size:15px;line-height:1.65;color:#3a3336;">{body_html}</td></tr>
          {button}
          <tr><td class="email-meta" style="padding:28px 32px 24px;border-top:1px solid #f0e6df;font-size:11px;color:#98908b;text-align:center;line-height:1.5;">
            Você recebeu este email porque é administrador de <strong>{brand_name}</strong> no ProClinic.<br/>
            Se não deseja mais receber, responda com "SAIR".
          </td></tr>
        </table>
        {pixel}
      </td></tr>
    </table></body></html>"""


async def send_email(to: str, subject: str, html_builder, idempotency_key: str, attachment: Optional[Dict[str, Any]] = None, clinic_id: Optional[str] = None) -> Optional[str]:
    """Send with idempotency, branding and tracking. html_builder is a callable(email_log_id, clinic) -> str
    so we can inject the pre-allocated email_log_id into the HTML for open/click tracking."""
    if not RESEND_API_KEY:
        logger.warning("Skipping email: RESEND_API_KEY not set")
        return None
    existing = await db.email_logs.find_one({"idempotency_key": idempotency_key, "status": "sent"})
    if existing:
        return None
    # allocate log id first so tracking pixel URL is known before send
    email_log_id = f"em_{uuid.uuid4().hex[:12]}"
    clinic = None
    if clinic_id:
        clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    try:
        html = html_builder(email_log_id, clinic) if callable(html_builder) else html_builder
    except Exception as e:
        logger.error("html_builder failed: %s", e)
        return None
    params = {"from": SENDER_EMAIL, "to": [to], "subject": subject, "html": html}
    if attachment:
        params["attachments"] = [attachment]
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        resend_id = (result or {}).get("id")
        await db.email_logs.insert_one({
            "email_id": email_log_id, "resend_id": resend_id, "to": to, "subject": subject,
            "idempotency_key": idempotency_key, "status": "sent", "clinic_id": clinic_id,
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "opened_at": None, "clicked_at": None, "click_count": 0,
        })
        return email_log_id
    except Exception as e:
        logger.error("Resend send failed: %s", e)
        await db.email_logs.insert_one({
            "email_id": email_log_id, "to": to, "subject": subject,
            "idempotency_key": idempotency_key, "status": "failed", "error": str(e),
            "clinic_id": clinic_id, "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        return None


async def _admin_of(clinic_id: str) -> Optional[Dict[str, Any]]:
    return await db.users.find_one({"clinic_id": clinic_id, "role": "admin"}, {"_id": 0})


async def send_email_trial_welcome(clinic_id: str):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    key = f"trial_welcome:{clinic_id}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Olá <strong>{admin.get('name','')}</strong>,</p>
        <p>Seu teste gratuito de <strong>7 dias</strong> começou. Você tem acesso a todos os recursos do plano <strong>Professional</strong>: agenda, prontuário, documentos digitais, IA clínica e orçamentos.</p>
        <p>Nos próximos dias enviaremos algumas dicas para você aproveitar melhor. Comece cadastrando seus profissionais e os primeiros pacientes.</p>"""
        return _email_shell("Bem-vindo(a) ao ProClinic 🌸", body, "Acessar painel", frontend + "/dashboard",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")
    await send_email(admin["email"], "Bem-vindo(a) ao ProClinic — trial ativado", _build, key, clinic_id=clinic_id)


async def send_email_trial_day3_features(clinic_id: str):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    key = f"trial_day3:{clinic_id}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Oi <strong>{admin.get('name','').split(' ')[0]}</strong>,</p>
        <p>Você já está há 3 dias no ProClinic. Que tal experimentar 3 recursos que muitos clientes amam?</p>
        <ul style="padding-left:18px;margin:10px 0;">
          <li><strong>Assistente de IA clínica</strong> — gera evoluções em 5 segundos a partir de um resumo.</li>
          <li><strong>Documentos jurídicos</strong> — modelos com variáveis dinâmicas + assinatura touch do paciente.</li>
          <li><strong>Orçamento digital</strong> — envie um link e o paciente aprova pelo celular.</li>
        </ul>
        <p>Acesse o painel para experimentar.</p>"""
        return _email_shell("3 recursos que você ainda não experimentou", body, "Abrir ProClinic", frontend + "/dashboard",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")
    await send_email(admin["email"], "3 recursos que vão facilitar sua rotina", _build, key, clinic_id=clinic_id)


async def send_email_trial_day5_socialproof(clinic_id: str):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    key = f"trial_day5:{clinic_id}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Oi <strong>{admin.get('name','').split(' ')[0]}</strong>,</p>
        <p>Faltam <strong>2 dias</strong> pro seu trial terminar. Se ainda tem dúvida se vale a pena, veja o que outras clínicas conquistaram:</p>
        <blockquote style="margin:14px 0;padding:12px 16px;border-left:3px solid #B76E79;background:#faf3f0;font-style:italic;color:#5c4b46;">
          "Reduzi 4h/semana em papelada com os documentos digitais. E a IA acabou com o retrabalho da evolução."<br/>
          <span style="font-size:12px;font-style:normal;color:#98908b;">— Dra. Fernanda, Clínica Belle Peau</span>
        </blockquote>
        <p>Assine agora com o cupom <strong>TRIAL10</strong> e ganhe 10% de desconto no 1º pagamento.</p>"""
        return _email_shell("O que outras clínicas descobriram no ProClinic", body, "Ver planos", frontend + "/planos",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")
    await send_email(admin["email"], "Faltam 2 dias — histórias de clínicas ProClinic", _build, key, clinic_id=clinic_id)


async def send_email_trial_expiring(clinic_id: str, days_left: int):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    key = f"trial_expiring:{clinic_id}:{days_left}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Olá <strong>{admin.get('name','')}</strong>,</p>
        <p>Seu teste gratuito termina em <strong>{days_left} dia(s)</strong>. Assine agora para não perder o acesso e continuar aproveitando o que já configurou.</p>
        <p>Planos a partir de <strong>R$ 59,90/mês</strong>. PIX, Boleto ou Cartão.</p>"""
        return _email_shell(f"Seu trial expira em {days_left} dia(s)", body, "Escolher plano", frontend + "/planos",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")
    await send_email(admin["email"], f"Seu trial ProClinic expira em {days_left} dia(s)", _build, key, clinic_id=clinic_id)


async def send_email_payment_confirmed(clinic_id: str, payment: Dict[str, Any], invoice_pdf_bytes: Optional[bytes] = None):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    amount = float(payment.get("value") or payment.get("amount") or 0)
    amount_br = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    key = f"payment_confirmed:{payment.get('id') or payment.get('payment_id')}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Recebemos seu pagamento de <strong>R$ {amount_br}</strong>. Seu acesso ao ProClinic está ativo.</p>
        <p>A fatura em PDF segue anexa a este email para seus registros.</p>"""
        return _email_shell("Pagamento confirmado ✓", body, "Ver minha assinatura", frontend + "/minha-assinatura",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")

    import base64
    attachment = None
    if invoice_pdf_bytes:
        attachment = {"filename": "fatura-proclinic.pdf", "content": base64.b64encode(invoice_pdf_bytes).decode("ascii"), "content_type": "application/pdf"}
    await send_email(admin["email"], "ProClinic — Pagamento confirmado", _build, key, attachment=attachment, clinic_id=clinic_id)


async def send_email_payment_overdue(clinic_id: str):
    admin = await _admin_of(clinic_id)
    if not admin:
        return
    key = f"payment_overdue:{clinic_id}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    frontend = os.environ.get("FRONTEND_URL", "")

    def _build(email_log_id, clinic):
        body = f"""<p>Olá <strong>{admin.get('name','')}</strong>,</p>
        <p>Identificamos que seu pagamento não foi processado. Para manter o acesso, regularize sua assinatura pelo painel.</p>
        <p>Após <strong>15 dias sem pagamento</strong>, o acesso será suspenso.</p>"""
        return _email_shell("Pagamento em atraso", body, "Regularizar agora", frontend + "/minha-assinatura",
                            clinic=clinic, email_log_id=email_log_id, backend_public_url=frontend + "/api")
    await send_email(admin["email"], "ProClinic — Pagamento em atraso", _build, key, clinic_id=clinic_id)


# ---------- Invoice PDF ----------
def _build_invoice_pdf(payment: Dict[str, Any], clinic: Dict[str, Any], sub: Dict[str, Any]) -> bytes:
    amount = float(payment.get("value") or payment.get("amount") or 0)
    amount_br = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    date = payment.get("paymentDate") or payment.get("paid_at") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cycle_label = "Anual" if sub.get("billing_cycle") == "yearly" else "Mensal"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page {{ size: A4; margin: 20mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; }}
      h1 {{ font-family: Georgia, serif; font-size: 20pt; margin: 0 0 4pt; color: #B76E79; }}
      .meta {{ font-size: 10pt; color: #666; margin-bottom: 20pt; }}
      table {{ width: 100%; border-collapse: collapse; margin: 12pt 0; }}
      th, td {{ padding: 8pt 10pt; text-align: left; border-bottom: 1px solid #e6ded7; font-size: 11pt; }}
      th {{ background: #f9f4f1; text-transform: uppercase; letter-spacing: 1pt; font-size: 9pt; color: #6b6b6b; }}
      .total {{ font-size: 16pt; font-weight: bold; text-align: right; padding-top: 14pt; }}
      .footer {{ margin-top: 30pt; font-size: 9pt; color: #999; text-align: center; }}
    </style></head><body>
      <h1>Fatura ProClinic</h1>
      <div class="meta">
        Nº {payment.get('gateway_payment_id') or payment.get('payment_id') or '—'}<br/>
        Emitida em {date}<br/>
        Cliente: {clinic.get('name','')} · CNPJ {clinic.get('cnpj','—')}
      </div>
      <table>
        <thead><tr><th>Descrição</th><th style="text-align:right;">Valor</th></tr></thead>
        <tbody>
          <tr>
            <td>ProClinic — Plano {(sub.get('plan_key') or '').capitalize()} ({cycle_label})</td>
            <td style="text-align:right;">R$ {amount_br}</td>
          </tr>
        </tbody>
      </table>
      <div class="total">Total pago: R$ {amount_br}</div>
      <div class="footer">Este documento é uma confirmação de pagamento. Para nota fiscal formal, entre em contato.</div>
    </body></html>"""
    buf = io.BytesIO()
    pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    return buf.getvalue()


async def _persist_invoice_pdf(clinic_id: str, payment_id: str, pdf_bytes: bytes) -> Dict[str, str]:
    rel_path = f"{APP_NAME}/{clinic_id}/invoices/inv-{payment_id}.pdf"
    result = put_object(rel_path, pdf_bytes, "application/pdf")
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    sig = make_file_signature(file_id, clinic_id)
    await db.files.insert_one({
        "file_id": file_id, "storage_path": result["path"],
        "original_filename": f"fatura-{payment_id}.pdf", "content_type": "application/pdf",
        "size": result.get("size", len(pdf_bytes)), "clinic_id": clinic_id,
        "is_deleted": False, "signature": sig,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"], "url": f"/api/files/{result['path']}?sig={sig}"}


@api_router.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    docs = await db.payments.find(
        {"clinic_id": user["clinic_id"], "invoice_url": {"$exists": True, "$ne": None}}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


# ---------- Cron task ----------
async def trial_check_loop():
    """Runs hourly. Sends onboarding emails at day 3 and day 5 of trial, plus day-6 expiring warning."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            async for s in db.subscriptions.find({"status": "trial"}):
                try:
                    trial_end = datetime.fromisoformat(s.get("trial_ends_at", "").replace("Z", "+00:00"))
                    started = datetime.fromisoformat(s.get("started_at", "").replace("Z", "+00:00"))
                    hours_since_start = (now - started).total_seconds() / 3600
                    hours_to_end = (trial_end - now).total_seconds() / 3600
                    # Day 3 (~ 72h after start), within a 1-hour window
                    if 68 <= hours_since_start <= 76:
                        await send_email_trial_day3_features(s["clinic_id"])
                    # Day 5 (~ 120h after start)
                    if 116 <= hours_since_start <= 124:
                        await send_email_trial_day5_socialproof(s["clinic_id"])
                    # Day 6 (24h before end)
                    if 20 <= hours_to_end <= 28:
                        await send_email_trial_expiring(s["clinic_id"], 1)
                except Exception:
                    continue
        except Exception as e:
            logger.warning("trial_check_loop error: %s", e)
        await asyncio.sleep(3600)


# ---------- Email tracking (open + click) ----------
_PIXEL_GIF = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,"
    b"\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
)


@api_router.get("/email-tracking/open/{email_id}.png")
async def email_open_tracking(email_id: str):
    """1x1 transparent GIF that records the open event."""
    try:
        await db.email_logs.update_one(
            {"email_id": email_id},
            {"$set": {"opened_at": datetime.now(timezone.utc).isoformat()},
             "$inc": {"open_count": 1}},
        )
    except Exception:
        pass
    return Response(content=_PIXEL_GIF, media_type="image/gif", headers={"Cache-Control": "no-store"})


@api_router.get("/email-tracking/click/{email_id}")
async def email_click_tracking(email_id: str, u: str):
    """Records click and redirects to the original URL."""
    try:
        await db.email_logs.update_one(
            {"email_id": email_id},
            {"$set": {"clicked_at": datetime.now(timezone.utc).isoformat()},
             "$inc": {"click_count": 1}},
        )
    except Exception:
        pass
    # basic safety: only allow http(s) URLs
    target = u if u.startswith(("http://", "https://")) else "/"
    return RedirectResponse(url=target, status_code=302)


@api_router.get("/super-admin/email-logs")
async def super_admin_email_logs(user: dict = Depends(get_current_user), limit: int = 200):
    require_super_admin(user)
    docs = await db.email_logs.find({}, {"_id": 0}).sort("sent_at", -1).to_list(limit)
    return docs


# ============================================================
# App setup
# ============================================================
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    init_storage()
    await seed_data()
    await seed_plans()
    # ensure webhook idempotency at DB level
    try:
        await db.webhook_events.create_index("event_id", unique=True)
        await db.coupons.create_index("code", unique=True)
        await db.email_logs.create_index("idempotency_key", unique=True, sparse=True)
        # ⭐ Finance indexes (Fase 2.5)
        await db.financial_entries.create_index("entry_id", unique=True)
        await db.financial_entries.create_index([("clinic_id", 1), ("due_date", -1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("paid", 1), ("type", 1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("installment_group_id", 1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("budget_id", 1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("receipt_number", 1)], sparse=True)
        await db.receipt_counters.create_index([("clinic_id", 1), ("year", 1)], unique=True)
        # ⭐ Problemas 1, 3: idempotência e session_number
        await db.session_counters.create_index([("clinic_id", 1), ("year", 1)], unique=True)
        await db.attendance_sessions.create_index("session_id", unique=True)
        await db.attendance_sessions.create_index([("clinic_id", 1), ("appointment_id", 1)])
        await db.medical_records.create_index([("clinic_id", 1), ("session_id", 1)], sparse=True)
        await db.medical_records.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.financial_entries.create_index([("clinic_id", 1), ("session_id", 1)], sparse=True)
    except Exception:
        pass
    # ensure trial for the demo clinic (idempotent)
    admin = await db.users.find_one({"email": os.environ.get("ADMIN_EMAIL", "admin@proclinic.com")}, {"_id": 0})
    if admin:
        await ensure_trial_subscription(admin["clinic_id"], admin["user_id"])
    # ensure super-admin user (idempotent)
    sa_email = "superadmin@proclinic.com"
    if not await db.users.find_one({"email": sa_email}):
        hashed = bcrypt.hashpw(b"super123", bcrypt.gensalt()).decode("utf-8")
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": sa_email, "password_hash": hashed, "name": "Super Admin",
            "role": "super_admin", "clinic_id": None, "active": True,
            "auth_provider": "email",
            "password_change_required": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded super_admin: %s / super123", sa_email)
    # start background trial-check loop
    asyncio.create_task(trial_check_loop())


@app.on_event("shutdown")
async def shutdown_db():
    client.close()
