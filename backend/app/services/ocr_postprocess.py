"""Постобработка текста OCR (LiteParse/OCRia).

Задача — сделать распознанный текст читаемым, не меняя медицинские данные:

* markdown-мусор LiteParse (таблицы с ``|``, заголовки ``#``, ``**``) превращается
  в выровненный обычный текст;
* HTML-таблицы бланков (LiteParse 2.21 отдаёт их как ``<table><tr><td>``) разбираются
  в те же выровненные колонки; строка-заголовок на всю ширину (``colspan``) выходит
  отдельной строкой, ``rowspan`` учитывается резервированием колонок;
* типовые ошибки распознавания единиц измерения исправляются только в контексте
  «число + единица» (например ``145 r/n`` → ``145 г/л``);
* разорванные строки склеиваются, лишние пустые строки убираются.

Числа не изменяются никогда: ни одна подстановка не трогает цифры и не меняет
их порядок, поэтому результат безопасно показывать врачу и пациенту.
Исходный текст сохраняется рядом (``documents.ocr_text``) и доступен как
``text_raw`` — постобработка ничего не теряет.
"""
import re
from html import unescape

# Неразрывный пробел, мягкий перенос и zero-width символы — от LiteParse.
_INVISIBLE = dict.fromkeys(map(ord, "\u00a0\u00ad\u200b\u200c\u200d\ufeff"), " ")

_MD_LINK = re.compile(r"\[([^\]\n]+)\]\([^)\n]*\)")
_MD_EMPHASIS = re.compile(r"(\*\*|__|`{1,3})([^\n]+?)\1")
_MD_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]*", re.MULTILINE)
_MD_RULE = re.compile(r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$", re.MULTILINE)
_MD_BULLET = re.compile(r"^[ \t]*[-*+][ \t]+", re.MULTILINE)
_TABLE_SEPARATOR_CELL = re.compile(r":?-{2,}:?")
_HYPHEN_BREAK = re.compile(r"([а-яёa-z])-[ \t]*\n[ \t]*([а-яёa-z])", re.IGNORECASE)
_ALIGNED_GAP = re.compile(r"[ \t]{2,}")
_BLANK_RUN = re.compile(r"\n[ \t]*(?:\n[ \t]*){2,}")

#: Правки единиц измерения. Каждое правило срабатывает только сразу после цифры,
#: поэтому обычный текст («раз в год», «г/л в норме») не затрагивается.
_UNIT_RULES = (
    # 145 r/n, 145 г/п, 145 r|л → 145 г/л (кириллическая «г» и латинская «r» в OCR неразличимы)
    (re.compile(r"(?<=\d)[ \t]*[rгГ][ \t]*[/|][ \t]*[nпNП](?![\w/])"), " г/л"),
    # ммоль/п, мкмоль/n → ммоль/л, мкмоль/л
    (re.compile(r"(?<=\d)[ \t]*ммоль[ \t]*[/|][ \t]*[пnПN](?![\w/])", re.IGNORECASE), " ммоль/л"),
    (re.compile(r"(?<=\d)[ \t]*мкмоль[ \t]*[/|][ \t]*[пnПN](?![\w/])", re.IGNORECASE), " мкмоль/л"),
    # мг/дп, мг/дn → мг/дл
    (re.compile(r"(?<=\d)[ \t]*мг[ \t]*[/|][ \t]*д[пnПN](?![\w/])", re.IGNORECASE), " мг/дл"),
    # 10^9/n, 10 9|л, 10*9/п → 10^9/л (и то же для 10^12)
    (re.compile(r"(?<![\d.])(?:10[ \t]*[\^*×][ \t]*9|10[ \t]+9)[ \t]*[/|][ \t]*[лnпNПЛ](?![\w/])",
                re.IGNORECASE), "10^9/л"),
    (re.compile(r"(?<![\d.])(?:10[ \t]*[\^*×][ \t]*12|10[ \t]+12)[ \t]*[/|][ \t]*[лnпNПЛ](?![\w/])",
                re.IGNORECASE), "10^12/л"),
    # мм/ч, ММ/Ч, MM/ч → мм/ч (латинская M в OCR неотличима от кириллической М)
    (re.compile(r"(?<=\d)[ \t]*[мmМM]{2}[ \t]*[/|][ \t]*[чЧ](?![\w/])", re.IGNORECASE), " мм/ч"),
    # 24.7 nr → 24.7 пг: пикограммы (пг) OCR стабильно читает латиницей n/r
    (re.compile(r"(?<=\d)[ \t]*[nпП][ \t]*[rгГ](?![\w/])"), " пг"),
    # Общий случай: «число/n» → «число/л». Срабатывает последним, только на
    # латинской «n» после косой черты и только у чисел от двух цифр или с
    # дробной частью — поэтому дозировки вида «2/n» не переписываются.
    # Цифры не меняются: «1012/n» станет «1012/л», а не выдуманным «10^12/л».
    (re.compile(r"(\d{2,}(?:[.,]\d+)?|\d[.,]\d+)[ \t]*[/|][ \t]*[nпNП](?![\w/])"), r"\1/л"),
)

#: Явный и намеренно короткий словарь терминов, которые OCR стабильно читает
#: латиницей. Пополнять только парами, проверенными на реальных бланках:
#: «угадывать» слова нельзя — правка не должна менять смысл документа.
_TERM_RULES = (
    # Только латинская «O»: «C09» — это ещё и код МКБ-10, его нельзя трогать.
    (re.compile(r"(?<![A-Za-zА-Яа-я])(?:CO9|CO3|СO9)(?![A-Za-zА-Яа-я0-9])"), "СОЭ"),
)

#: Строка выглядит законченной — склеивать со следующей не нужно.
_SENTENCE_END = re.compile(r"[.:;!?)\]»…]$")


def _strip_invisible(text: str) -> str:
    return text.translate(_INVISIBLE)


def _strip_markdown(text: str) -> str:
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_HEADING.sub("", text)
    text = _MD_RULE.sub("", text)
    text = _MD_EMPHASIS.sub(r"\2", text)
    return _MD_BULLET.sub("• ", text)


def _join_hyphenation(text: str) -> str:
    return _HYPHEN_BREAK.sub(r"\1\2", text)


# --- HTML-таблицы бланков (LiteParse 2.21): <table><tr><td>… → выровненные колонки ---

_TABLE_BLOCK = re.compile(r"<table[^>]*>.*?</table>", re.IGNORECASE | re.DOTALL)
_HTML_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_HTML_CELL = re.compile(r"<t[dh]([^>]*)>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
_HTML_COLSPAN = re.compile(r"\bcolspan=[\"']?(\d+)", re.IGNORECASE)
_HTML_ROWSPAN = re.compile(r"\browspan=[\"']?(\d+)", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
_HTML_BREAK = re.compile(r"<br[^>]*/?>", re.IGNORECASE)
_RUN_SPACES = re.compile(r"\s+")


def _cell_text(body: str) -> str:
    """Текст ячейки без разметки: теги и <br> — в пробел, мнемоники раскрываются."""
    text = _HTML_BREAK.sub(" ", body)
    text = _HTML_TAG.sub(" ", text)
    return _RUN_SPACES.sub(" ", unescape(text)).strip()


def _html_table_rows(block: str) -> list[tuple[list[str], int]]:
    """Строки таблицы: (ячейки с учётом rowspan-резервов, своя ширина по colspan)."""
    rows: list[tuple[list[str], int]] = []
    reserved: dict[tuple[int, int], str] = {}
    for row_idx, row_html in enumerate(_HTML_ROW.findall(block)):
        cursor = 0
        cells: list[str] = []
        own_span = 0
        for attrs, body in _HTML_CELL.findall(row_html):
            while (row_idx, cursor) in reserved:
                cells.append(reserved.pop((row_idx, cursor)))
                cursor += 1
            colspan = int(m.group(1)) if (m := _HTML_COLSPAN.search(attrs)) else 1
            rowspan = int(m.group(1)) if (m := _HTML_ROWSPAN.search(attrs)) else 1
            cells.append(_cell_text(body))
            own_span += colspan
            for r in range(1, rowspan):
                for c in range(colspan):
                    reserved.setdefault((row_idx + r, cursor + c), "")
            cursor += colspan
        while (row_idx, cursor) in reserved:
            cells.append(reserved.pop((row_idx, cursor)))
            cursor += 1
        rows.append((cells, own_span))
    return rows


def _format_html_tables(text: str) -> str:
    """<table>-блоки → обычный текст: колонки выровнены, строка-заголовок
    на всю ширину (одна ячейка с colspan по всей ширине) идёт отдельной строкой.
    Содержимое ячеек не изменяется — только разметка и выравнивание.
    Пустые ячейки выводятся как «—», как на бумажном бланке: иначе при
    выравнивании пустая колонка схлопывается и строка теряет позицию."""

    def convert(match: re.Match[str]) -> str:
        rows = _html_table_rows(match.group(0))
        if not rows:
            return ""
        width = max(own_span for _, own_span in rows)
        if width <= 0:
            return ""
        items: list[tuple[str, list[str]]] = []
        for cells, own_span in rows:
            # Заголовок раздела: единственная содержательная ячейка на всю ширину.
            if len(cells) == 1 and own_span >= width and cells[0]:
                items.append(("text", [cells[0]]))
            elif any(cells):
                items.append(("grid", list(cells) + [""] * (width - len(cells))))
        columns = [0] * width
        for _, row in items:
            if len(row) == width:
                for index, cell in enumerate(row):
                    columns[index] = max(columns[index], len(cell or "—"))
        parts: list[str] = []
        grid_block: list[str] = []
        for kind, row in items:
            if kind == "text":
                if grid_block:
                    parts.append("\n".join(grid_block))
                    grid_block = []
                parts.append(row[0])
            else:
                grid_block.append("  ".join(
                    (row[index] or "—").ljust(columns[index]) for index in range(width)
                ).rstrip())
        if grid_block:
            parts.append("\n".join(grid_block))
        return "\n\n".join(parts)

    return _TABLE_BLOCK.sub(convert, text)


def _format_tables(text: str) -> str:
    """Markdown-таблицы → выровненные колонки обычного текста."""
    out: list[str] = []
    block: list[str] = []

    def flush() -> None:
        if not block:
            return
        rows: list[list[str]] = []
        for line in block:
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            # Разделитель шапки (|---|:--:|) — не данные.
            if cells and all(not cell or _TABLE_SEPARATOR_CELL.fullmatch(cell) for cell in cells):
                continue
            if not any(cells):
                continue
            rows.append(cells)
        block.clear()
        if not rows:
            return
        width = max(len(row) for row in rows)
        columns = [0] * width
        for row in rows:
            for index, cell in enumerate(row):
                columns[index] = max(columns[index], len(cell))
        for row in rows:
            padded = [
                (row[index] if index < len(row) else "—").ljust(columns[index])
                for index in range(width)
            ]
            out.append("  ".join(padded).rstrip())

    for line in text.split("\n"):
        if line.count("|") >= 2:
            block.append(line)
        else:
            flush()
            out.append(line)
    flush()
    return "\n".join(out)


def _fix_units(text: str) -> str:
    for pattern, replacement in _UNIT_RULES:
        text = pattern.sub(replacement, text)
    return text


def _fix_terms(text: str) -> str:
    for pattern, replacement in _TERM_RULES:
        text = pattern.sub(replacement, text)
    return text


def _merge_broken_lines(text: str) -> str:
    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if out and stripped:
            previous = out[-1]
            # Строки таблиц (2+ пробела между колонками) и списки не склеиваем.
            if (previous.strip()
                    and not _ALIGNED_GAP.search(previous)
                    and not _ALIGNED_GAP.search(stripped)
                    and not _SENTENCE_END.search(previous.rstrip())
                    and stripped[0].islower()):
                out[-1] = previous.rstrip() + " " + stripped
                continue
        out.append(line)
    return "\n".join(out)


def clean(text: str) -> str:
    """Возвращает читаемый текст документа. Пустая строка — если текста нет."""
    if not text:
        return ""
    result = text.replace("\r\n", "\n").replace("\r", "\n")
    result = _strip_invisible(result)
    result = _strip_markdown(result)
    result = _format_html_tables(result)
    result = _join_hyphenation(result)
    result = _format_tables(result)
    result = _fix_units(result)
    result = _fix_terms(result)
    result = _merge_broken_lines(result)
    result = _BLANK_RUN.sub("\n\n", result)
    result = "\n".join(line.rstrip() for line in result.split("\n"))
    return result.strip()


def analyze(raw: str) -> dict:
    """Сводка для аудита: только размеры и факт изменения, без содержимого."""
    cleaned = clean(raw)
    return {
        "chars_raw": len(raw),
        "chars_clean": len(cleaned),
        "changed": cleaned != raw,
    }
