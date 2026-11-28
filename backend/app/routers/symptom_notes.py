"""Дневник самочувствия (Е2): записи пациента о состоянии между приёмами.

Не путать с жалобами приёма (visits.complaints): это регулярный дневник,
который пациент ведёт сам и который видит врач в карточке пациента.
"""
import re
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import SymptomNoteIn

router = APIRouter(prefix="/api/symptoms", tags=["symptoms"])

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_date(recorded_at: str) -> str:
    if recorded_at and not DATE_RE.match(recorded_at):
        raise HTTPException(422, "Дата должна быть в формате ГГГГ-ММ-ДД")
    return recorded_at


def _note_payload(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in ("id", "recorded_at", "wellbeing", "text")}


def _own_note(db: sqlite3.Connection, note_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM symptom_notes WHERE id = ? AND user_id = ?",
        (note_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запись не найдена")
    return row


@router.get("/mine")
def my_notes(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Дневник самочувствия пациента, новые сверху."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Дневник доступен пациентам")
    rows = db.execute(
        "SELECT id, recorded_at, wellbeing, text FROM symptom_notes "
        "WHERE user_id = ? ORDER BY id DESC LIMIT 100",
        (user["id"],),
    ).fetchall()
    return {"items": [_note_payload(r) for r in rows]}


@router.post("", status_code=201)
def add_note(
    data: SymptomNoteIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Дневник доступен пациентам")
    recorded_at = _check_date(data.recorded_at.strip())
    cursor = db.execute(
        """INSERT INTO symptom_notes (user_id, recorded_at, wellbeing, text)
           VALUES (?, COALESCE(NULLIF(?, ''), datetime('now', 'localtime')), ?, ?)""",
        (user["id"], recorded_at, data.wellbeing, data.text.strip()),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute("SELECT * FROM symptom_notes WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _note_payload(row)


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Дневник доступен пациентам")
    _own_note(db, note_id, user["id"])
    db.execute("DELETE FROM symptom_notes WHERE id = ?", (note_id,))
    db.commit()
    return None
