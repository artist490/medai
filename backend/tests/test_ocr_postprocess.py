"""Постобработка текста OCR: оформление, единицы измерения, сохранность чисел."""
from app.services import ocr_postprocess


def test_markdown_table_becomes_aligned_text():
    raw = "| Показатель | Значение |\n|---|---|\n| Hb | 145 |\n| СОЭ | 12 |"
    assert ocr_postprocess.clean(raw) == (
        "Показатель  Значение\n"
        "Hb          145\n"
        "СОЭ         12"
    )


def test_units_are_fixed_only_next_to_numbers():
    assert ocr_postprocess.clean("Гемоглобин 145 r/n") == "Гемоглобин 145 г/л"
    assert ocr_postprocess.clean("Лейкоциты 6.2 10^9/n") == "Лейкоциты 6.2 10^9/л"
    assert ocr_postprocess.clean("Глюкоза 5.4 ммоль/п") == "Глюкоза 5.4 ммоль/л"
    assert ocr_postprocess.clean("MCH 24.7 nr") == "MCH 24.7 пг"
    # Без числа рядом правило не срабатывает: текст не переписывается наугад.
    assert ocr_postprocess.clean("сдавать r/n не нужно") == "сдавать r/n не нужно"


def test_lab_units_from_real_ocr():
    """Реальный вывод LiteParse: «1012/n», «MM/ч», «CO9»."""
    raw = "Гемоглобин 145 r/n 130-160 Эритроциты 4.7 1012/n 4.0-5.0\n\nCO9 12 MM/ч 2-15"
    assert ocr_postprocess.clean(raw) == (
        "Гемоглобин 145 г/л 130-160 Эритроциты 4.7 1012/л 4.0-5.0\n\nСОЭ 12 мм/ч 2-15"
    )


def test_dosages_and_icd_codes_are_not_touched():
    # «2/n» — дозировка, а «C09» — код МКБ-10: такие совпадения не переписываем.
    assert ocr_postprocess.clean("доза 2/n в сутки") == "доза 2/n в сутки"
    assert ocr_postprocess.clean("Код C09 по МКБ-10") == "Код C09 по МКБ-10"


def test_numbers_are_never_changed():
    raw = "| Hb | 145 r/n | 130-160 |\n| СОЭ | 12.5 | 2-15 |"
    cleaned = ocr_postprocess.clean(raw)
    for number in ("145", "130-160", "12.5", "2-15"):
        assert number in cleaned


def test_html_table_becomes_aligned_text():
    raw = ("<table><tr><td>Показатель</td><td>Результат</td></tr>"
           "<tr><td>Гемоглобин (HGB)</td><td>122 r/n</td></tr>"
           "<tr><td>СОЭ</td><td>10 мМ/Ч</td></tr></table>")
    cleaned = ocr_postprocess.clean(raw)
    assert "<table" not in cleaned and "<td" not in cleaned
    lines = cleaned.split("\n")
    assert len(lines) == 3
    for line in lines:
        assert "  " in line  # колонки разделены выравниванием
    assert lines[1].split() == ["Гемоглобин", "(HGB)", "122", "г/л"]
    assert lines[2].split() == ["СОЭ", "10", "мм/ч"]


def test_html_colspan_row_becomes_standalone_line():
    """Шапка раздела на всю ширину не растягивает колонки сетки."""
    raw = ("<table>"
           "<tr><td>Скорость оседания</td><td>10 мМ/Ч</td><td>2 20</td></tr>"
           '<tr><td colspan="3">Общеклинический анализ крови с лейкоцитарной формулой</td></tr>'
           "<tr><td>Гемоглобин (HGB)</td><td>122 r/n</td><td>115 - 145</td></tr>"
           "</table>")
    cleaned = ocr_postprocess.clean(raw)
    header = next(line for line in cleaned.split("\n") if line.startswith("Общеклинический"))
    assert header == "Общеклинический анализ крови с лейкоцитарной формулой"
    hgb = next(line for line in cleaned.split("\n") if line.startswith("Гемоглобин"))
    assert hgb.split() == ["Гемоглобин", "(HGB)", "122", "г/л", "115", "-", "145"]


def test_html_rowspan_keeps_grid_shape():
    raw = ('<table><tr><td>Лимфоциты, % (LY%)</td><td></td><td rowspan="2">af Cn 3TO8</td></tr>'
           "<tr><td>Моноциты, % (MO%)</td><td>7.8 %</td></tr></table>")
    cleaned = ocr_postprocess.clean(raw)
    lines = [line for line in cleaned.split("\n") if line.strip()]
    assert len(lines) == 2
    # Пустые ячейки — «—»: колонки не схлопываются и позиции сохраняются
    assert lines[0].split() == ["Лимфоциты,", "%", "(LY%)", "—", "af", "Cn", "3TO8"]
    assert lines[1].split() == ["Моноциты,", "%", "(MO%)", "7.8", "%", "—"]


def test_html_empty_cells_keep_column_positions():
    """Норма «25.0 - 31.0» стоит в третьей колонке, как на бланке."""
    raw = ('<table><tr><td>Показатель</td><td>Результат</td><td>Норма</td></tr>'
           '<tr><td>Гемоглобин (HGB)</td><td>122 г/л</td><td>115 - 145</td></tr>'
           '<tr><td></td><td></td><td>25.0 - 31.0</td></tr></table>')
    cleaned = ocr_postprocess.clean(raw)
    norm = next(line for line in cleaned.split("\n") if "25.0" in line)
    assert norm.split() == ["—", "—", "25.0", "-", "31.0"]


def test_real_lab_report_html_table():
    """Реальный бланк из LiteParse 2.21: СОЭ + ОАК, шапка-колспан, примечание."""
    raw = (
        "Скорость оседания эритроцитов (CO3) Метод и оборудование: Капиллярная фотометрия\n"
        "<table>"
        "<tr><td>Скорость оседания</td><td>10 мМ/Ч</td><td>2 20</td></tr>"
        '<tr><td colspan="3">Общеклинический анализ крови с лейкоцитарной формулой</td></tr>'
        "<tr><td>Лейкоциты (WBC)</td><td>7.09 *1019/n</td><td>4.50 - 13.50</td></tr>"
        "<tr><td>Гемоглобин (HGB)</td><td>122 r/n</td><td>115 - 145</td></tr>"
        "</table>\n"
        "•Референсные значения приводятся с учетом возраста"
    )
    cleaned = ocr_postprocess.clean(raw)
    assert "(СОЭ)" in cleaned  # термин исправляется и вне таблицы
    assert "<table" not in cleaned
    assert "Общеклинический анализ крови с лейкоцитарной формулой" in cleaned.split("\n")
    wbc = next(line for line in cleaned.split("\n") if line.startswith("Лейкоциты"))
    assert wbc.split() == ["Лейкоциты", "(WBC)", "7.09", "*1019/л", "4.50", "-", "13.50"]
    hgb = next(line for line in cleaned.split("\n") if line.startswith("Гемоглобин"))
    assert "122 г/л" in hgb
    for number in ("10", "2 20", "7.09", "4.50 - 13.50", "122", "115 - 145"):
        assert number in cleaned


def test_html_table_cleaning_is_idempotent():
    raw = ("<table><tr><td>Показатель</td><td>Значение</td></tr>"
           "<tr><td>Hb</td><td>145 r/n</td></tr></table>")
    once = ocr_postprocess.clean(raw)
    assert ocr_postprocess.clean(once) == once


def test_markdown_noise_is_removed():
    raw = "# Анализ крови\n\n**Заключение:** норма.\n\n- пункт\n\n---\n"
    assert ocr_postprocess.clean(raw) == "Анализ крови\n\nЗаключение: норма.\n\n• пункт"


def test_broken_lines_are_joined():
    raw = "показатели в пре-\nделах нормы"
    assert ocr_postprocess.clean(raw) == "показатели в пределах нормы"


def test_blank_lines_are_collapsed():
    assert ocr_postprocess.clean("а\n\n\n\n\nб") == "а\n\nб"


def test_empty_and_whitespace_input():
    assert ocr_postprocess.clean("") == ""
    assert ocr_postprocess.clean("   \n\n  ") == ""


def test_idempotent():
    raw = "| Показатель | Значение |\n|---|---|\n| Hb | 145 r/n |"
    once = ocr_postprocess.clean(raw)
    assert ocr_postprocess.clean(once) == once


def test_analyze_reports_sizes_without_content():
    raw = "**Hb** 145 r/n"
    result = ocr_postprocess.analyze(raw)
    assert result == {"chars_raw": 14, "chars_clean": 10, "changed": True}
    assert "145" not in str(result)
