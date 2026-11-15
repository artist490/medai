"""Аналитика филиала для врача/руководителя: пациенты, замеры, риски."""
import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from .. import auth
from ..database import get_db

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
    risky = sum(1 for p in patients if p["last_risk"] == "red")
    warning = sum(1 for p in patients if p["last_risk"] == "yellow")
    stale = sum(1 for p in patients
                if p["last_at"] is None
                or date.fromisoformat(p["last_at"][:10]) <= date.today() - timedelta(days=14))

    # Замеры за 14 дней по дням (активность филиала)
    days = [(date.today() - timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    series = []
    for d in days:
        n = db.execute(
            """SELECT COUNT(*) AS c FROM measurements m
               JOIN users u ON u.id = m.user_id
               WHERE u.role = 'patient' AND u.branch_id IS ?
                 AND date(m.recorded_at) = ?""",
            (branch_id, d),
        ).fetchone()["c"]
        series.append({"day": d[5:], "count": n})

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
        "requires_attention": risky,
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
