"""Сигналы тревоги: единый источник «какие ответы опросника МЗ тревожные».

Раньше ключи дублировались в doctor.py и использовались в аналитике —
рассинхрон означал тихую потерю сигналов (см. TECH_DEBT_AUDIT.md F007/F013).
Фронтенд (AnamnesisSurvey.tsx) пока держит свой ALARM_KEYS — при правке
опросника менять ОБА места, пока ключи не отдаются API-эндпоинтом.
"""
import json


# Тревожные ответы опросника МЗ (синхронно с ALARM_KEYS в AnamnesisSurvey.tsx)
ALARM_SURVEY_KEYS = frozenset({
    "sym_chest_pain", "sym_sudden_weakness", "sym_sudden_numbness", "sym_vision_loss",
    "sym_hemoptysis", "sym_black_stool", "sym_blood_in_stool", "sym_weight_loss",
})


def survey_alarm_count(survey_raw: str | None) -> int:
    """Сколько тревожных пунктов опросника отметил пациент."""
    if not survey_raw:
        return 0
    try:
        data = json.loads(survey_raw)
    except (json.JSONDecodeError, TypeError):
        return 0
    return sum(1 for key in ALARM_SURVEY_KEYS if data.get(key) is True)
