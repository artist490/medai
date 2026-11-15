"""Роутер измерений и анализов."""
import json
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import auth
from ..database import get_db
from ..schemas import MeasurementIn
from ..services import analyze as analyze_service
from ..services.payloads import analysis_payload, measurement_payload, notes_map

router = APIRouter(prefix="/api/measurements", tags=["measurements"])


def _insert_and_analyze(
    db: sqlite3.Connection,
    user: sqlite3.Row,
    values: dict,
    recorded_at: str,
    period: str | None = None,
) -> dict:
    """Общий блок create/repeat: INSERT замера → анализ (правила + LLM) →
    INSERT analyses → готовый payload ответа (см. TECH_DEBT_AUDIT.md F018)."""
    columns = ["user_id", "recorded_at", *values.keys()]
    params: list[object] = [user["id"], recorded_at, *values.values()]
    if period:
        columns.append("period")
        params.append(period)
    placeholders = ", ".join("?" for _ in columns)
    cursor = db.execute(
        f"INSERT INTO measurements ({', '.join(columns)}) VALUES ({placeholders})",
        params,
    )
    measurement_id = cursor.lastrowid
    measurement = db.execute(
        "SELECT * FROM measurements WHERE id = ?", (measurement_id,)
    ).fetchone()

    # Полный анализ: правила → риск → LLM (если настроен)
    result = analyze_service.run_analysis(measurement, user)
    db.execute(
        """
        INSERT INTO analyses (measurement_id, user_id, risk_level, source,
                              findings, recommendations, llm_text, bmi)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            measurement_id,
            user["id"],
            result["risk_level"],
            result["source"],
            json.dumps(result["findings"], ensure_ascii=False),
            json.dumps(result["recommendations"], ensure_ascii=False),
            json.dumps({"summary": result["llm_summary"], "items": result["llm_items"]},
                       ensure_ascii=False) if result["llm_summary"] else None,
            result["bmi"],
        ),
    )
    analysis = db.execute(
        "SELECT * FROM analyses WHERE measurement_id = ?", (measurement_id,)
    ).fetchone()
    db.commit()  # см. комментарий в routers/auth.py register
    payload = analysis_payload(analysis) if analysis is not None else None
    return measurement_payload(measurement, payload)


@router.post("", status_code=201)
def create_measurement(
    data: MeasurementIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    values = {k: v for k, v in data.model_dump().items() if k != "recorded_at" and k != "period" and v is not None}
    if not values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Заполните хотя бы один показатель")

    if data.recorded_at:
        try:
            dt = datetime.fromisoformat(data.recorded_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Некорректная дата замера — ожидается ISO, например 2026-01-31 14:30")
        recorded_at = dt.strftime("%Y-%m-%d %H:%M:%S")
    else:
        recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return _insert_and_analyze(db, user, values, recorded_at, period=data.period)


@router.post("/repeat", status_code=201)
def repeat_last_measurement(
    period: str = Query(default="evening", pattern="^(morning|evening)$"),
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Быстрый дневник: повторить последний замер с новым временем записи.

    Копирует показательные поля последнего замера (значения можно
    отредактировать обычным созданием замера)."""
    last = db.execute(
        "SELECT * FROM measurements WHERE user_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1",
        (user["id"],),
    ).fetchone()
    if last is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Нечего повторять — сначала сделайте замер")

    fields = ("systolic", "diastolic", "pulse", "temperature", "spo2",
              "sleep_hours", "steps", "water_ml", "weight_kg")
    values = {k: last[k] for k in fields if last[k] is not None}
    if not values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "В последнем замере нет показателей")
    return _insert_and_analyze(db, user, values,
                               datetime.now().strftime("%Y-%m-%d %H:%M:%S"), period=period)


@router.get("")
def list_measurements(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    rows = db.execute(
        """
        SELECT m.*, a.id AS a_id, a.measurement_id AS a_mid, a.created_at AS a_created,
               a.risk_level, a.source, a.findings, a.recommendations, a.llm_text, a.bmi
        FROM measurements m
        LEFT JOIN analyses a ON a.measurement_id = m.id
        WHERE m.user_id = ?
        ORDER BY m.recorded_at DESC, m.id DESC
        LIMIT ? OFFSET ?
        """,
        (user["id"], limit, offset),
    ).fetchall()
    total = db.execute(
        "SELECT COUNT(*) AS c FROM measurements WHERE user_id = ?", (user["id"],)
    ).fetchone()["c"]

    notes = notes_map(db, user["id"])
    items = []
    for row in rows:
        analysis = None
        if row["a_id"] is not None:
            analysis = analysis_payload(row, id_key="a_id", mid_key="a_mid", created_key="a_created",
                                        notes=notes.get(row["a_id"], []))
        items.append(measurement_payload(row, analysis))
    return {"items": items, "total": total}


@router.get("/{measurement_id}")
def get_measurement(
    measurement_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    m = db.execute(
        "SELECT * FROM measurements WHERE id = ? AND user_id = ?",
        (measurement_id, user["id"]),
    ).fetchone()
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Измерение не найдено")
    analysis_row = db.execute(
        "SELECT * FROM analyses WHERE measurement_id = ?", (measurement_id,)
    ).fetchone()
    analysis = None
    if analysis_row is not None:
        notes = notes_map(db, user["id"])
        analysis = analysis_payload(analysis_row, notes=notes.get(analysis_row["id"], []))
    return measurement_payload(m, analysis)


@router.delete("/{measurement_id}", status_code=204)
def delete_measurement(
    measurement_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.execute(
        "DELETE FROM measurements WHERE id = ? AND user_id = ?",
        (measurement_id, user["id"]),
    )
    if cursor.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Измерение не найдено")
    db.commit()  # см. комментарий в routers/auth.py register
    return None
