"""Роутер врача: общий пул пациентов клиники, детали и комментарии к анализам."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import NoteIn
from .measurements import analysis_payload, measurement_payload

router = APIRouter(prefix="/api/doctor", tags=["doctor"])

PATIENT_FIELDS = "id, email, name, age, sex, height_cm, role, created_at"


def _patient_payload(p: sqlite3.Row) -> dict:
    return {k: p[k] for k in ("id", "email", "name", "age", "sex", "height_cm", "created_at")}


def _notes_for(db: sqlite3.Connection, analysis_id: int) -> list[dict]:
    rows = db.execute(
        """
        SELECT id, doctor_name, text, created_at FROM doctor_notes
        WHERE analysis_id = ? ORDER BY id
        """,
        (analysis_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/patients")
def list_patients(
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Все пациенты клиники: последний риск, счётчики за 100 замеров, флаг внимания."""
    patients = db.execute(
        f"SELECT {PATIENT_FIELDS} FROM users WHERE role = 'patient' ORDER BY id"
    ).fetchall()

    items = []
    for p in patients:
        rows = db.execute(
            """
            SELECT m.recorded_at, a.risk_level
            FROM measurements m
            LEFT JOIN analyses a ON a.measurement_id = m.id
            WHERE m.user_id = ?
            ORDER BY m.recorded_at DESC, m.id DESC
            LIMIT 100
            """,
            (p["id"],),
        ).fetchall()

        counts = {"green": 0, "yellow": 0, "red": 0}
        last_risk = None
        last_at = None
        for i, row in enumerate(rows):
            risk = row["risk_level"]
            if risk in counts:
                counts[risk] += 1
                if last_risk is None:
                    last_risk, last_at = risk, row["recorded_at"]

        items.append({
            **_patient_payload(p),
            "last_measurement_at": last_at,
            "last_risk": last_risk,
            "requires_attention": last_risk == "red",  # urgent всегда даёт red
            "counts": counts,
            "total": len(rows),
        })

    # Свежие замеры — выше; затем стабильной сортировкой поднимаем требующих внимания
    items.sort(key=lambda x: x["last_measurement_at"] or "", reverse=True)
    items.sort(key=lambda x: not x["requires_attention"])
    return {"items": items}


@router.get("/patients/{patient_id}")
def patient_detail(
    patient_id: int,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    p = db.execute(
        f"SELECT {PATIENT_FIELDS} FROM users WHERE id = ? AND role = 'patient'",
        (patient_id,),
    ).fetchone()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")

    rows = db.execute(
        """
        SELECT m.*, a.id AS a_id, a.measurement_id AS a_mid, a.created_at AS a_created,
               a.risk_level, a.source, a.findings, a.recommendations, a.llm_text, a.bmi
        FROM measurements m
        LEFT JOIN analyses a ON a.measurement_id = m.id
        WHERE m.user_id = ?
        ORDER BY m.recorded_at DESC, m.id DESC
        LIMIT 100
        """,
        (patient_id,),
    ).fetchall()

    items = []
    for row in rows:
        analysis = None
        if row["a_id"] is not None:
            analysis = analysis_payload(row, id_key="a_id", mid_key="a_mid", created_key="a_created")
            analysis["notes"] = _notes_for(db, analysis["id"])
        items.append(measurement_payload(row, analysis))
    return {"patient": _patient_payload(p), "items": items}


@router.post("/analyses/{analysis_id}/notes", status_code=201)
def add_note(
    analysis_id: int,
    data: NoteIn,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    analysis = db.execute("SELECT id FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Анализ не найден")

    cursor = db.execute(
        """
        INSERT INTO doctor_notes (analysis_id, doctor_id, doctor_name, text)
        VALUES (?, ?, ?, ?)
        """,
        (analysis_id, user["id"], user["name"].strip() or "Врач", data.text.strip()),
    )
    note = db.execute(
        "SELECT id, doctor_name, text, created_at FROM doctor_notes WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    db.commit()  # см. комментарий в routers/auth.py register
    return dict(note)
