"""Оркестратор анализа: правила → риск → LLM-обогащение → готовый результат."""
import sqlite3
from typing import Optional

from . import rules
from . import llm as llm_service

INDICATOR_FIELDS = (
    "systolic", "diastolic", "pulse", "temperature", "spo2",
    "sleep_hours", "steps", "water_ml", "weight_kg",
)


def run_analysis(measurement: sqlite3.Row, user: sqlite3.Row) -> dict:
    """Полный анализ измерения. Возвращает словарь для сохранения в analyses."""
    indicators = {k: measurement[k] for k in INDICATOR_FIELDS if measurement[k] is not None}

    rule_result = rules.analyze(indicators, height_cm=user["height_cm"]).to_dict()

    profile = {
        "имя": user["name"],
        "возраст": user["age"],
        "пол": "мужской" if user["sex"] == "male" else "женский" if user["sex"] == "female" else None,
        "рост_см": user["height_cm"],
    }

    llm_output = llm_service.enrich(profile, indicators, rule_result)

    return {
        "risk_level": rule_result["risk_level"],   # LLM не меняет риск!
        "findings": rule_result["findings"],
        "recommendations": rule_result["recommendations"],
        "urgent": rule_result["urgent"],
        "bmi": rule_result["bmi"],
        "llm_summary": llm_output["summary"] if llm_output else None,
        "llm_items": llm_output["items"] if llm_output else None,
        "source": "rules+llm" if llm_output else "rules",
    }
