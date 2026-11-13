"""Роутер статистики: ряды данных для графиков динамики."""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends

from .. import auth
from ..database import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])

CHART_FIELDS = ("systolic", "diastolic", "pulse", "temperature", "spo2",
                "sleep_hours", "steps", "water_ml", "weight_kg")


@router.get("")
def stats(
    limit: int = 60,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Последние N измерений с ненулевыми полями — для построения графиков.

    Возвращает {"points": [{recorded_at, ...поля}], "bmi_points": [...]}.
    """
    rows = db.execute(
        """
        SELECT m.recorded_at, m.systolic, m.diastolic, m.pulse, m.temperature,
               m.spo2, m.sleep_hours, m.steps, m.water_ml, m.weight_kg,
               u.height_cm, a.bmi
        FROM measurements m
        LEFT JOIN analyses a ON a.measurement_id = m.id
        JOIN users u ON u.id = m.user_id
        WHERE m.user_id = ?
        ORDER BY m.recorded_at ASC, m.id ASC
        LIMIT ?
        """,
        (user["id"], limit),
    ).fetchall()

    points = []
    bmi_points = []
    for row in rows:
        point = {"recorded_at": row["recorded_at"]}
        for field in CHART_FIELDS:
            if row[field] is not None:
                point[field] = row[field]
        # Добавляем точку, только если есть хотя бы один графичный показатель
        if len(point) > 1:
            points.append(point)
        bmi_value: Optional[float] = row["bmi"]
        if bmi_value is None and row["weight_kg"] and row["height_cm"] and row["height_cm"] > 50:
            bmi_value = round(row["weight_kg"] / (row["height_cm"] / 100) ** 2, 1)
        if bmi_value is not None:
            bmi_points.append({"recorded_at": row["recorded_at"], "bmi": bmi_value})

    return {"points": points, "bmi_points": bmi_points}
