"""Payload-слой: единые сборщики JSON-ответов и SQL-заготовки.

Раньше эти хелперы жили в роутерах и роутеры импортировали их друг у друга
(включая приватный _visit_payload) — см. TECH_DEBT_AUDIT.md F006.
Роутер только маршрутизирует; сбор ответа — здесь.
"""
import json
import sqlite3
from typing import Optional

from . import ocr

# ---------- Общие SQL-заготовки ----------

# Поля пациента, отдаваемые наружу (без password_hash и служебных колонок)
PATIENT_FIELDS = "id, email, name, age, sex, height_cm, role, created_at, phone"

# Джойн имени врача — пациенту приятно видеть, кто принимал
VISIT_SELECT = """
SELECT v.*, du.name AS doctor_name FROM visits v
LEFT JOIN users du ON du.id = v.doctor_id
"""

# Сверху плановые (ближайший визит), затем завершённые, отменённые — в конец
ORDER_SQL = """
ORDER BY CASE status WHEN 'planned' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
         visit_date DESC, id DESC
"""


# ---------- Пациент ----------

def compose_full_name(first_name: str, last_name: str, middle_name: str) -> str:
    """Отображаемое ФИО «Фамилия Имя Отчество»; пустые части пропускаются.

    Единая точка сборки: users.name — кэш этого выражения, пересобирается при
    каждой записи профиля, поэтому все читатели (сайдбар, пул врача, сигналы,
    приёмы) показывают ФИО согласованно. Пустой результат — у аккаунтов,
    созданных до разделения ФИО: показываем прежнее name как есть.
    """
    return " ".join(
        part for part in (last_name.strip(), first_name.strip(), middle_name.strip()) if part
    )


def patient_payload(p: sqlite3.Row) -> dict:
    keys = set(p.keys())
    phone = p["phone"] if "phone" in keys else ""
    return {k: p[k] for k in ("id", "email", "name", "age", "sex", "height_cm", "created_at")} | {
        "phone": phone,
    }


# ---------- Документы ----------

def doc_payload(row: sqlite3.Row) -> dict:
    """Список/карточка документа: метаданные + статус OCR + прозрачность врача.

    Колонки появились миграцией (doctor_viewed_at, lab_values) — guard для
    строк, прочитанных до init_db в тестах, как у period в measurement_payload.
    """
    keys = set(row.keys())
    lab_raw = row["lab_values"] if "lab_values" in keys else None
    lab = None
    if lab_raw:
        try:
            lab = json.loads(lab_raw)
        except (json.JSONDecodeError, TypeError):
            lab = None
    return {k: row[k] for k in ("id", "title", "filename", "mime", "size", "uploaded_at")} | {
        "category": row["category"] if "category" in keys else "",
        "title_source": row["title_source"] if "title_source" in keys else "auto",
        "doctor_viewed_at": row["doctor_viewed_at"] if "doctor_viewed_at" in keys else None,
        "lab_values": lab,
        "ocr": ocr.ocr_payload(row),
    }


# ---------- Измерения и анализы ----------

def _parse_llm_text(raw: Optional[str]) -> tuple[Optional[str], Optional[list]]:
    """В БД llm_text хранится как JSON {"summary": ..., "items": [...]}."""
    if not raw:
        return None, None
    try:
        data = json.loads(raw)
        return data.get("summary"), data.get("items")
    except (json.JSONDecodeError, AttributeError):
        return None, None


def analysis_payload(row: sqlite3.Row, id_key: str = "id", mid_key: str = "measurement_id",
                     created_key: str = "created_at", notes: Optional[list] = None) -> dict:
    """Собирает analysis из строки analyses или из joined-строки списка."""
    llm_summary, llm_items = _parse_llm_text(row["llm_text"])
    payload = {
        "id": row[id_key],
        "measurement_id": row[mid_key],
        "created_at": row[created_key],
        "risk_level": row["risk_level"],
        "source": row["source"],
        "findings": json.loads(row["findings"]),
        "recommendations": json.loads(row["recommendations"]),
        "llm_summary": llm_summary,
        "llm_items": llm_items,
        "bmi": row["bmi"],
        "doctor_seen_at": row["doctor_seen_at"] if "doctor_seen_at" in row.keys() else None,
    }
    if notes is not None:
        payload["notes"] = notes
    return payload


def measurement_payload(m: sqlite3.Row, analysis: Optional[dict]) -> dict:
    fields = ("systolic", "diastolic", "pulse", "temperature", "spo2",
              "sleep_hours", "steps", "water_ml", "weight_kg")
    data = {
        "id": m["id"],
        "recorded_at": m["recorded_at"],
        "period": m["period"] if "period" in m.keys() else None,
        **{k: m[k] for k in fields},
    }
    if analysis is not None:
        data["analysis"] = analysis
    return data


def notes_map(db: sqlite3.Connection, user_id: int) -> dict[int, list[dict]]:
    """Комментарии врачей по всем анализам пользователя: {analysis_id: [note]}."""
    rows = db.execute(
        """
        SELECT n.id, n.analysis_id, n.doctor_name, n.text, n.created_at
        FROM doctor_notes n
        JOIN analyses a ON a.id = n.analysis_id
        WHERE a.user_id = ?
        ORDER BY n.id
        """,
        (user_id,),
    ).fetchall()
    grouped: dict[int, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["analysis_id"], []).append(
            {k: r[k] for k in ("id", "doctor_name", "text", "created_at")}
        )
    return grouped


def notes_for(db: sqlite3.Connection, analysis_id: int) -> list[dict]:
    """Комментарии врачей к одному разбору (карточка врача)."""
    rows = db.execute(
        """
        SELECT id, doctor_name, text, created_at FROM doctor_notes
        WHERE analysis_id = ? ORDER BY id
        """,
        (analysis_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------- Приёмы ----------

def visit_payload(row: sqlite3.Row) -> dict:
    return dict(row)
