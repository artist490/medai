"""Роутер приёмов: пациент записывается с жалобами, врач пишет заключение.

Пациент работает только со своими приёмами; врач — с приёмами пациентов
своего филиала (эндпоинты в routers/doctor.py).
"""
import re
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import VisitIn, VisitPatchIn

router = APIRouter(prefix="/api/visits", tags=["visits"])

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Сверху плановые (ближайший визит), затем завершённые, отменённые — в конец
ORDER_SQL = """
ORDER BY CASE status WHEN 'planned' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
         visit_date DESC, id DESC
"""


def _visit_payload(row: sqlite3.Row) -> dict:
    return dict(row)


# Джойн имени врача — пациенту приятно видеть, кто принимал
VISIT_SELECT = """
SELECT v.*, du.name AS doctor_name FROM visits v
LEFT JOIN users du ON du.id = v.doctor_id
"""


def _check_date(visit_date: str) -> str:
    if visit_date and not DATE_RE.match(visit_date):
        raise HTTPException(422, "Дата должна быть в формате ГГГГ-ММ-ДД")
    return visit_date


@router.post("", status_code=201)
def create_visit(
    data: VisitIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациент записывается на приём: цель + жалобы."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Запись на приём доступна только пациентам")
    visit_date = _check_date(data.visit_date.strip())
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor = db.execute(
        """
        INSERT INTO visits (patient_id, branch_id, visit_date, reason, complaints, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user["id"], user["branch_id"], visit_date, data.reason.strip(),
         data.complaints.strip(), now, now),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute(f"{VISIT_SELECT} WHERE v.id = ?", (cursor.lastrowid,)).fetchone()
    return _visit_payload(row)


@router.get("/mine")
def my_visits(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Приёмы пациента: плановые сверху, затем история."""
    rows = db.execute(
        f"{VISIT_SELECT} WHERE v.patient_id = ? {ORDER_SQL}",
        (user["id"],),
    ).fetchall()
    return {"items": [_visit_payload(r) for r in rows]}


def _own_planned_visit(db: sqlite3.Connection, visit_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM visits WHERE id = ? AND patient_id = ?",
        (visit_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приём не найден")
    if row["status"] != "planned":
        raise HTTPException(status.HTTP_409_CONFLICT, "Приём уже обработан врачом")
    return row


@router.patch("/{visit_id}")
def patch_visit(
    visit_id: int,
    data: VisitPatchIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациент правит плановый приём (цель, жалобы, дату)."""
    _own_planned_visit(db, visit_id, user["id"])
    updates, values = [], []
    if data.visit_date is not None:
        updates.append("visit_date = ?")
        values.append(_check_date(data.visit_date.strip()))
    if data.reason is not None:
        updates.append("reason = ?")
        values.append(data.reason.strip())
    if data.complaints is not None:
        updates.append("complaints = ?")
        values.append(data.complaints.strip())
    updates.append("updated_at = ?")
    values.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    values.append(visit_id)
    db.execute(f"UPDATE visits SET {', '.join(updates)} WHERE id = ?", values)
    db.commit()
    row = db.execute(f"{VISIT_SELECT} WHERE v.id = ?", (visit_id,)).fetchone()
    return _visit_payload(row)


@router.post("/{visit_id}/cancel")
def cancel_visit(
    visit_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациент отменяет плановый приём."""
    _own_planned_visit(db, visit_id, user["id"])
    db.execute(
        "UPDATE visits SET status = 'cancelled', updated_at = ? WHERE id = ?",
        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), visit_id),
    )
    db.commit()
    row = db.execute(f"{VISIT_SELECT} WHERE v.id = ?", (visit_id,)).fetchone()
    return _visit_payload(row)
