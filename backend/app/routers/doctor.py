"""Роутер врача: общий пул пациентов клиники, детали и комментарии к анализам."""
import json
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import NoteIn, VisitCloseIn
from ..services import llm as llm_service
from .measurements import analysis_payload, measurement_payload
from .visits import ORDER_SQL, VISIT_SELECT, _visit_payload

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


# Тревожные ответы опросника МЗ (синхронно с ALARM_KEYS в AnamnesisSurvey.tsx)
ALARM_SURVEY_KEYS = frozenset({
    "sym_chest_pain", "sym_sudden_weakness", "sym_sudden_numbness", "sym_vision_loss",
    "sym_hemoptysis", "sym_black_stool", "sym_blood_in_stool", "sym_weight_loss",
})


def _survey_alarm_count(survey_raw: str | None) -> int:
    """Сколько тревожных пунктов опросника отметил пациент."""
    if not survey_raw:
        return 0
    try:
        data = json.loads(survey_raw)
    except (json.JSONDecodeError, TypeError):
        return 0
    return sum(1 for key in ALARM_SURVEY_KEYS if data.get(key) is True)


@router.get("/patients")
def list_patients(
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Пациенты филиала врача: последний риск, счётчики за 100 замеров, флаг внимания."""
    patients = db.execute(
        f"SELECT {PATIENT_FIELDS} FROM users WHERE role = 'patient' AND branch_id IS ? ORDER BY id",
        (user["branch_id"],),
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

        # Сигналы вне замеров: тревожные ответы опросника МЗ и плановые приёмы
        card = db.execute(
            "SELECT survey FROM patient_cards WHERE user_id = ?", (p["id"],)
        ).fetchone()
        survey_alarms = _survey_alarm_count(card["survey"] if card else None)
        planned_visits = db.execute(
            "SELECT COUNT(*) FROM visits WHERE patient_id = ? AND status = 'planned'",
            (p["id"],),
        ).fetchone()[0]

        items.append({
            **_patient_payload(p),
            "last_measurement_at": last_at,
            "last_risk": last_risk,
            "survey_alarms": survey_alarms,
            "planned_visits": planned_visits,
            "requires_attention": last_risk == "red" or survey_alarms > 0,  # urgent всегда даёт red
            "counts": counts,
            "total": len(rows),
        })

    # Непрочитанные сигналы: красные разборы без doctor_seen_at
    unread_by_patient = {
        row["pid"]: row["c"]
        for row in db.execute(
            """SELECT u.id AS pid, COUNT(*) AS c FROM analyses a
               JOIN measurements m ON m.id = a.measurement_id
               JOIN users u ON u.id = m.user_id
               WHERE a.risk_level = 'red' AND a.doctor_seen_at IS NULL
                 AND u.role = 'patient' AND u.branch_id IS ?
               GROUP BY u.id""",
            (user["branch_id"],),
        ).fetchall()
    }
    for item in items:
        item["unread_signals"] = unread_by_patient.get(item["id"], 0)

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
        f"SELECT {PATIENT_FIELDS} FROM users WHERE id = ? AND role = 'patient' AND branch_id IS ?",
        (patient_id, user["branch_id"]),
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


@router.post("/analyses/{analysis_id}/seen", status_code=200)
def mark_analysis_seen(
    analysis_id: int,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Врач отметил разбор тревожного замера разобранным (сигнал закрыт)."""
    analysis = db.execute(
        """SELECT a.id FROM analyses a
           JOIN measurements m ON m.id = a.measurement_id
           JOIN users u ON u.id = m.user_id
           WHERE a.id = ? AND u.role = 'patient' AND u.branch_id IS ?""",
        (analysis_id, user["branch_id"]),
    ).fetchone()
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Анализ не найден")
    db.execute(
        "UPDATE analyses SET doctor_seen_at = datetime('now', 'localtime') WHERE id = ? AND doctor_seen_at IS NULL",
        (analysis_id,),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    return {"ok": True}


@router.get("/signals")
def unread_signals(
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Непрочитанные красные флаги филиала: разборы без doctor_seen_at."""
    rows = db.execute(
        """SELECT a.id AS analysis_id, u.id AS patient_id, u.name AS patient_name,
                  m.recorded_at, a.findings
           FROM analyses a
           JOIN measurements m ON m.id = a.measurement_id
           JOIN users u ON u.id = m.user_id
           WHERE a.risk_level = 'red' AND a.doctor_seen_at IS NULL
             AND u.role = 'patient' AND u.branch_id IS ?
           ORDER BY m.recorded_at DESC, m.id DESC""",
        (user["branch_id"],),
    ).fetchall()
    items = []
    import json as _json
    for r in rows:
        findings = _json.loads(r["findings"])
        top = next((f for f in findings if f["status"] == "alarm"), findings[0] if findings else None)
        items.append({
            "analysis_id": r["analysis_id"],
            "patient_id": r["patient_id"],
            "patient_name": r["patient_name"],
            "recorded_at": r["recorded_at"],
            "summary": (top["label"] + ": " + top["value"]) if top else "Тревога",
        })
    return {"unread": len(items), "items": items}


@router.post("/analyses/{analysis_id}/notes", status_code=201)
def add_note(
    analysis_id: int,
    data: NoteIn,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    # Гвард филиала: комментировать можно только анализ пациента своего филиала
    analysis = db.execute(
        """
        SELECT a.id FROM analyses a
        JOIN measurements m ON m.id = a.measurement_id
        JOIN users u ON u.id = m.user_id
        WHERE a.id = ? AND u.role = 'patient' AND u.branch_id IS ?
        """,
        (analysis_id, user["branch_id"]),
    ).fetchone()
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Анализ не найден")

    cursor = db.execute(
        """
        INSERT INTO doctor_notes (analysis_id, doctor_id, doctor_name, text)
        VALUES (?, ?, ?, ?)
        """,
        (analysis_id, user["id"], user["name"].strip() or "Врач", data.text.strip()),
    )
    # комментарий врача закрывает сигнал тревоги по этому разбору
    db.execute(
        "UPDATE analyses SET doctor_seen_at = datetime('now', 'localtime') WHERE id = ? AND doctor_seen_at IS NULL",
        (analysis_id,),
    )
    note = db.execute(
        "SELECT id, doctor_name, text, created_at FROM doctor_notes WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    db.commit()  # см. комментарий в routers/auth.py register
    return dict(note)


# ---------- Приёмы ----------

def _branch_patient(db: sqlite3.Connection, patient_id: int, doctor: sqlite3.Row) -> sqlite3.Row:
    """Пациент филиала врача — единый гвард для карточки/приёмов/сводки."""
    patient = db.execute(
        f"SELECT {PATIENT_FIELDS} FROM users WHERE id = ? AND role = 'patient' AND branch_id IS ?",
        (patient_id, doctor["branch_id"]),
    ).fetchone()
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")
    return patient


@router.get("/patients/{patient_id}/visits")
def patient_visits(
    patient_id: int,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Приёмы пациента: плановые сверху, затем история."""
    _branch_patient(db, patient_id, user)
    rows = db.execute(
        f"{VISIT_SELECT} WHERE v.patient_id = ? {ORDER_SQL}",
        (patient_id,),
    ).fetchall()
    return {"items": [_visit_payload(r) for r in rows]}


@router.put("/visits/{visit_id}")
def complete_visit(
    visit_id: int,
    data: VisitCloseIn,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """Врач принимает пациента: заключение + рекомендации, приём завершён."""
    visit = db.execute(
        """
        SELECT v.id FROM visits v
        JOIN users u ON u.id = v.patient_id
        WHERE v.id = ? AND u.role = 'patient' AND u.branch_id IS ?
        """,
        (visit_id, user["branch_id"]),
    ).fetchone()
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приём не найден")
    if db.execute("SELECT status FROM visits WHERE id = ?", (visit_id,)).fetchone()["status"] != "planned":
        raise HTTPException(status.HTTP_409_CONFLICT, "Приём уже обработан")

    db.execute(
        """
        UPDATE visits SET status = 'completed', doctor_id = ?, conclusion = ?,
                          recommendations = ?, updated_at = ?
        WHERE id = ?
        """,
        (user["id"], data.conclusion.strip(), data.recommendations.strip(),
         datetime.now().strftime("%Y-%m-%d %H:%M:%S"), visit_id),
    )
    db.commit()
    row = db.execute(f"{VISIT_SELECT} WHERE v.id = ?", (visit_id,)).fetchone()
    return _visit_payload(row)


# ---------- ИИ-сводка пациента ----------

CARD_LABELS = (
    ("blood_type", "Группа крови"),
    ("allergies", "Аллергии"),
    ("chronic", "Хронические заболевания"),
    ("medications", "Постоянные лекарства"),
    ("surgeries", "Операции, госпитализации"),
    ("smoking", "Курение"),
    ("alcohol", "Алкоголь"),
    ("activity", "Физическая активность"),
)

# Расшифровка ответов опросника Минздрава (приказ 404н) для ИИ-сводки
SURVEY_LABELS: dict[str, str] = {
    "dx_hypertension": "гипертоническая болезнь",
    "dx_hypertension_rx": "принимает препараты от давления",
    "dx_chd": "ишемическая болезнь сердца (стенокардия)",
    "dx_cvd": "заболевание сосудов головного мозга",
    "dx_lung": "хроническое заболевание бронхов или лёгких",
    "dx_tb": "туберкулёз",
    "dx_diabetes": "сахарный диабет или повышенный сахар",
    "dx_diabetes_rx": "принимает препараты для снижения сахара",
    "dx_stomach": "заболевание желудка (гастрит, язва)",
    "dx_kidney": "хроническое заболевание почек",
    "dx_cancer": "злокачественное новообразование",
    "dx_cholesterol": "повышенный холестерин",
    "dx_cholesterol_rx": "принимает препараты от холестерина",
    "hx_mi_self": "был инфаркт миокарда",
    "hx_stroke_self": "был инсульт",
    "hx_mi_stroke_family": "инфаркт/инсульт у близких родственников в молодом возрасте",
    "hx_cancer_family": "злокачественные новообразования у близких родственников",
    "sym_chest_pain": "жжение/давление за грудиной при нагрузке или на холоде",
    "sym_chest_pain_relieves": "грудные боли проходят в покое или от нитроглицерина",
    "sym_sudden_weakness": "внезапная слабость в руке/ноге (маркер ТИА)",
    "sym_sudden_numbness": "внезапное онемение половины лица или конечности",
    "sym_vision_loss": "внезапная потеря зрения на один глаз",
    "sym_chronic_cough": "кашель с мокротой ~3 месяца в году",
    "sym_wheezing": "свистящие хрипы в груди",
    "sym_hemoptysis": "кровохарканье",
    "sym_epigastric": "боли в верхней части живота, отрыжка, тошнота",
    "sym_black_stool": "чёрный дегтеобразный стул (маркер кровотечения)",
    "sym_weight_loss": "похудение без видимых причин",
    "sym_rectal_pain": "боль в заднепроходном отверстии",
    "sym_blood_in_stool": "кровь в стуле",
    "smoking_now": "курит",
    "walking_30min": "ходит пешком ≥30 минут в день",
    "vegetables_daily": "есть 400–500 г овощей и фруктов ежедневно",
    "salting": "подсаливает пищу не пробуя",
    "drugs_last_year": "принимал психотропные/наркотические вещества без назначения",
}


def _survey_lines(survey_raw: str | None) -> list[str]:
    """Тревожные и значимые ответы опросника одной строкой на пункт."""
    if not survey_raw:
        return []
    try:
        data = json.loads(survey_raw)
    except (json.JSONDecodeError, TypeError):
        return []
    lines: list[str] = []
    for key, label in SURVEY_LABELS.items():
        if data.get(key) is True:
            lines.append(f"- {label}")
    cigarettes = data.get("cigarettes_per_day")
    if cigarettes:
        lines.append(f"- {SURVEY_LABELS['smoking_now']}: {cigarettes} сиг/день")
    audit = sum(data.get(k, 0) or 0 for k in ("alcohol_freq", "alcohol_portions", "alcohol_binge"))
    if audit > 0:
        lines.append(f"- баллы AUDIT-C (алкоголь): {audit}" + (" — риск пагубного потребления" if audit >= 6 else ""))
    other = str(data.get("other_complaints") or "").strip()
    if other:
        lines.append(f"- другие жалобы: {other}")
    return lines


def _build_summary_payload(db: sqlite3.Connection, patient: sqlite3.Row) -> str:
    """Собирает данные пациента в текст для ИИ-сводки."""
    sex = {"male": "мужской", "female": "женский"}.get(patient["sex"], "не указан")
    lines = [
        "Пациент:",
        f"- имя: {patient['name'] or 'не указано'}; возраст: {patient['age'] or 'не указан'}; пол: {sex}",
    ]
    if patient["height_cm"]:
        lines.append(f"- рост: {patient['height_cm']} см")

    card = db.execute(
        "SELECT * FROM patient_cards WHERE user_id = ?", (patient["id"],)
    ).fetchone()
    lines.append("\nАнамнез (медкарта):")
    card_lines = [
        f"- {label}: {card[key]}" for key, label in CARD_LABELS
        if card is not None and card[key]
    ]
    lines.extend(card_lines or ["- не заполнен"])

    if card is not None:
        survey_lines = _survey_lines(card["survey"] if "survey" in card.keys() else None)
        if survey_lines:
            lines.append("\nОпросник Минздрава (анкета скрининга), значимые ответы:")
            lines.extend(survey_lines)

    measurements = db.execute(
        """
        SELECT m.recorded_at, m.systolic, m.diastolic, m.pulse, m.temperature, m.spo2,
               m.weight_kg, a.risk_level
        FROM measurements m LEFT JOIN analyses a ON a.measurement_id = m.id
        WHERE m.user_id = ? ORDER BY m.recorded_at DESC, m.id DESC LIMIT 10
        """,
        (patient["id"],),
    ).fetchall()
    lines.append("\nПоследние замеры (новые сверху):")
    risk_ru = {"green": "норма", "yellow": "внимание", "red": "ТРЕВОГА"}
    m_lines = []
    for m in measurements:
        parts = []
        if m["systolic"] and m["diastolic"]:
            parts.append(f"давление {m['systolic']:g}/{m['diastolic']:g}")
        if m["pulse"]:
            parts.append(f"пульс {m['pulse']:g}")
        if m["temperature"]:
            parts.append(f"температура {m['temperature']:g}")
        if m["spo2"]:
            parts.append(f"SpO2 {m['spo2']:g}%")
        if m["weight_kg"]:
            parts.append(f"вес {m['weight_kg']:g} кг")
        risk = risk_ru.get(m["risk_level"], "без разбора")
        m_lines.append(f"- {m['recorded_at']}: {', '.join(parts) or 'без показателей'} [{risk}]")
    lines.extend(m_lines or ["- замеров нет"])

    visits = db.execute(
        """
        SELECT visit_date, reason, complaints, status, conclusion, created_at
        FROM visits WHERE patient_id = ? ORDER BY id DESC LIMIT 5
        """,
        (patient["id"],),
    ).fetchall()
    lines.append("\nПриёмы:")
    v_lines = []
    for v in visits:
        status_ru = {"planned": "запланирован", "completed": "завершён", "cancelled": "отменён"}[v["status"]]
        entry = f"- {v['created_at']} ({status_ru}): {v['reason'] or 'цель не указана'}"
        if v["complaints"]:
            entry += f"; жалобы: {v['complaints']}"
        if v["conclusion"]:
            entry += f"; заключение врача: {v['conclusion']}"
        v_lines.append(entry)
    lines.extend(v_lines or ["- приёмов нет"])

    lines.append(
        "\nНапиши справку для врача перед приёмом: краткая характеристика пациента, "
        "анамнез, жалобы, динамика показателей и на что обратить внимание. "
        "Диагнозы не ставь."
    )
    return "\n".join(lines)


@router.post("/patients/{patient_id}/summary")
def ai_summary(
    patient_id: int,
    user: sqlite3.Row = Depends(auth.get_current_doctor),
    db: sqlite3.Connection = Depends(get_db),
):
    """ИИ-сводка о пациенте к приёму (LLM, без изменения данных)."""
    patient = _branch_patient(db, patient_id, user)
    payload = _build_summary_payload(db, patient)
    summary = llm_service.patient_summary(payload)
    if summary is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ИИ-сводка сейчас недоступна")
    return {"summary": summary}
