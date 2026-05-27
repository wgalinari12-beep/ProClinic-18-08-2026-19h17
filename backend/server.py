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
    email: EmailStr
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


class PatientOut(PatientIn):
    patient_id: str
    clinic_id: str
    created_at: str


class AppointmentIn(BaseModel):
    patient_id: str
    professional_id: Optional[str] = None
    professional_name: Optional[str] = None
    procedure: str
    start: str  # ISO datetime
    end: str
    status: str = "agendado"  # agendado, confirmado, concluido, cancelado, encaixe
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


class FinancialEntryOut(FinancialEntryIn):
    entry_id: str
    clinic_id: str
    created_at: str


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
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_access_token(user["user_id"], email)
    set_auth_cookie(response, token)
    return {
        "user_id": user["user_id"], "email": email, "name": user["name"],
        "role": user["role"], "clinic_id": user["clinic_id"],
        "auth_provider": user.get("auth_provider", "email"),
        "picture": user.get("picture"),
        "token": token,
    }


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
@api_router.get("/appointments")
async def list_appointments(
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q = {"clinic_id": user["clinic_id"]}
    if start and end:
        q["start"] = {"$gte": start, "$lte": end}
    docs = await db.appointments.find(q, {"_id": 0}).sort("start", 1).to_list(1000)
    # attach patient_name
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
    doc = data.model_dump()
    doc.update({
        "appointment_id": appointment_id,
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"] if p else "Paciente",
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
    q = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.medical_records.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/medical-records")
async def create_record(data: MedicalRecordIn, user: dict = Depends(get_current_user)):
    record_id = f"rec_{uuid.uuid4().hex[:12]}"
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1}
    )
    doc = data.model_dump()
    doc.update({
        "record_id": record_id,
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"] if p else "Paciente",
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
    q = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    docs = await db.anamnesis.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/anamnesis")
async def create_anamnesis(data: AnamnesisIn, user: dict = Depends(get_current_user)):
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

    # Demo professional
    prof = await db.users.find_one({"email": "dra.bella@proclinic.com"})
    if not prof:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": "dra.bella@proclinic.com",
            "name": "Dra. Bella Castro",
            "password_hash": hash_password("bella123"),
            "role": "profissional",
            "clinic_id": clinic_id,
            "auth_provider": "email",
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
        today = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
        procedures = ["Botox", "Preenchimento Labial", "Limpeza de Pele", "Microagulhamento",
                      "Bioestimulador", "Ultraformer", "Harmonização Facial", "Laser Facial"]
        statuses = ["confirmado", "agendado", "confirmado", "concluido", "agendado"]
        for i, pat in enumerate(patients_list):
            for day_offset in range(0, 5):
                start = today + timedelta(days=day_offset, hours=i*2)
                end = start + timedelta(hours=1, minutes=30)
                await db.appointments.insert_one({
                    "appointment_id": f"apt_{uuid.uuid4().hex[:12]}",
                    "clinic_id": clinic_id,
                    "patient_id": pat["patient_id"],
                    "patient_name": pat["name"],
                    "professional_name": "Dra. Bella Castro",
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
    path = f"{APP_NAME}/{user['clinic_id']}/{user['user_id']}/{uuid.uuid4()}.{ext}"
    result = put_object(path, raw, content_type)
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    doc = {
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(raw)),
        "clinic_id": user["clinic_id"],
        "uploaded_by": user["user_id"],
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(doc)
    return {
        "file_id": file_id,
        "url": f"/api/files/{result['path']}",
        "path": result["path"],
        "content_type": content_type,
        "size": doc["size"],
    }


@api_router.get("/files/{path:path}")
async def serve_file(path: str, request: Request, auth: Optional[str] = Query(None)):
    # Allow auth via query param OR cookie OR header
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
    signature: Optional[str] = None  # base64 png
    signed: bool = False


@api_router.post("/anamnesis-modules")
async def save_anamnesis_module(data: AnamnesisModuleIn, user: dict = Depends(get_current_user)):
    p = await db.patients.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    # upsert by patient+module (latest version replaces draft)
    existing = await db.anamnesis_modules.find_one(
        {"patient_id": data.patient_id, "clinic_id": user["clinic_id"], "module": data.module},
        {"_id": 0},
    )
    doc = data.model_dump()
    doc.update({
        "clinic_id": user["clinic_id"],
        "patient_name": p["name"],
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


@api_router.get("/anamnesis-modules")
async def list_anamnesis_modules(patient_id: str, user: dict = Depends(get_current_user)):
    docs = await db.anamnesis_modules.find(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    ).to_list(20)
    return docs


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
    """Autosave attendance session draft."""
    update = data.model_dump(exclude_none=False)
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


@api_router.post("/attendance/{session_id}/finalize")
async def finalize_attendance(session_id: str, user: dict = Depends(get_current_user)):
    """Finalize: marks session concluida, copies into medical_records, marks appointment concluido."""
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
    return {"ok": True, "record_id": record["record_id"]}


@api_router.get("/attendance/by-appointment/{appointment_id}")
async def get_attendance_by_appointment(appointment_id: str, user: dict = Depends(get_current_user)):
    sess = await db.attendance_sessions.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not sess:
        return None
    return sess


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
    body: str
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
