"""Детерминированный парсер лабораторных показателей из текста бланка (Д1).

Философия правил — как в doc_categories и ocr_postprocess: распознаём только
подтверждённые пары «показатель → значение» из фиксированного словаря
синонимов; всё остальное честно попадает в счётчик «не распознано».
Ничего не угадываем и не переписываем: цифры OCR идут в ответ как есть
(инвариант ocr_postprocess).

Вход — ocr_text_clean (постобработка уже выровняла таблицы LiteParse в
markdown-строки «| Название | Значение | …» и привела единицы). Парсер
принимает и простые строки «Гемоглобин 145 г/л 130-160».

Выход — JSON-структура для documents.lab_values:
    {"items": [{key, label, value, unit, norm_text, norm_low, norm_high, status}],
     "unparsed": N}
status: normal | high | low — только когда норма распознана; иначе unknown.
"""
import json
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class LabTerm:
    key: str
    label: str
    synonyms: tuple[str, ...]


# Синонимы с хвостом «*» — основы слов (глюкоз* ловит «глюкоза», «глюкозы»),
# без «*» — полные слова по границе. Порядок словаря решает совпадения:
# более конкретные («холестерин лпвп») выше общих.
LAB_TERMS: tuple[LabTerm, ...] = (
    LabTerm("hemoglobin", "Гемоглобин", ("гемоглобин*", "hemoglobin", "hb", "hgb")),
    LabTerm("esr", "СОЭ", ("соэ", "esr", "скорость оседания эритроцитов", "роэ")),
    LabTerm("erythrocytes", "Эритроциты", ("эритроцит*", "erythrocyt*", "rbc")),
    LabTerm("leukocytes", "Лейкоциты", ("лейкоцит*", "leukocyt*", "wbc")),
    LabTerm("platelets", "Тромбоциты", ("тромбоцит*", "thrombocyt*", "plt")),
    LabTerm("hematocrit", "Гематокрит", ("гематокрит*", "hematocrit", "htc")),
    LabTerm("reticulocytes", "Ретикулоциты", ("ретикулоцит*", "reticulocyt*")),
    LabTerm("glucose", "Глюкоза", ("глюкоз*", "glucose")),
    LabTerm("ldl", "Холестерин ЛПНП", ("холестерин лпнп", "лпнп", "ldl")),
    LabTerm("hdl", "Холестерин ЛПВП", ("холестерин лпвп", "лпвп", "hdl")),
    LabTerm("cholesterol_total", "Холестерин общий",
            ("холестерин общий", "общий холестерин", "cholesterol total", "охс", "холестерин*")),
    LabTerm("triglycerides", "Триглицериды", ("триглицерид*", "triglycerid*")),
    LabTerm("bilirubin_total", "Билирубин общий", ("билирубин общий", "общий билирубин")),
    LabTerm("bilirubin", "Билирубин", ("билирубин*", "bilirubin*")),
    LabTerm("alt", "АЛТ", ("алт", "алат", "alt", "sgpt", "gpt")),
    LabTerm("ast", "АСТ", ("аст", "асат", "ast", "sgot", "got")),
    LabTerm("creatinine", "Креатинин", ("креатинин*", "creatinin*")),
    LabTerm("urea", "Мочевина", ("мочевина", "мочевины", "мочевин*", "urea")),
    LabTerm("uric_acid", "Мочевая кислота", ("мочевая кислота", "мочевой кислоты", "uric acid", "урат*")),
    LabTerm("tsh", "ТТГ", ("ттг", "tsh")),
    LabTerm("protein_total", "Белок общий", ("белок общий", "общий белок", "total protein")),
    LabTerm("albumin", "Альбумин", ("альбумин*", "albumin*")),
    LabTerm("crp", "С-реактивный белок", ("с-реактивный белок", "срб", "crp")),
    LabTerm("amylase", "Амилаза", ("амилаз*", "amylas*")),
    LabTerm("lipase", "Липаза", ("липаз*", "lipas*")),
    LabTerm("ferritin", "Ферритин", ("ферритин*", "ferritin*")),
    LabTerm("iron", "Железо сыворотки", ("железо сыворотки", "сывороточное железо")),
    LabTerm("vitamin_d", "Витамин D", ("витамин d", "25-oh", "25(oh)d", "витамин d3")),
    LabTerm("calcium", "Кальций", ("кальций*", "calcium")),
    LabTerm("potassium", "Калий", ("калий*", "potassium")),
    LabTerm("sodium", "Натрий", ("натрий*", "sodium")),
    LabTerm("inr", "МНО", ("мно", "inr")),
)


def _term_pattern(syn: str) -> re.Pattern[str]:
    """Полные слова — по границе; основы («глюкоз*») — допускают окончание."""
    if syn.endswith("*"):
        stem = re.escape(syn[:-1])
        return re.compile(rf"(?<![a-zа-яё0-9]){stem}[a-zа-яё]*", re.IGNORECASE)
    return re.compile(rf"(?<![a-zа-яё0-9]){re.escape(syn)}(?![a-zа-яё0-9])", re.IGNORECASE)


_TERM_PATTERNS: list[tuple[LabTerm, list[re.Pattern[str]]]] = [
    (term, [_term_pattern(syn) for syn in term.synonyms])
    for term in LAB_TERMS
]

VALUE_RE = re.compile(r"(\d{1,5}(?:[.,]\d{1,3})?)")
# Хвост, делающий число частью единицы «10^9/л»: показатель степени между
# числом и косой чертой. «1049/л» без маркера степени — значение как есть:
# цифры OCR не переписываем (инвариант ocr_postprocess), решает владелец.
UNIT_NUMBER_TAIL = re.compile(r"(?=\s*[\^*×xX×]\s*\d*\s*/|\s*[⁹⁶³])", re.IGNORECASE)
UNIT_RE = re.compile(r"^[a-zа-яё0-9/%²³°µ.,^*×xX⁰¹²⁴⁵⁶⁷⁸⁹\s\-–]{1,18}$", re.IGNORECASE)
# Число «10^9/л» в начале остатка строки — это единица, не значение.
# Маркер степени обязателен: «1049/л» без маркера — значение как есть.
EXPONENT_UNIT_RE = re.compile(
    r"^\s*10\s*(?:[\^*×xX×]\s*\d{0,2}|[⁹⁶³])\s*/\s*[а-яёa-z]{1,8}", re.IGNORECASE
)
# Признак начала нормы в остатке строки
NORM_START_RE = re.compile(r"\d|до|от|<|≤|>|≥", re.IGNORECASE)
RANGE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)")
UNTIL_RE = re.compile(r"(?:до|<|≤|не более)\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE)
FROM_RE = re.compile(r"(?:от|>|≥|не менее)\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE)
VALUE_ONLY_RE = re.compile(r"^\d+(?:[.,]\d+)?$")


def _num(raw: str) -> float | None:
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def _clean_cell(cell: str) -> str:
    """Markdown-остатки и хвостовые точки ячеек таблицы."""
    return cell.replace("*", "").replace("#", "").strip().strip(".").strip()


def _looks_like_unit(text: str) -> bool:
    cleaned = _clean_cell(text)
    if not cleaned or not re.search(r"[a-zа-яё%°]", cleaned, re.IGNORECASE):
        return False
    return bool(UNIT_RE.fullmatch(cleaned))


def find_term(text: str, start: int = 0) -> tuple[LabTerm, int, int] | None:
    """Словарный показатель в тексте с позиции start: (термин, начало, конец синонима).

    Побеждает самая ранняя позиция; при равной позиции — самый длинный
    синоним («холестерин лпвп» конкретнее «холестерина»).
    """
    best: tuple[LabTerm, int, int] | None = None  # (термин, начало, конец)
    best_rank: tuple[int, int] | None = None
    for term, patterns in _TERM_PATTERNS:
        for pattern in patterns:
            match = pattern.search(text, start)
            if match is None:
                continue
            rank = (match.start(), -len(match.group(0)))
            if best is None or rank < best_rank:
                best = (term, match.start(), match.end())
                best_rank = rank
    return (best[0], best[1], best[2]) if best else None


def _parse_norm(norm_text: str) -> tuple[float | None, float | None, str]:
    """Норма из хвоста строки/ячейки: «130-160», «до 15», «от 4», «< 5», «15».

    Одно число без диапазона трактуем как верхнюю границу — типичная
    однострочная норма лаборатории («СОЭ до 15» печатается и просто «15»).
    """
    norm_text = norm_text.strip(" ()")
    if not norm_text:
        return None, None, ""
    if m := RANGE_RE.search(norm_text):
        return _num(m.group(1)), _num(m.group(2)), norm_text
    if m := UNTIL_RE.search(norm_text):
        return None, _num(m.group(1)), norm_text
    if m := FROM_RE.search(norm_text):
        return _num(m.group(1)), None, norm_text
    if VALUE_ONLY_RE.fullmatch(norm_text):
        return None, _num(norm_text), norm_text
    return None, None, norm_text


def _status_of(value: float, norm_low: float | None, norm_high: float | None) -> str:
    if norm_low is not None and value < norm_low:
        return "low"
    if norm_high is not None and value > norm_high:
        return "high"
    if norm_low is not None or norm_high is not None:
        return "normal"
    return "unknown"


def _clean_unit(raw: str) -> str:
    """Обрывок строки после значения → единица измерения или пустая строка."""
    unit = raw.replace("|", " ").replace("(", "").replace(")", "")
    unit = re.sub(r"\s*(?:до|от|<|≤|>|≥|не более|не менее).*$", "", unit, flags=re.IGNORECASE)
    unit = unit.strip().strip(",").strip()
    if not _looks_like_unit(unit):
        return ""
    return unit


def _value_in(tail: str) -> tuple[float, int] | None:
    """Первое число хвоста, не являющееся началом единицы измерения."""
    # Хвост начинается прямо с единицы «10^9/л»: значение ищем после неё,
    # иначе «9» из степени читалось бы как значение.
    if m := EXPONENT_UNIT_RE.match(tail):
        after = tail[m.end():]
        if next := VALUE_RE.search(after):
            return _num(next.group(1)), m.end() + next.end()
        return None
    pos = 0
    while m := VALUE_RE.search(tail, pos):
        rest = tail[m.end():]
        if UNIT_NUMBER_TAIL.match(rest):
            pos = m.end() + 1  # «10^9/л» — это единица, значение дальше
            continue
        return _num(m.group(1)), m.end()
    return None


def _parse_row(term: LabTerm, tail: str) -> dict | None:
    """Хвост строки после названия показателя → структура значения."""
    found = _value_in(tail)
    if found is None:
        return None
    value, value_end = found

    rest = tail[value_end:]
    unit = ""
    norm_text_raw = ""
    if exp := EXPONENT_UNIT_RE.match(rest):
        # сразу «10^9/л …»: съели единицу, норма в остатке
        unit = _clean_cell(exp.group(0))
        norm_text_raw = rest[exp.end():]
    else:
        stripped = rest.lstrip()
        lead = len(rest) - len(stripped)
        norm_start = NORM_START_RE.search(stripped)
        if norm_start is None:
            unit = _clean_unit(rest)  # остаток целиком — единица измерения
        elif norm_start.start() > 0:
            # норма начинается не с первого символа остатка — до неё единица
            unit = _clean_unit(rest[lead:lead + norm_start.start()])
            norm_text_raw = stripped[norm_start.start():]
        else:
            norm_text_raw = stripped  # норма начинается сразу после значения
    norm_low, norm_high, norm_text = _parse_norm(norm_text_raw)
    return {
        "key": term.key,
        "label": term.label,
        "value": value,
        "unit": unit,
        "norm_text": norm_text,
        "norm_low": norm_low,
        "norm_high": norm_high,
        "status": _status_of(value, norm_low, norm_high),
    }


def _parse_table_cells(cells: list[str]) -> dict | None:
    """Markdown-строка «| Гемоглобин | 145 | г/л | 130–160 |» — ячейки."""
    name_idx = None
    name = None
    for i, cell in enumerate(cells):
        found = find_term(cell)
        if found is not None:
            name, name_idx = found[0], i
            break
    if name is None:
        return None

    # Значение: первая чисто-числовая или смешанная ячейка после названия
    value_idx = None
    value = None
    for i in range(name_idx + 1, len(cells)):
        cell = _clean_cell(cells[i])
        if not cell:
            continue
        if VALUE_ONLY_RE.fullmatch(cell):
            value, value_idx = _num(cell), i
            break
        found = _value_in(cell)
        if found is not None:
            value, value_idx = found[0], i
            break
    if value is None:
        return None

    unit = ""
    norm_parts: list[str] = []
    for cell in cells[value_idx + 1:]:
        cleaned = _clean_cell(cell)
        if not cleaned:
            continue
        if not unit and _looks_like_unit(cleaned):
            unit = cleaned
        elif NORM_START_RE.search(cleaned):
            norm_parts.append(cleaned)
    norm_low, norm_high, norm_text = _parse_norm(" ".join(norm_parts))
    return {
        "key": name.key,
        "label": name.label,
        "value": value,
        "unit": unit,
        "norm_text": norm_text,
        "norm_low": norm_low,
        "norm_high": norm_high,
        "status": _status_of(value, norm_low, norm_high),
    }


def parse(text: str) -> dict | None:
    """Показатели из текста бланка; None — если ни одной подтверждённой пары."""
    items: list[dict] = []
    seen: set[str] = set()
    unparsed = 0
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line or set(line) <= {"|-", " ", "|"}:
            continue  # разделитель markdown-таблицы
        if "|" in line:
            row = _parse_table_cells(line.strip("|").split("|"))
            if row is not None:
                if row["key"] not in seen:
                    items.append(row)
                    seen.add(row["key"])
                continue
        # Простая строка: «Гемоглобин 145 г/л 130-160» (остатки таблицы — в пробел)
        line = line.replace("|", " ")
        found = find_term(line)
        if found is None:
            continue
        term, _, synonym_end = found
        # Хвост после синонима: цифры даты/шапки до названия не затрагиваются
        row = _parse_row(term, line[synonym_end:])
        if row is not None:
            if row["key"] not in seen:
                items.append(row)
                seen.add(row["key"])
        else:
            unparsed += 1  # показатель из словаря есть, значение не прочитать

    if not items and not unparsed:
        return None
    return {"items": items, "unparsed": unparsed}


def lab_values_payload(raw: str | None) -> dict | None:
    """documents.lab_values (JSON-строка) → объект для API-ответа."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict) or not data.get("items"):
        return None
    return data


# «Показатель обработан, но ничего не распознано» — маркер вместо NULL:
# backfill идемпотентен и не перечитывает готовые документы заново.
EMPTY_RESULT = '{"items": [], "unparsed": 0}'


def store_json(result: dict | None) -> str | None:
    """Результат parse() → строка для колонки lab_values (None не бывает)."""
    if result is None or not result.get("items") and not result.get("unparsed"):
        return EMPTY_RESULT
    return json.dumps(result, ensure_ascii=False)


LAB_KEY_LABELS: dict[str, str] = {t.key: t.label for t in LAB_TERMS}
