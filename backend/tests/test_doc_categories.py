"""Классификатор категорий документов и авто-названия по тексту OCR."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import doc_categories


class TestClassify:
    def test_blood_by_blank_header(self):
        text = "Общий анализ крови\n\nГемоглобин 145 г/л\nСОЭ 12 мм/ч"
        assert doc_categories.classify(text).key == "blood"

    def test_blood_by_components_only(self):
        # Без слова «анализ крови»: компоненты тоже указывают на категорию.
        assert doc_categories.classify("Лейкоциты 6.2, тромбоциты 250").key == "blood"

    def test_hormones(self):
        assert doc_categories.classify("Биохимический анализ: холестерин 5.2").key == "hormones"
        assert doc_categories.classify("ТТГ 2.1, витамин D 30").key == "hormones"

    def test_urine(self):
        assert doc_categories.classify("Общий анализ мочи, уробилиноген отриц.").key == "urine"

    def test_stool(self):
        assert doc_categories.classify("Копрограмма: кал без патологии").key == "stool"

    def test_smears(self):
        assert doc_categories.classify("Мазок на флору, цитологическое исследование").key == "smears"

    def test_imaging(self):
        assert doc_categories.classify("МРТ головного мозга").key == "imaging"
        assert doc_categories.classify("УЗИ брюшной полости").key == "imaging"

    def test_function(self):
        assert doc_categories.classify("ЭКГ: ритм синусовый").key == "function"
        assert doc_categories.classify("СМАД: суточное мониторирование давления").key == "function"

    def test_empty_and_irrelevant_are_other(self):
        assert doc_categories.classify("").key == "other"
        assert doc_categories.classify("Договор аренды помещения №42").key == "other"
        assert doc_categories.classify("Список покупок: хлеб, молоко").key == "other"

    def test_first_match_wins_by_dictionary_order(self):
        # «гемоглобин» (blood) стоит раньше «мочи» (urine) в словаре —
        # смешанный текст классифицируется по первой категории справочника.
        mixed = "Анализ мочи с примесью крови, гемоглобин повышен"
        assert doc_categories.classify(mixed).key == "blood"


class TestSuggestTitle:
    def test_first_meaningful_line(self):
        text = "Общеклинический анализ крови (СОЭ)\n\nГемоглобин 145 г/л"
        title = doc_categories.suggest_title(text, doc_categories.OTHER, "2026-11-27 10:00:00")
        assert title == "Общеклинический анализ крови (СОЭ)"

    def test_markdown_remnants_stripped(self):
        text = "# Общий анализ крови\n\n| Гемоглобин | 145 |"
        title = doc_categories.suggest_title(text, doc_categories.OTHER, "2026-11-27 10:00:00")
        assert title == "Общий анализ крови"

    def test_long_line_truncated_to_120(self):
        long_line = "Протокол лабораторного исследования " * 10  # > 120 символов
        title = doc_categories.suggest_title(long_line, doc_categories.OTHER, "")
        assert len(title) <= 120

    def test_fallback_with_formatted_date(self):
        title = doc_categories.suggest_title("", doc_categories.OTHER, "2026-11-27 09:30:00")
        assert title == "Прочее · 27.11.2026"

    def test_fallback_with_category_label(self):
        title = doc_categories.suggest_title("\n\n", doc_categories.DOC_CATEGORIES[0], "2026-11-27")
        assert title == "Кровь · 27.11.2026"

    def test_blank_lines_skipped(self):
        title = doc_categories.suggest_title("\n  \nЛист назначений\n正文", doc_categories.OTHER, "")
        assert title == "Лист назначений"

    def test_header_line_wins_over_first_line_on_reordered_ocr(self):
        # Стресс-тест реального бланка: OCR переставил блоки, настоящий
        # заголовок оказался в конце текста, а первой строкой стал «Бланк №…».
        text = (
            "Бланк № KJ-7742/26 Дата взятия: 27.11.2026\n\n"
            "Пациент: Тестов Тест Тестович, 1979 г.р.\n\n"
            "Показатель        Результат  Норма\n"
            "Гемоглобин (Hb)   118        120-140\n"
            "\n"
            "Клинический анализ крови (развёрнутый)\n\n"
            "Кровь из вены, EDTA."
        )
        title = doc_categories.suggest_title(text, doc_categories.OTHER, "2026-11-27")
        assert title == "Клинический анализ крови (развёрнутый)"

    def test_category_keyword_does_not_match_table_rows(self):
        # Ключ категории («гемоглобин») есть и в строках таблицы, которые в
        # переставленном OCR идут раньше заголовка — строка с цифрами не титул.
        text = (
            "Бланк № KJ-7742/26\n\n"
            "Гемоглобин (Hb)   118   120-140\n"
            "СОЭ               27    2-15\n"
            "\n"
            "Клинический анализ крови (развёрнутый)"
        )
        title = doc_categories.suggest_title(text, doc_categories.DOC_CATEGORIES[0], "2026-11-27")
        assert title == "Клинический анализ крови (развёрнутый)"
