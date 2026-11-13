"""OpenAI-совместимый LLM-адаптер: персональный текст рекомендаций.

Ключ — в .env (LLM_API_KEY). Нет ключа, ошибка сети или таймаут →
возвращаем None, и анализ остаётся на базе правил (см. analyze.py).
LLM никогда не меняет risk_level и не отменяет тревожные статусы.
"""
import json
import logging
from typing import Optional

import httpx

from .. import config

logger = logging.getLogger("medai.llm")

SYSTEM_PROMPT = """Ты — дружелюбный медицинский ассистент-советчик приложения MedAI.
Твоя задача — написать краткие персональные рекомендации по ЗДОРОВОМУ образу жизни
на основе показателей пользователя и выводов системы правил.

ЖЁСТКИЕ ПРАВИЛА:
1. Ты НЕ ставишь диагнозы и НЕ назначаешь лекарства и процедуры.
2. Ты НЕ приуменьшаешь тревожные значения: если правила пометили показатель
   как alarm — обязательно посоветуй обратиться к врачу.
3. Пиши по-русски, тепло и просто, без канцелярита.
4. Верни СТРОГО валидный JSON без markdown-обёрток:
{"summary": "1-2 предложения общего вывода",
 "items": ["рекомендация 1", "рекомендация 2", "рекомендация 3"]}
В items — 3–6 коротких конкретных рекомендаций."""


def _build_user_prompt(profile: dict, indicators: dict, rule_result: dict) -> str:
    profile_lines = [
        f"- {k}: {v}" for k, v in profile.items() if v not in (None, "", 0)
    ]
    indicator_lines = [
        f"- {f['label']}: {f['value']} {f['unit']} [{f['status']}] — {f['message']}"
        for f in rule_result["findings"]
    ]
    return (
        "Профиль пользователя:\n" + ("\n".join(profile_lines) or "- не указан") + "\n\n"
        "Показатели и выводы правил:\n" + "\n".join(indicator_lines) + "\n\n"
        f"Итоговый риск по правилам: {rule_result['risk_level']} "
        f"({ 'срочно к врачу' if rule_result['urgent'] else 'без срочного флага' }).\n\n"
        "Напиши персональные рекомендации. Не меняй оценку риска и не спорь с правилами."
    )


def enrich(profile: dict, indicators: dict, rule_result: dict) -> Optional[dict]:
    """Возвращает {"summary": str, "items": [str]} или None, если LLM недоступен."""
    if not config.llm_enabled():
        return None

    payload = {
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(profile, indicators, rule_result)},
        ],
        "temperature": 0.6,
        "max_tokens": 600,
    }
    headers = {
        "Authorization": f"Bearer {config.LLM_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(
            f"{config.LLM_BASE_URL}/chat/completions",
            json=payload,
            headers=headers,
            timeout=config.LLM_TIMEOUT,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        logger.warning("LLM недоступен: %s", exc)
        return None

    # Модели иногда оборачивают JSON в ```...``` — срезаем
    if content.startswith("```"):
        content = content.strip("`").lstrip("json").strip()

    try:
        data = json.loads(content)
        summary = str(data["summary"]).strip()
        items = [str(i).strip() for i in data["items"] if str(i).strip()]
        if not summary or not items:
            return None
        return {"summary": summary, "items": items[:6]}
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.warning("LLM вернул неожиданный формат: %s", exc)
        return None
