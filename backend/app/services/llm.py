"""LLM-клиент PlusVibe API (OpenAI-совместимый, https://plusvibeapi.ru/v1).

Ключ — в .env (LLM_API_KEY, формат sk-pv-...). Нет ключа, ошибка сети,
таймаут или нехватка баланса (402) → возвращаем None, и функции честно
деградируют: рекомендации остаются на базе правил, чат пишет «недоступен».
LLM никогда не меняет risk_level и не отменяет тревожные статусы.
"""
import json
import logging
import re
from typing import Optional

import httpx

from .. import config

logger = logging.getLogger("medai.llm")


def _strip_fence(content: str) -> str:
    """Срезает markdown-обёртку ```...```, если модель её добавила.

    Важно: не lstrip("json")/lstrip("markdown") — они режут по МНОЖЕСТВУ
    символов и съедают начало ответа, совпадающее с этими буквами."""
    if not content.startswith("```"):
        return content
    if "\n" in content:  # ```json\n{...}``` → берём после первой строки
        content = content.split("\n", 1)[1]
    else:
        content = content.strip("`")
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()

def redact_pii(text: str) -> str:
    """Очищает очевидные идентификаторы; это не гарантирует полную анонимность."""
    patterns = (
        (r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[email скрыт]"),
        (r"(?i)\b(?:https?://|www\.)\S+", "[ссылка скрыта]"),
        (r"(?<!\w)(?:\+7|8)[\s(]*\d{3}[)\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\w)", "[телефон скрыт]"),
        (r"(?i)\b(?:паспорт|снилс|инн|полис)\s*[:\-]?\s*[\d\s-]{4,}", "[документ скрыт]"),
        (r"(?i)\bпациент\s+\d+\b", "пациент"),
    )
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    return text[:4000]


#: Поля бланка, по которым восстанавливается личность. Вырезаем вместе со
#: значением: лабораторные показатели и их единицы эти шаблоны не затрагивают.
_DOCUMENT_PII = (
    (r"(?i)\bФ\.?\s*И\.?\s*О\.?\s*[:\-]?\s*[^\n]{2,80}", "[ФИО скрыто]"),
    (r"(?i)\b(?:дата\s+рождения|д\.?\s*р\.?)\s*[:\-]?\s*[\d.\-/]{6,10}", "[дата рождения скрыта]"),
    (r"(?i)\b(?:адрес(?:\s+регистрации)?|проживает|место\s+жительства)\s*[:\-]?\s*[^\n]{5,120}",
     "[адрес скрыт]"),
    (r"(?i)\b(?:пациент|больной|обследуемый)\s*[:\-]\s*[^\n]{2,80}", "[ФИО скрыто]"),
    (r"(?i)\b(?:врач|доктор)\s*[:\-]\s*[^\n]{2,60}", "[врач скрыт]"),
    (r"(?i)\b(?:направление|направил|учреждение)\s*[:\-]?\s*[^\n]{3,120}", "[учреждение скрыто]"),
    (r"(?i)\b(?:номер\s+заказа|заказ\s*№|штрихкод)\s*[:\-]?\s*[\w-]{4,}", "[номер скрыт]"),
)


def redact_document(text: str, limit: int = 6000) -> str:
    """DLP для текста распознанного документа перед отправкой внешнему LLM.

    Отличие от redact_pii: дополнительно вырезает поля бланка (ФИО, дата рождения,
    адрес, врач, учреждение), потому что на медицинском бланке они стоят рядом
    с показателями. Лабораторные данные — названия показателей, числа, единицы,
    референсные интервалы — сохраняются: без них ответ модели бесполезен.
    """
    if not text:
        return ""
    text = redact_pii(text)
    for pattern, replacement in _DOCUMENT_PII:
        text = re.sub(pattern, replacement, text)
    return text[:limit]


def patient_alias(patient_id: int, age: Optional[int] = None) -> str:
    """Обезличенная подпись пациента для промпта: «Пациент N, X лет» (F034).

    Реальные имя, пол и возраст во внешний LLM (PlusVibe) не уходят —
    модели они не нужны для клинической выжимки, а ПДн не должны
    покидать контур клиники. Возраст без даты рождения сам по себе
    персонацию не раскрывает, поэтому остаётся в подписи."""
    if age:
        return f"Пациент, {age} {_years_word(age)}"
    return "Пациент"


def _years_word(age: int) -> str:
    """Склонение «лет/год/года» — 21 год, 22 года, 25 лет, 11 лет."""
    if age % 100 in (11, 12, 13, 14):
        return "лет"
    if age % 10 == 1:
        return "год"
    if age % 10 in (2, 3, 4):
        return "года"
    return "лет"


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


def chat_completion(payload: dict, timeout: Optional[float] = None) -> Optional[dict]:
    """Единый вызов /chat/completions PlusVibe. Возвращает сообщение-ответ
    (dict с role/content/tool_calls) или None при любой ошибке."""
    if not config.llm_enabled():
        return None
    headers = {
        "Authorization": f"Bearer {config.LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        # Сообщения пользователя/истории проходят DLP-очистку до отправки.
        safe_payload = dict(payload)
        safe_payload["messages"] = [
            {**message, "content": redact_pii(str(message.get("content") or ""))}
            if message.get("role") == "user" else message
            for message in payload.get("messages", [])
        ]
        resp = httpx.post(
            f"{config.LLM_BASE_URL}/chat/completions",
            json=safe_payload,
            headers=headers,
            timeout=timeout or config.LLM_TIMEOUT,
        )
        # 401 ключ / 402 баланс / 403 IP / 429 лимит — всё ведёт к fallback
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        logger.warning("LLM недоступен: %s", exc)
        return None


SUMMARY_SYSTEM_PROMPT = """Ты — медицинский ассистент сети клиник «Спектр-Диагностика».
Готовишь краткую справку ДЛЯ ВРАЧА перед очным приёмом пациента.

ЖЁСТКИЕ ПРАВИЛА:
1. Ты НЕ ставишь диагнозы и НЕ назначаешь лечение — только структурируешь данные.
2. Не приуменьшай тревожные показатели: если риск red/тревога — обязательно выдели это.
3. Пиши по-русски, сжато и по делу, без вводных фраз вроде «конечно» или «итак».
4. Ответ — связный текст до 250 слов: кто пациент, анамнез, жалобы к приёму,
динамика показателей, на что обратить внимание врачу."""


def patient_summary(payload: str) -> Optional[str]:
    """Справка о пациенте для врача. None, если LLM недоступен."""
    message = chat_completion({
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": payload},
        ],
        "temperature": 0.3,
        # DeepSeek-модели — reasoning: сначала думают в reasoning_content,
        # только потом пишут ответ; 600 токенов съедалось рассуждениями,
        # а стандартного таймаута не хватало на размышление.
        "max_tokens": 1500,
    }, timeout=90.0)
    if not message:
        return None
    content = str(message.get("content") or "").strip()
    content = _strip_fence(content)
    return content or None


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
    message = chat_completion({
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(profile, indicators, rule_result)},
        ],
        "temperature": 0.6,
        "max_tokens": 600,
    })
    if not message:
        return None

    content = str(message.get("content") or "").strip()
    # Модели иногда оборачивают JSON в ```...``` — срезаем
    content = _strip_fence(content)

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
