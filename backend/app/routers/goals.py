"""Роутер целей пациента: целевые шаги/сон/вода/вес для прогресс-полос."""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends

from .. import auth
from ..database import get_db
from ..schemas import GoalIn

router = APIRouter(prefix="/api/goals", tags=["goals"])

FIELDS = ("steps", "sleep", "water", "weight")


def _goals_payload(row: Optional[sqlite3.Row]) -> dict:
    if row is None:
        return {f: None for f in FIELDS}
    return {f: row[f] for f in FIELDS}


@router.get("")
def get_goals(user: sqlite3.Row = Depends(auth.get_current_user),
              db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT * FROM goals WHERE user_id = ?", (user["id"],)).fetchone()
    return _goals_payload(row)


@router.put("")
def save_goals(data: GoalIn, user: sqlite3.Row = Depends(auth.get_current_user),
               db: sqlite3.Connection = Depends(get_db)):
    values = {k: v for k, v in data.model_dump().items() if v is not None}
    if values:
        db.execute(
            """INSERT INTO goals (user_id, steps, sleep, water, weight)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 steps = COALESCE(excluded.steps, goals.steps),
                 sleep = COALESCE(excluded.sleep, goals.sleep),
                 water = COALESCE(excluded.water, goals.water),
                 weight = COALESCE(excluded.weight, goals.weight)""",
            (user["id"], values.get("steps"), values.get("sleep"),
             values.get("water"), values.get("weight")),
        )
        db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute("SELECT * FROM goals WHERE user_id = ?", (user["id"],)).fetchone()
    return _goals_payload(row)
