"""Аналитика филиала для врача/руководителя: пациенты, замеры, риски."""
import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from .. import auth
from ..database import get_db
from ..services import signals

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
def branch_analytics(
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    branch_id = user["branch_id"]
    patients = db.execute(
        """SELECT u.id, u.name,
                  (SELECT MAX(m.recorded_at) FROM measurements m WHERE m.user_id = u.id) AS last_at,
                  (SELECT a.risk_level FROM analyses a
                   JOIN measurements m2 ON m2.id = a.measurement_id
                   WHERE m2.user_id = u.id
                   ORDER BY m2.recorded_at DESC, m2.id DESC LIMIT 1) AS last_risk
           FROM users u WHERE u.role = 'patient' AND u.branch_id IS ?
           ORDER BY u.id""",
        (branch_id,),
    ).fetchall()

    total = len(patients)
    warning = sum(1 for p in patients if p["last_risk"] == "yellow")
    stale = sum(1 for p in patients
                if p["last_at"] is None
                or date.fromisoformat(p["last_at"][:10]) <= date.today() - timedelta(days=14))

    # Замеры за 14 дней одним GROUP BY вместо 14 COUNT-запросов (F005)
    counts = {
        row["d"]: row["c"]
        for row in db.execute(
            """SELECT date(m.recorded_at) AS d, COUNT(*) AS c
               FROM measurements m
               JOIN users u ON u.id = m.user_id
               WHERE u.role = 'patient' AND u.branch_id IS ?
                 AND date(m.recorded_at) >= date('now', '-13 days')
               GROUP BY d""",
            (branch_id,),
        ).fetchall()
    }
    days = [(date.today() - timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    series = [{"day": d[5:], "count": counts.get(d, 0)} for d in days]

    # Тревожные опросники — тот же сигнал, что и в кабинете врача (F013):
    # requires_attention = красный замер ИЛИ тревожные ответы опросника МЗ
    surveys = {
        row["user_id"]: row["survey"]
        for row in db.execute(
            """SELECT pc.user_id, pc.survey FROM patient_cards pc
               JOIN users u ON u.id = pc.user_id
               WHERE u.role = 'patient' AND u.branch_id IS ?""",
            (branch_id,),
        ).fetchall()
    }
    attention_ids = {
        p["id"] for p in patients
        if p["last_risk"] == "red" or signals.survey_alarm_count(surveys.get(p["id"])) > 0
    }

    risks = {"green": 0, "yellow": 0, "red": 0}
    for p in patients:
        if p["last_risk"] in risks:
            risks[p["last_risk"]] += 1

    branch_city = db.execute(
        "SELECT city FROM branches WHERE id IS ?", (branch_id,)
    ).fetchone()

    return {
        "branch_city": branch_city["city"] if branch_city else None,
        "patients_total": total,
        "requires_attention": len(attention_ids),
        "risk_split": risks,
        "warning_split": warning,
        "stale_patients": stale,
        "measurements_14d": series,
        "patients": [
            {"id": p["id"], "name": p["name"], "last_at": p["last_at"],
             "last_risk": p["last_risk"]}
            for p in patients
        ],
    }
