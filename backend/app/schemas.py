"""Схемы запросов (Pydantic) — общие для роутеров."""
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(default="", max_length=64)
    invite_code: Optional[str] = Field(default=None, max_length=64)  # код приглашения для врачей
    # Филиал обязателен на сервере для любой роли (С.3): без него 422 — иначе
    # возникают «невидимые» пациенты (branch_id IS NULL не попадает ни в один пул врача)
    branch_id: int


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=64)
    age: Optional[int] = Field(default=None, ge=1, le=120)
    sex: Optional[Literal["male", "female"]] = None
    height_cm: Optional[float] = Field(default=None, ge=50, le=250)
    branch_id: Optional[int] = Field(default=None, exclude=True)  # только через защищённый endpoint


class BranchChangeIn(BaseModel):
    branch_id: int
    current_password: str = Field(min_length=1, max_length=128)


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
