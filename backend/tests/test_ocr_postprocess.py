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
