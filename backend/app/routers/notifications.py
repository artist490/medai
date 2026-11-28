"""Уведомления пациенту (Б1): derived-запрос, без новой таблицы.

Считаются на лету из того, что уже есть в БД:
- новая заметка врача (created_at позже прошлого просмотра колокольчика);
- завершённый приём с заключением (updated_at позже прошлого просмотра);
- плановый приём завтра — напоминалка, живёт до даты приёма.

Прочитанность — одна колонка users.notifications_seen_at: открыл список —
увидел. Врачу колокольчик показывает непрочитанные сигналы (red без
doctor_seen_at), как в /api/doctor/signals — у врача своя механика закрытия.
"""
import json
import sqlite3
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..services.audit import record

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _seen(user: sqlite3.Row) -> str | None:
    """Момент прошлого просмотра колокольчика; None → ещё не открывал."""
    try:
        return user["notifications_seen_at"]
    except (IndexError, KeyError):
        return None


def _baseline(seen: str | None) -> str:
    # Никогда не открывал колокольчик — всё, что уже есть, считается новым:
    # пациент должен увидеть заметки, накопившиеся до первого входа.
    return seen or "1970-01-01 00:00:00"


def _patient_items(db: sqlite3.Connection, user: sqlite3.Row) -> tuple[list[dict], int]:
    """(окно 10 последних, полный счёт непрочитанных)."""
    baseline = _baseline(_seen(user))
    items: list[dict] = []

    notes = db.execute(
        """SELECT n.id, n.text, n.doctor_name, n.created_at, a.risk_level
           FROM doctor_notes n
           JOIN analyses a ON a.id = n.analysis_id
           WHERE a.user_id = ? AND n.created_at > ?
           ORDER BY n.created_at DESC, n.id DESC LIMIT 50""",
        (user["id"], baseline),
    ).fetchall()
    for n in notes:
        items.append({
            "id": f"note-{n['id']}",
            "type": "note",
            "text": f"Комментарий врача: {n['text']}",
            "created_at": n["created_at"],
            "target": "/medcard?tab=meas",
        })

    visits = db.execute(
        """SELECT id, reason, conclusion, updated_at FROM visits
           WHERE patient_id = ? AND status = 'completed' AND conclusion <> ''
             AND updated_at IS NOT NULL AND updated_at > ?
           ORDER BY updated_at DESC, id DESC LIMIT 10""",
        (user["id"], baseline),
    ).fetchall()
    for v in visits:
        lead = f"Приём завершён: {v['conclusion']}"
        if v["reason"]:
            lead = f"Приём «{v['reason']}» завершён: {v['conclusion']}"
        items.append({
            "id": f"visit-done-{v['id']}",
            "type": "visit_done",
            "text": lead[:300],
            "created_at": v["updated_at"],
            "target": "/medcard",
        })

    # Плановый приём завтра: напоминание — пока не наступила дата приёма
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    planned = db.execute(
        """SELECT id, reason, complaints FROM visits
           WHERE patient_id = ? AND status = 'planned' AND visit_date = ?
           ORDER BY id DESC LIMIT 3""",
        (user["id"], tomorrow),
    ).fetchall()
    for v in planned:
        items.append({
            "id": f"visit-tomorrow-{v['id']}",
            "type": "visit_tomorrow",
            "text": "Завтра приём" + (f": {v['reason']}" if v["reason"] else ""),
            "created_at": f"{tomorrow} 00:00:00",
            "target": "/medcard",
        })

    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    # unread — полный счёт (бейдж не врёт про потолок списка), items — окно 10.
    return items[:10], min(len(items), 99)


def _doctor_items(db: sqlite3.Connection, doctor: sqlite3.Row) -> tuple[list[dict], int]:
    """Непрочитанные сигналы филиала — как в /api/doctor/signals."""
    rows = db.execute(
        """SELECT a.id, m.recorded_at, u.id AS patient_id, u.name AS patient_name, a.findings
           FROM analyses a
           JOIN measurements m ON m.id = a.measurement_id
           JOIN users u ON u.id = m.user_id
           WHERE a.risk_level = 'red' AND a.doctor_seen_at IS NULL
             AND u.role = 'patient' AND u.branch_id IS ?
           ORDER BY m.recorded_at DESC, m.id DESC LIMIT 10""",
        (doctor["branch_id"],),
    ).fetchall()
    items = []
    for r in rows:
        try:
            findings = json.loads(r["findings"])
        except (ValueError, TypeError):
            findings = []
        top = next((f for f in findings if f.get("status") == "alarm"), findings[0] if findings else None)
        summary = (top["label"] + ": " + top["value"]) if top else "Тревога"
        items.append({
            "id": f"signal-{r['id']}",
            "type": "signal",
            "text": f"Тревога у {r['patient_name'] or 'пациента'}: {summary}",
            "created_at": r["recorded_at"],
            "target": f"/patients/{r['patient_id']}",
        })
    return items, len(items)


@router.get("")
def notifications(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Непрочитанные уведомления текущего пользователя: последние 10 + полный счёт."""
    items, unread = _doctor_items(db, user) if user["role"] == "doctor" else _patient_items(db, user)
    return {"unread": unread, "items": items}


@router.post("/seen")
def mark_seen(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Отметить уведомления просмотренными (колокольчик открыт)."""
    db.execute(
        "UPDATE users SET notifications_seen_at = datetime('now', 'localtime') WHERE id = ?",
        (user["id"],),
    )
    record(db, "notifications.seen", user_id=user["id"], entity="user", entity_id=user["id"])
    db.commit()
    return {"ok": True}
