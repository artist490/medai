"""Роутер медкарты: анамнез пациента (1:1 к пользователю).

Заполняют и пациент (свой кабинет), и врач (карточка пациента).
Гвард врача — тот же, что в routers/doctor.py: пациент обязан быть
из филиала врача (branch_id IS ?).
"""
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import MedCardIn
from ..services.audit import record
from ..services.signals import ALARM_SURVEY_KEYS

router = APIRouter(prefix="/api/medcard", tags=["medcard"])

CARD_FIELDS = (
    "blood_type", "allergies", "chronic", "medications",
    "surgeries", "smoking", "alcohol", "activity",
)


def _card_payload(row: sqlite3.Row | None) -> dict:
    # alarm_keys — единый источник тревожных ключей опросника МЗ (F007):
    # импортируется из services/signals.py, фронт дубликата не держит
    alarm_keys = sorted(ALARM_SURVEY_KEYS)
    if row is None:  # анкета ещё не заводилась
        return {field: "" for field in CARD_FIELDS} | {
            "survey": None, "updated_by": None, "updated_at": None,
            "alarm_keys": alarm_keys,
        }
    return {field: row[field] for field in CARD_FIELDS} | {
        "survey": row["survey"],
        "updated_by": row["updated_by"],
        "updated_at": row["updated_at"],
        "alarm_keys": alarm_keys,
    }


def _save_card(db: sqlite3.Connection, patient_id: int, data: MedCardIn, updated_by: str) -> dict:
    """UPSERT анкеты. Поля-привычки: None = не трогать, строка = заменить."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    values = {field: getattr(data, field) or "" for field in CARD_FIELDS}
    db.execute(
        """
        INSERT INTO patient_cards (user_id, blood_type, allergies, chronic, medications,
                                   surgeries, smoking, alcohol, activity, survey, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            blood_type  = excluded.blood_type,
            allergies   = excluded.allergies,
            chronic     = excluded.chronic,
            medications = excluded.medications,
            surgeries   = excluded.surgeries,
            smoking     = excluded.smoking,
            alcohol     = excluded.alcohol,
            activity    = excluded.activity,
            survey      = excluded.survey,
            updated_by  = excluded.updated_by,
            updated_at  = excluded.updated_at
        """,
        (
            patient_id,
            values["blood_type"], values["allergies"], values["chronic"], values["medications"],
            values["surgeries"], values["smoking"], values["alcohol"], values["activity"],
            data.survey, updated_by, now,
        ),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute("SELECT * FROM patient_cards WHERE user_id = ?", (patient_id,)).fetchone()
    return _card_payload(row)


@router.get("")
def my_card(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Собственная медкарта (пустая, если анкета ещё не заполнялась)."""
    row = db.execute("SELECT * FROM patient_cards WHERE user_id = ?", (user["id"],)).fetchone()
    return _card_payload(row)


@router.put("")
def save_my_card(
    data: MedCardIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациент сохраняет свою анкету."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Медкарта доступна только пациентам")
    return _save_card(db, user["id"], data, updated_by="patient")


@router.get("/patient/{patient_id}")
def patient_card(
    patient_id: int,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Анкета пациента филиала — для карточки пациента."""
    patient = db.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'patient' AND branch_id IS ?",
        (patient_id, user["branch_id"]),
    ).fetchone()
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")
    row = db.execute("SELECT * FROM patient_cards WHERE user_id = ?", (patient_id,)).fetchone()
    record(db, "patient.medcard.read", user_id=user["id"], entity="patient", entity_id=patient_id)
    db.commit()
    return _card_payload(row)


@router.put("/patient/{patient_id}")
def save_patient_card(
    patient_id: int,
    data: MedCardIn,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Врач дополняет/правит анкету пациента."""
    patient = db.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'patient' AND branch_id IS ?",
        (patient_id, user["branch_id"]),
    ).fetchone()
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")
    result = _save_card(db, patient_id, data, updated_by="doctor")
    record(db, "patient.medcard.update", user_id=user["id"], entity="patient", entity_id=patient_id)
    db.commit()
    return result
