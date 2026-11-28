"""Направления врача (Е3): чеклист пациента «сдать анализ X».

Создаёт врач в карточке пациента (эндпоинты в routers/doctor.py), выполняет
пациент: загрузил бланк нужной категории в Документы — отметил выполненным.
Авто-закрытие по загрузке не делаем: распознавание может не подтвердить,
ручная отметка честнее (принцип «ручное всегда правит авто»).
"""
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..services.audit import record

router = APIRouter(prefix="/api/orders", tags=["orders"])

ORDER_FIELDS = "id, doctor_name, title, category, status, created_at, completed_at"


def _order_payload(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in (
        "id", "doctor_name", "title", "category", "status", "created_at", "completed_at",
    )}


def _own_order(db: sqlite3.Connection, order_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM doctor_orders WHERE id = ? AND patient_id = ?",
        (order_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Направление не найдено")
    return row


@router.get("/mine")
def my_orders(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Направления пациента: плановые сверху, затем история."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Направления доступны пациентам")
    rows = db.execute(
        f"""SELECT {ORDER_FIELDS} FROM doctor_orders WHERE patient_id = ?
           ORDER BY CASE status WHEN 'planned' THEN 0 ELSE 1 END, id DESC""",
        (user["id"],),
    ).fetchall()
    return {"items": [_order_payload(r) for r in rows]}


@router.post("/{order_id}/complete")
def complete_order(
    order_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациент отметил направление выполненным (бланк загружен в Документы)."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Направления доступны пациентам")
    _own_order(db, order_id, user["id"])
    db.execute(
        "UPDATE doctor_orders SET status = 'done', completed_at = ? WHERE id = ?",
        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), order_id),
    )
    db.commit()
    row = db.execute(f"SELECT {ORDER_FIELDS} FROM doctor_orders WHERE id = ?", (order_id,)).fetchone()
    return _order_payload(row)
