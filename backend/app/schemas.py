"""Схемы запросов (Pydantic) — общие для роутеров."""
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=64)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=64)
    age: Optional[int] = Field(default=None, ge=1, le=120)
    sex: Optional[Literal["male", "female"]] = None
    height_cm: Optional[float] = Field(default=None, ge=50, le=250)


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
    recorded_at: Optional[str] = None  # ISO-строка; по умолчанию — сейчас
