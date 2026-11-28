"""SQLAlchemy модели, зеркалирующие текущую схему SQLite (для Alembic autogenerate)."""
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Branch(Base):
    __tablename__ = "branches"
    id = Column(Integer, primary_key=True, autoincrement=True)
    city = Column(String, nullable=False, unique=True)
    phone = Column(String, nullable=False, default="")
    address = Column(String, nullable=False, default="")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False, default="")  # отображаемое ФИО, пересобирается из частей
    first_name = Column(String, nullable=False, default="")
    last_name = Column(String, nullable=False, default="")
    middle_name = Column(String, nullable=False, default="")
    age = Column(Integer, nullable=True)
    sex = Column(String, nullable=True)  # CHECK в миграции
    height_cm = Column(Float, nullable=True)
    role = Column(String, nullable=False, default="patient")  # CHECK в миграции
    branch_id = Column(Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    phone = Column(String, nullable=False, default="")  # контактный телефон
    notifications_seen_at = Column(DateTime, nullable=True)  # открытие колокольчика
    disabled = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("sex IN ('male', 'female') OR sex IS NULL", name="ck_users_sex"),
        CheckConstraint("role IN ('patient', 'doctor')", name="ck_users_role"),
    )


class InviteCode(Base):
    __tablename__ = "invite_codes"
    code = Column(String, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    used_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_at = Column(DateTime, nullable=True)


class Session(Base):
    __tablename__ = "sessions"
    token = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)


class Measurement(Base):
    __tablename__ = "measurements"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recorded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    systolic = Column(Float, nullable=True)
    diastolic = Column(Float, nullable=True)
    pulse = Column(Float, nullable=True)
    temperature = Column(Float, nullable=True)
    spo2 = Column(Float, nullable=True)
    sleep_hours = Column(Float, nullable=True)
    steps = Column(Integer, nullable=True)
    water_ml = Column(Integer, nullable=True)
    weight_kg = Column(Float, nullable=True)
    period = Column(String, nullable=True)  # 'morning' | 'evening'

    __table_args__ = (
        CheckConstraint(
            "systolic IS NOT NULL OR diastolic IS NOT NULL OR pulse IS NOT NULL "
            "OR temperature IS NOT NULL OR spo2 IS NOT NULL OR sleep_hours IS NOT NULL "
            "OR steps IS NOT NULL OR water_ml IS NOT NULL OR weight_kg IS NOT NULL",
            name="ck_measurements_at_least_one",
        ),
        Index("ix_measurements_user_recorded", "user_id", "recorded_at"),
    )


class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, autoincrement=True)
    measurement_id = Column(Integer, ForeignKey("measurements.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    risk_level = Column(String, nullable=False)  # CHECK в миграции
    source = Column(String, nullable=False, default="rules")
    findings = Column(Text, nullable=False, default="[]")
    recommendations = Column(Text, nullable=False, default="[]")
    llm_text = Column(Text, nullable=True)
    bmi = Column(Float, nullable=True)

    __table_args__ = (
        CheckConstraint("risk_level IN ('green', 'yellow', 'red')", name="ck_analyses_risk"),
    )


class DoctorNote(Base):
    __tablename__ = "doctor_notes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    analysis_id = Column(Integer, ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    doctor_name = Column(String, nullable=False, default="")
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_doctor_notes_analysis", "analysis_id"),
    )


class PatientCard(Base):
    __tablename__ = "patient_cards"
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blood_type = Column(String, nullable=False, default="")
    allergies = Column(Text, nullable=False, default="")
    chronic = Column(Text, nullable=False, default="")
    medications = Column(Text, nullable=False, default="")
    surgeries = Column(Text, nullable=False, default="")
    smoking = Column(String, nullable=False, default="")
    alcohol = Column(String, nullable=False, default="")
    activity = Column(String, nullable=False, default="")
    survey = Column(Text, nullable=True)
    updated_by = Column(String, nullable=True)  # 'patient' | 'doctor'
    updated_at = Column(DateTime, nullable=True)


class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    metric = Column(String, nullable=False)
    target_value = Column(Float, nullable=False)
    period = Column(String, nullable=False, default="day")  # day | week
    is_active = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_goals_user_active", "user_id", "is_active"),
    )


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # pdf | image | lab
    filename = Column(String, nullable=False)
    stored_path = Column(String, nullable=False)
    mime_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    analysis_id = Column(Integer, ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True)
    ocr_text = Column(Text, nullable=True)
    ocr_text_clean = Column(Text, nullable=True)  # результат постобработки
    ocr_status = Column(String, nullable=True)  # pending | done | failed
    ocr_error = Column(Text, nullable=True)
    doctor_viewed_at = Column(DateTime, nullable=True)  # врач филиала открывал документ
    lab_values = Column(Text, nullable=True)  # JSON показателей (services/lab_parse.py)

    __table_args__ = (
        Index("ix_documents_user_uploaded", "user_id", "uploaded_at"),
    )


class Visit(Base):
    __tablename__ = "visits"
    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="booked")  # booked | done | cancelled
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=True)
    complaint = Column(Text, nullable=True)
    diagnosis = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_visits_patient_starts", "patient_id", "starts_at"),
        Index("ix_visits_doctor_starts", "doctor_id", "starts_at"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # user | assistant | tool
    content = Column(Text, nullable=True)
    tool_calls = Column(Text, nullable=True)  # JSON
    tool_call_id = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_chat_messages_user_created", "user_id", "created_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String, nullable=False)
    entity = Column(String, nullable=True)
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)  # JSON
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_audit_log_user_created", "user_id", "created_at"),
        Index("ix_audit_log_entity", "entity", "entity_id"),
    )