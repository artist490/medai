"""Категории медицинских документов и авто-названия по тексту OCR.

Детерминированная классификация по ключевым словам — без LLM: мгновенно,
бесплатно и медицинский текст не покидает сервер (в духе правил rules.py).
Порядок словаря фиксированный — он задаёт порядок групп в интерфейсе;
первое совпадение выигрывает, поэтому более специфичные категории выше.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class DocCategory:
    key: str
    label: str
    keywords: tuple[str, ...]


# Ключевые слова в нижнем регистре, проверка — по подстроке. Состав расширяется
# только парами, проверенными на реальных бланках (та же философия, что в
# _TERM_RULES постобработки: «не угадывать»).
DOC_CATEGORIES: tuple[DocCategory, ...] = (
    DocCategory("blood", "Кровь", (
        "анализ крови", "общеклинический анализ", "гемоглобин", "гематокрит",
        "лейкоцит", "эритроцит", "тромбоцит", "соэ", "коагулограмма",
    )),
    DocCategory("hormones", "Гормоны и биохимия", (
        "биохимическ", "глюкоза", "холестерин", "билирубин", "алт", "аст",
        "ттг", "ферритин", "витамин d", "кортизол",
    )),
    DocCategory("urine", "Моча", (
        "анализ мочи", "уробилиноген", "плотность мочи",
    )),
    DocCategory("stool", "Кал", (
        "копрограмма", "кал на", "фекалии",
    )),
    DocCategory("smears", "Мазки и цитология", (
        "мазок", "цитологическ", "онкоцитология", "пап-тест",
    )),
    DocCategory("imaging", "МРТ, КТ, УЗИ и рентген", (
        "мрт", "кт ", "узи", "рентген", "флюорография", "допплер",
    )),
    DocCategory("function", "ЭКГ и функциональная диагностика", (
        "экг", "спирометрия", "смад", "суточное мониторирование",
    )),
)

OTHER = DocCategory("other", "Прочее", ())


def classify(text: str) -> DocCategory:
    """Первая категория словаря, в чьи ключевые слова попал текст; иначе Прочее."""
    lowered = (text or "").lower()
    for category in DOC_CATEGORIES:
        if any(keyword in lowered for keyword in category.keywords):
            return category
    return OTHER


def _format_date(uploaded_at: str) -> str:
    """ISO «2026-11-27 10:00:00» → «27.11.2026»; на странном входе — как есть."""
    day = (uploaded_at or "")[:10]
    parts = day.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return day


def suggest_title(text: str, category: DocCategory, uploaded_at: str) -> str:
    """Название по бланку: строка-заголовок (≤120 символов), иначе фолбэк.

    Стресс-тест на плотном бланке показал: OCR часто переставляет блоки, и
    настоящий заголовок оказывается не первой строкой. Поэтому сначала ищем
    строку с явным признаком заголовка («анализ», «исследование», слова
    категории), и только затем берём первую значимую. Markdown-остатки OCR
    («#», «*», «|») срезаются; пустой текст даёт «{label} · {дата}».
    """
    fallback = f"{category.label} · {_format_date(uploaded_at)}"
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip("#").replace("*", "").replace("|", " ").strip()
        if line:
            lines.append(line)
    if not lines:
        return fallback
    cues = ("анализ", "исследование", "протокол", "заключение", "осмотр") + category.keywords
    # Строка-заголовок бланка без цифр: строки таблицы («Гемоглобин 118 …») тоже
    # содержат ключевые слова, но идут раньше смещённого заголовка. Сначала
    # ищем совпадение без цифр, затем — любое, затем первую значимую строку.
    for with_digits in (False, True):
        for line in lines:
            if with_digits is any(ch.isdigit() for ch in line):
                lowered = line.lower()
                if any(cue in lowered for cue in cues):
                    return line[:120].rstrip() or fallback
    return lines[0][:120].rstrip() or fallback
