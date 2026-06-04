from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import httpx
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Any, Dict

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query, UploadFile, File, Header
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

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
async def list_entries(user: dict = Depends(get_current_user)):
    docs = await db.financial_entries.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    ).sort("due_date", -1).to_list(1000)
    return docs


@api_router.post("/finance/entries")
async def create_entry(data: FinancialEntryIn, user: dict = Depends(get_current_user)):
    entry_id = f"fin_{uuid.uuid4().hex[:12]}"
    doc = data.model_dump()
    doc.update({
        "entry_id": entry_id,
        "clinic_id": user["clinic_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.financial_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/finance/entries/{entry_id}")
async def update_entry(entry_id: str, data: FinancialEntryIn, user: dict = Depends(get_current_user)):
    res = await db.financial_entries.update_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]},
        {"$set": data.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    doc = await db.financial_entries.find_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return doc


@api_router.delete("/finance/entries/{entry_id}")
async def delete_entry(entry_id: str, user: dict = Depends(get_current_user)):
    await db.financial_entries.delete_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]}
    )
    return {"ok": True}


@api_router.get("/finance/summary")
async def finance_summary(user: dict = Depends(get_current_user)):
    docs = await db.financial_entries.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    ).to_list(2000)
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
    session = {
        "session_id": f"att_{uuid.uuid4().hex[:12]}",
        "appointment_id": appointment_id,
        "patient_id": apt["patient_id"],
        "patient_name": apt.get("patient_name", ""),
        "procedure": apt.get("procedure"),
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
        "started_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.attendance_sessions.insert_one(session)
    session.pop("_id", None)
    return session


@api_router.put("/attendance/{session_id}")
async def update_attendance(
    session_id: str, data: AttendanceSessionIn, user: dict = Depends(get_current_user)
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


class FinalizeAttendanceIn(BaseModel):
    payment_status: Optional[Literal["pago", "parcial", "nao_pago"]] = None
    amount_total: Optional[float] = None       # if not provided, uses appt.price or budget.total
    amount_paid: Optional[float] = None        # required for parcial
    payment_method: Optional[str] = None       # pix | cartão | dinheiro | boleto
    budget_id: Optional[str] = None            # link to a budget if any
    due_date: Optional[str] = None             # for parcial/nao_pago balance


@api_router.post("/attendance/{session_id}/finalize")
async def finalize_attendance(
    session_id: str,
    payload: Optional[FinalizeAttendanceIn] = None,
    user: dict = Depends(get_current_user),
):
    """Finalize: marks session concluida, copies into medical_records, marks appointment concluido,
    and (optionally) creates financial entry(ies) based on payment_status."""
    forbid_recepcao_clinical(user)
    sess = await db.attendance_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not sess:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    # create medical record
    record = {
        "record_id": f"rec_{uuid.uuid4().hex[:12]}",
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
        "duration_seconds": sess.get("duration_seconds") or 0,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.medical_records.insert_one(record)
    record.pop("_id", None)
    # mark session concluida
    await db.attendance_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "concluido", "finalized_at": record["created_at"]}},
    )
    # mark appointment concluido
    if sess.get("appointment_id"):
        await db.appointments.update_one(
            {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
            {"$set": {"status": "concluido"}},
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
        if total is None and payload.amount_total is not None:
            total = float(payload.amount_total)
        if total is None and sess.get("appointment_id"):
            apt = await db.appointments.find_one(
                {"appointment_id": sess["appointment_id"], "clinic_id": user["clinic_id"]},
                {"_id": 0, "price": 1},
            )
            if apt:
                total = float(apt.get("price") or 0)
        total = float(total or 0)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        category = "Procedimentos"
        description = f"{sess.get('procedure') or 'Atendimento'} — {sess.get('patient_name') or ''}".strip(" —")
        base_entry = {
            "clinic_id": user["clinic_id"],
            "type": "receita",
            "category": category,
            "patient_id": sess["patient_id"],
            "appointment_id": sess.get("appointment_id"),
            "budget_id": payload.budget_id,
            "payment_method": payload.payment_method,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": user["user_id"],
        }
        if payload.payment_status == "pago":
            entry = {**base_entry,
                     "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                     "description": description,
                     "amount": total,
                     "due_date": today,
                     "paid": True,
                     "paid_at": today}
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
                      "paid_at": today}
                await db.financial_entries.insert_one(e1)
                fin_created.append(e1["entry_id"])
            if balance > 0:
                e2 = {**base_entry,
                      "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                      "description": f"{description} (saldo)",
                      "amount": balance,
                      "due_date": payload.due_date or today,
                      "paid": False}
                await db.financial_entries.insert_one(e2)
                fin_created.append(e2["entry_id"])
        elif payload.payment_status == "nao_pago":
            entry = {**base_entry,
                     "entry_id": f"fin_{uuid.uuid4().hex[:12]}",
                     "description": description,
                     "amount": total,
                     "due_date": payload.due_date or today,
                     "paid": False}
            await db.financial_entries.insert_one(entry)
            fin_created.append(entry["entry_id"])

        # link budget → approved
        if budget_doc:
            await db.budgets.update_one(
                {"budget_id": payload.budget_id},
                {"$set": {"status": "aprovado", "approved_at": datetime.now(timezone.utc).isoformat()}},
            )

    return {"ok": True, "record_id": record["record_id"], "financial_entries": fin_created}


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


@app.on_event("shutdown")
async def shutdown_db():
    client.close()
