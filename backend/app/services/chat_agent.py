"""Агентный чат: DeepSeek (PlusVibe, function calling) над данными пользователя.

Инструменты выполняются локально над SQLite и отдают только данные
текущего пациента (или пациентов филиала у врача). Модель не может
ставить диагнозы — системный промпт + честный fallback без ключа.
"""
import json
import logging
import sqlite3
from typing import Callable, Optional

from .. import config
from . import llm as llm_service

logger = logging.getLogger("medai.chat")

MAX_TOOL_ROUNDS = 6
HISTORY_LIMIT = 12  # сколько последних сообщений подаём модели

PROMPT_RULES = """
ЖЁСТКИЕ ПРАВИЛА:
1. НЕ ставь диагнозы и НЕ назначай лекарства, процедуры и дозировки.
2. Тревожные значения (alarm) — обязательно советуй обратиться к врачу,
   критические — вызывать 103. Не приуменьшай плохие показатели.
3. Опирайся ТОЛЬКО на данные из инструментов: если данных нет или инструмент
   ничего не вернул — так и скажи. Никогда не выдумывай цифры и даты.
4. Пиши по-русски, тепло и по делу: 2–6 предложений, списки — где уместно.
5. Ссылайся на конкретные значения и даты из замеров."""

SYSTEM_PROMPT_PATIENT = """Ты — ассистент здоровья федеральной сети клиник «Спектр-Диагностика».
Общаешься с пациентом и можешь смотреть его данные через инструменты (замеры,
разборы, статистика). Помогаешь понять показатели и здоровый образ жизни.
""" + PROMPT_RULES

SYSTEM_PROMPT_DOCTOR = """Ты — ассистент врача сети клиник «Спектр-Диагностика».
Помогаешь врачу быстро смотреть данные пациентов его филиала через инструменты.
""" + PROMPT_RULES

# ---------- Определения инструментов (OpenAI function calling) ----------

PATIENT_TOOLS = [
    {"type": "function", "function": {
        "name": "get_profile",
        "description": "Профиль пациента: имя, возраст, пол, рост, филиал",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_recent_measurements",
        "description": "Последние замеры пациента: давление, пульс, температура, SpO2, вес, сон, шаги, вода",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "Сколько последних замеров, 1–30", "default": 10},
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_last_analysis",
        "description": "Последний разбор замера: риск (green/yellow/red), статусы показателей, рекомендации правил",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_stats_summary",
        "description": "Средние показатели пациента за последние N дней",
        "parameters": {"type": "object", "properties": {
            "days": {"type": "integer", "description": "Период в днях, 1–365", "default": 30},
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_risk_history",
        "description": "История оценок риска по замерам (green/yellow/red) с датами",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "Сколько записей, 1–50", "default": 20},
        }, "required": []},
    }},
]

DOCTOR_TOOLS = [
    {"type": "function", "function": {
        "name": "get_patients_overview",
        "description": "Пациенты филиала врача: имя, возраст, последний замер, последний риск, требует ли внимания",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_patient_measurements",
        "description": "Замеры конкретного пациента филиала",
        "parameters": {"type": "object", "properties": {
            "patient_id": {"type": "integer", "description": "ID пациента из get_patients_overview"},
            "limit": {"type": "integer", "description": "Сколько последних замеров, 1–30", "default": 10},
        }, "required": ["patient_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_patient_last_analysis",
        "description": "Последний разбор замера пациента: риск, статусы показателей, рекомендации правил",
        "parameters": {"type": "object", "properties": {
            "patient_id": {"type": "integer", "description": "ID пациента из get_patients_overview"},
        }, "required": ["patient_id"]},
    }},
]

# ---------- Исполнение инструментов (только данные текущего пользователя) ----------

def _rows_to_json(rows: list[sqlite3.Row]) -> str:
    return json.dumps([dict(r) for r in rows], ensure_ascii=False, default=str)


def _get_profile(db: sqlite3.Connection, user: sqlite3.Row, _: dict) -> str:
    row = db.execute(
        """SELECT u.name, u.age, u.sex, u.height_cm, b.city AS branch_city
           FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?""",
        (user["id"],),
    ).fetchone()
    return json.dumps(dict(row), ensure_ascii=False)


def _recent_measurements(db: sqlite3.Connection, user_id: int, args: dict) -> str:
    limit = max(1, min(30, int(args.get("limit") or 10)))
    rows = db.execute(
        """SELECT recorded_at, systolic, diastolic, pulse, temperature, spo2,
                  sleep_hours, steps, water_ml, weight_kg
           FROM measurements WHERE user_id = ?
           ORDER BY recorded_at DESC, id DESC LIMIT ?""",
        (user_id, limit),
    ).fetchall()
    return _rows_to_json(rows)


def _last_analysis(db: sqlite3.Connection, user_id: int, _: dict) -> str:
    row = db.execute(
        """SELECT a.risk_level, a.findings, a.recommendations, a.created_at
           FROM analyses a JOIN measurements m ON m.id = a.measurement_id
           WHERE a.user_id = ? ORDER BY m.recorded_at DESC, m.id DESC LIMIT 1""",
        (user_id,),
    ).fetchone()
    if row is None:
        return json.dumps({"error": "анализов пока нет"}, ensure_ascii=False)
    d = dict(row)
    d["findings"] = json.loads(d["findings"])
    d["recommendations"] = json.loads(d["recommendations"])
    return json.dumps(d, ensure_ascii=False)


def _stats_summary(db: sqlite3.Connection, user_id: int, args: dict) -> str:
    days = max(1, min(365, int(args.get("days") or 30)))
    row = db.execute(
        """SELECT COUNT(*) AS measurements,
                  ROUND(AVG(systolic), 1) AS avg_systolic,
                  ROUND(AVG(diastolic), 1) AS avg_diastolic,
                  ROUND(AVG(pulse), 1) AS avg_pulse,
                  ROUND(AVG(temperature), 1) AS avg_temperature,
                  ROUND(AVG(spo2), 1) AS avg_spo2,
                  ROUND(AVG(sleep_hours), 1) AS avg_sleep_hours,
                  ROUND(AVG(steps)) AS avg_steps,
                  ROUND(AVG(water_ml)) AS avg_water_ml,
                  ROUND(AVG(weight_kg), 1) AS avg_weight_kg
           FROM measurements
           WHERE user_id = ? AND date(recorded_at) >= date('now', ?)""",
        (user_id, f"-{days} days"),
    ).fetchone()
    return json.dumps({"period_days": days, **dict(row)}, ensure_ascii=False)


def _risk_history(db: sqlite3.Connection, user_id: int, args: dict) -> str:
    limit = max(1, min(50, int(args.get("limit") or 20)))
    rows = db.execute(
        """SELECT m.recorded_at, a.risk_level
           FROM measurements m LEFT JOIN analyses a ON a.measurement_id = m.id
           WHERE m.user_id = ? ORDER BY m.recorded_at DESC, m.id DESC LIMIT ?""",
        (user_id, limit),
    ).fetchall()
    return _rows_to_json(rows)


def _doctor_guard(db: sqlite3.Connection, doctor: sqlite3.Row, patient_id: int) -> Optional[sqlite3.Row]:
    """Пациент должен быть из филиала врача."""
    return db.execute(
        """SELECT id, name FROM users
           WHERE id = ? AND role = 'patient' AND branch_id IS ?""",
        (patient_id, doctor["branch_id"]),
    ).fetchone()


PATIENT_EXECUTORS: dict[str, Callable] = {
    "get_profile": lambda db, user, args: _get_profile(db, user, args),
    "get_recent_measurements": lambda db, user, args: _recent_measurements(db, user["id"], args),
    "get_last_analysis": lambda db, user, args: _last_analysis(db, user["id"], args),
    "get_stats_summary": lambda db, user, args: _stats_summary(db, user["id"], args),
    "get_risk_history": lambda db, user, args: _risk_history(db, user["id"], args),
}


def _exec_patients_overview(db: sqlite3.Connection, doctor: sqlite3.Row, _: dict) -> str:
    rows = db.execute(
        """SELECT u.id, u.name, u.age,
                  MAX(m.recorded_at) AS last_measurement_at,
                  (SELECT a.risk_level FROM analyses a
                   JOIN measurements m2 ON m2.id = a.measurement_id
                   WHERE m2.user_id = u.id
                   ORDER BY m2.recorded_at DESC, m2.id DESC LIMIT 1) AS last_risk
           FROM users u
           LEFT JOIN measurements m ON m.user_id = u.id
           WHERE u.role = 'patient' AND u.branch_id IS ?
           GROUP BY u.id ORDER BY u.id""",
        (doctor["branch_id"],),
    ).fetchall()
    return _rows_to_json(rows)


def _exec_patient_measurements(db: sqlite3.Connection, doctor: sqlite3.Row, args: dict) -> str:
    patient = _doctor_guard(db, doctor, int(args.get("patient_id") or 0))
    if patient is None:
        return json.dumps({"error": "пациент не найден в вашем филиале"}, ensure_ascii=False)
    return _recent_measurements(db, patient["id"], args)


def _exec_patient_last_analysis(db: sqlite3.Connection, doctor: sqlite3.Row, args: dict) -> str:
    patient = _doctor_guard(db, doctor, int(args.get("patient_id") or 0))
    if patient is None:
        return json.dumps({"error": "пациент не найден в вашем филиале"}, ensure_ascii=False)
    return _last_analysis(db, patient["id"], args)


DOCTOR_EXECUTORS: dict[str, Callable] = {
    "get_patients_overview": _exec_patients_overview,
    "get_patient_measurements": _exec_patient_measurements,
    "get_patient_last_analysis": _exec_patient_last_analysis,
}

# ---------- Агентный цикл ----------

def run(db: sqlite3.Connection, user: sqlite3.Row,
        history: list[dict]) -> Optional[tuple[str, list[str]]]:
    """Прогоняет агентный цикл. Возвращает (ответ, использованные инструменты)
    или None, если LLM недоступен."""
    is_doctor = user["role"] == "doctor"
    tools = DOCTOR_TOOLS if is_doctor else PATIENT_TOOLS
    executors = DOCTOR_EXECUTORS if is_doctor else PATIENT_EXECUTORS
    system = SYSTEM_PROMPT_DOCTOR if is_doctor else SYSTEM_PROMPT_PATIENT

    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(history[-HISTORY_LIMIT:])

    tools_used: list[str] = []
    for _ in range(MAX_TOOL_ROUNDS):
        message = llm_service.chat_completion({
            "model": config.CHAT_MODEL,
            "messages": messages,
            "tools": tools,
            "temperature": 0.5,
            "max_tokens": 800,
        })
        if message is None:
            return None

        tool_calls = message.get("tool_calls")
        if not tool_calls:
            content = str(message.get("content") or "").strip()
            return (content, tools_used) if content else None

        messages.append({"role": "assistant", "content": message.get("content") or "",
                         "tool_calls": tool_calls})
        for call in tool_calls:
            fn = call.get("function", {})
            name = str(fn.get("name") or "")
            executor = executors.get(name)
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if executor is None:
                result = {"error": "неизвестный инструмент"}
            else:
                try:
                    result = executor(db, user, args)
                except Exception as exc:  # инструмент не должен ронять чат
                    logger.warning("Инструмент %s упал: %s", name, exc)
                    result = {"error": "не удалось получить данные"}
            tools_used.append(name)
            messages.append({
                "role": "tool",
                "tool_call_id": call.get("id") or "",
                "content": result if isinstance(result, str) else json.dumps(result, ensure_ascii=False),
            })

    # Модель зациклилась на инструментах — просим ответить без них
    messages.append({"role": "user",
                     "content": "Достаточно данных — ответь на вопрос пользователя кратко, без вызовов инструментов."})
    message = llm_service.chat_completion({
        "model": config.CHAT_MODEL, "messages": messages,
        "temperature": 0.5, "max_tokens": 800,
    })
    if message and message.get("content"):
        return str(message["content"]).strip(), tools_used
    return None
