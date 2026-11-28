"""Схемы запросов (Pydantic) — общие для роутеров."""
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    first_name: str = Field(default="", max_length=64)   # имя
    last_name: str = Field(default="", max_length=64)    # фамилия
    middle_name: str = Field(default="", max_length=64)  # отчество (опционально)
    phone: str = Field(default="", max_length=32)        # контактный телефон (опционально)
    name: str = Field(default="", max_length=64)  # легаси: разовое имя из клиентов до разделения ФИО
    invite_code: Optional[str] = Field(default=None, max_length=64)  # код приглашения для врачей
    # Филиал обязателен на сервере для любой роли (С.3): без него 422 — иначе
    # возникают «невидимые» пациенты (branch_id IS NULL не попадает ни в один пул врача)
    branch_id: int


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    first_name: Optional[str] = Field(default=None, max_length=64)
    last_name: Optional[str] = Field(default=None, max_length=64)
    middle_name: Optional[str] = Field(default=None, max_length=64)
    phone: Optional[str] = Field(default=None, max_length=32)  # контактный телефон
    age: Optional[int] = Field(default=None, ge=1, le=120)
    sex: Optional[Literal["male", "female"]] = None
    height_cm: Optional[float] = Field(default=None, ge=50, le=250)
    branch_id: Optional[int] = Field(default=None, exclude=True)  # только через защищённый endpoint


class BranchChangeIn(BaseModel):
    branch_id: int
    current_password: str = Field(min_length=1, max_length=128)


class PasswordChangeIn(BaseModel):
    """Смена пароля (Г1): подтверждение старым паролем, минимум как при регистрации."""
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class EmailChangeIn(BaseModel):
    """Смена email (Г2): только с текущим паролем; занятый адрес — 409."""
    current_password: str = Field(min_length=1, max_length=128)
    email: EmailStr


class MeasurementIn(BaseModel):
    """Все поля необязательны — но хотя бы одно должно быть заполнено."""
    systolic: Optional[float] = Field(default=None, ge=50, le=280)
    diastolic: Optional[float] = Field(default=None, ge=30, le=200)
    pulse: Optional[float] = Field(default=None, ge=30, le=250)
    temperature: Optional[float] = Field(default=None, ge=33, le=43)
    spo2: Optional[float] = Field(default=None, ge=50, le=100)
    sleep_hours: Optional[float] = Field(default=None, ge=0, le=24)
    steps: Optional[int] = Field(default=None, ge=0, le=200000)
    water_ml: Optional[int] = Field(default=None, ge=0, le=10000)
    weight_kg: Optional[float] = Field(default=None, ge=20, le=400)
    period: Optional[Literal["morning", "evening"]] = None  # период дня (дневник давления)
    recorded_at: Optional[str] = Field(default=None, max_length=64)  # ISO-строка; по умолчанию — сейчас


class GoalIn(BaseModel):
    """Цели пациента: целевые шаги/сон/вода/вес."""
    steps: Optional[int] = Field(default=None, ge=0, le=200000)
    sleep: Optional[float] = Field(default=None, ge=0, le=24)
    water: Optional[int] = Field(default=None, ge=0, le=10000)
    weight: Optional[float] = Field(default=None, ge=20, le=400)


class NoteIn(BaseModel):
    """Комментарий врача к анализу."""
    text: str = Field(min_length=1, max_length=1000)


HabitValue = Literal["нет", "бросил", "курирует"]
AlcoholValue = Literal["нет", "редко", "регулярно"]
ActivityValue = Literal["низкая", "средняя", "высокая"]


class MedCardIn(BaseModel):
    """Анкета-анамнез медкарты. Пустая строка = «не указано»."""
    blood_type: str = Field(default="", max_length=16)
    allergies: str = Field(default="", max_length=1000)
    chronic: str = Field(default="", max_length=2000)
    medications: str = Field(default="", max_length=1000)
    surgeries: str = Field(default="", max_length=1000)
    smoking: Optional[HabitValue] = None
    alcohol: Optional[AlcoholValue] = None
    activity: Optional[ActivityValue] = None
    survey: Optional[str] = Field(default=None, max_length=12000)  # JSON опросника МЗ 404н


class VisitIn(BaseModel):
    """Новый приём: пациент описывает, с чем идёт к врачу."""
    visit_date: str = Field(default="", max_length=10)   # YYYY-MM-DD или пусто
    reason: str = Field(default="", max_length=200)
    complaints: str = Field(min_length=1, max_length=2000)


class VisitPatchIn(BaseModel):
    """Правка планового приёма пациентом."""
    visit_date: Optional[str] = Field(default=None, max_length=10)
    reason: Optional[str] = Field(default=None, max_length=200)
    complaints: Optional[str] = Field(default=None, min_length=1, max_length=2000)


class VisitCloseIn(BaseModel):
    """Заключение врача по приёму."""
    conclusion: str = Field(min_length=1, max_length=2000)
    recommendations: str = Field(default="", max_length=2000)


class SymptomNoteIn(BaseModel):
    """Запись дневника самочувствия (Е2): дата, самочувствие 1–5, текст."""
    recorded_at: str = Field(default="", max_length=10)  # YYYY-MM-DD или пусто — сейчас
    wellbeing: int = Field(ge=1, le=5)
    text: str = Field(min_length=1, max_length=2000)


class OrderIn(BaseModel):
    """Направление врача (Е3): «сдать анализ X», категория нужного бланка."""
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=20)


class DocumentPatchIn(BaseModel):
    """Правка документа: название и/или категория.

    Ручное название переводит документ в title_source='user' — OCR больше
    его не перезаписывает. Пустая категория означает «переклассифицируй
    по распознанному тексту».
    """
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, max_length=20)
