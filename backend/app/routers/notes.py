"""Заметки врача: полный список комментариев по разборам пациента (A2).

На дашборде пациента показывается только последний комментарий — здесь
собраны все, новые сверху. Врач-фильтр не нужен: комментарий к разбору
один раз заведён врачом филиала и принадлежит пациенту.
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db

router = APIRouter(prefix="/api/notes", tags=["notes"])


@router.get("/mine")
def my_notes(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Все заметки врача по разборам текущего пациента, новые сверху."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Список заметок доступен пациентам")
    rows = db.execute(
        """SELECT n.id, n.doctor_name, n.text, n.created_at,
                  a.id AS analysis_id, a.risk_level, m.recorded_at
           FROM doctor_notes n
           JOIN analyses a ON a.id = n.analysis_id
           JOIN measurements m ON m.id = a.measurement_id
           WHERE a.user_id = ?
           ORDER BY n.id DESC""",
        (user["id"],),
    ).fetchall()
    return {"items": [dict(r) for r in rows]}
