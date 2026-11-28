"""Структурированные анализы (Д1—Д5): парсер показателей, хранение, тренд, чат.

Философия правил: распознаём только подтверждённые пары, остальное —
«не распознано»; цифры OCR не переписываются (инвариант 1049/л).
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import chat_agent, lab_parse, ocr


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "lab.db")
    monkeypatch.setattr(config, "OCR_ENABLED", False)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: False)
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    extra.setdefault("branch_id", 1)
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", "name": "Тест", **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _upload(c: TestClient, session: dict) -> dict:
    r = c.post("/api/documents", headers=_auth(session), files={
        "file": ("blank.png", io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    })
    assert r.status_code == 201, r.text
    return r.json()[0]


BLANK_MARKDOWN = (
    "| Показатель | Значение | Единицы | Норма |\n"
    "|---|---|---|---|\n"
    "| Гемоглобин | 145 | г/л | 130-160 |\n"
    "| Лейкоциты | 6.2 | 10^9/л | 4.0-9.0 |\n"
    "| СОЭ | 25 | мм/ч | до 15 |\n"
    "| Глюкоза | 6,1 | ммоль/л | до 5,5 |\n"
)


class TestLabParse:
    def test_markdown_table(self):
        result = lab_parse.parse(BLANK_MARKDOWN)
        assert result is not None
        by_key = {i["key"]: i for i in result["items"]}
        assert by_key["hemoglobin"]["value"] == 145 and by_key["hemoglobin"]["unit"] == "г/л"
        assert by_key["hemoglobin"]["status"] == "normal"
        assert by_key["leukocytes"]["unit"] == "10^9/л" and by_key["leukocytes"]["status"] == "normal"
        assert by_key["esr"]["status"] == "high" and by_key["esr"]["norm_high"] == 15
        assert by_key["glucose"]["value"] == 6.1 and by_key["glucose"]["status"] == "high"
        assert result["unparsed"] == 0

    def test_plain_line_with_parens(self):
        result = lab_parse.parse("Гемоглобин 118 г/л (120-150)")
        item = result["items"][0]
        assert item["key"] == "hemoglobin" and item["value"] == 118
        assert item["status"] == "low" and item["unit"] == "г/л"

    def test_word_boundary_ast_not_astma(self):
        result = lab_parse.parse("АСТ 35 Ед/л до 31\nАСТМА бронхиальная")
        assert [i["key"] for i in result["items"]] == ["ast"]
        assert result["items"][0]["norm_high"] == 31

    def test_stem_synonyms(self):
        # «Глюкозы 6.1» и «Лейкоциты 6.2» — основы слов
        result = lab_parse.parse("Глюкозы 6.1 ммоль/л\nЛейкоциты 6.2")
        assert {i["key"] for i in result["items"]} == {"glucose", "leukocytes"}

    def test_specific_cholesterol_beats_total(self):
        result = lab_parse.parse("Холестерин ЛПВП 1.2 ммоль/л >1.0")
        assert result["items"][0]["key"] == "hdl" and result["items"][0]["status"] == "normal"

    def test_1049_value_not_rewritten(self):
        """Инвариант: «1049/л» не переписывается в «10^9/л» — значение как есть."""
        result = lab_parse.parse("| Тромбоциты | 1049/л | | 180-320 |")
        item = result["items"][0]
        assert item["value"] == 1049 and item["status"] == "high"

    def test_unit_only_line_counts_unparsed(self):
        result = lab_parse.parse("Лейкоциты 10^9/л")
        assert result["items"] == [] and result["unparsed"] == 1

    def test_no_terms_is_none(self):
        assert lab_parse.parse("Просто текст без показателей") is None
        assert lab_parse.parse("") is None

    def test_value_not_taken_from_date(self):
        result = lab_parse.parse("2026-11-27 Гемоглобин 145 г/л")
        assert result["items"][0]["value"] == 145  # не 2026 из даты

    def test_store_json_marker_idempotent(self):
        stored = lab_parse.store_json(None)
        assert json.loads(stored) == {"items": [], "unparsed": 0}
        again = lab_parse.parse("Текст без показателей")
        assert lab_parse.store_json(again) == stored

    def test_lab_values_payload(self):
        assert lab_parse.lab_values_payload(None) is None
        assert lab_parse.lab_values_payload(lab_parse.EMPTY_RESULT) is None
        raw = json.dumps(lab_parse.parse(BLANK_MARKDOWN), ensure_ascii=False)
        assert lab_parse.lab_values_payload(raw) is not None


class TestLabValuesStorage:
    def test_worker_stores_lab_values(self, client, monkeypatch):
        owner = _register(client, "lab1@test.ru")
        doc = _upload(client, owner)
        monkeypatch.setattr(config, "OCR_ENABLED", True)
        monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
        monkeypatch.setattr(ocr, "_run_liteparse", lambda source: BLANK_MARKDOWN)
        ocr.enqueue(doc["id"])
        assert ocr.process_one(doc["id"]) is True

        items = client.get("/api/documents", headers=_auth(owner)).json()["items"]
        lab = items[0]["lab_values"]
        assert lab is not None and len(lab["items"]) == 4

    def test_backfill_is_idempotent(self, client):
        owner = _register(client, "lab2@test.ru")
        doc = _upload(client, owner)
        with database.db_session() as db:
            db.execute(
                "UPDATE documents SET ocr_status='ready', ocr_text_clean=? WHERE id=?",
                (BLANK_MARKDOWN, doc["id"]),
            )
        assert ocr.backfill_lab_values() == 1
        assert ocr.backfill_lab_values() == 0  # маркер не NULL — второй прогон ничего не ищет
        with database.db_session() as db:
            row = db.execute("SELECT lab_values FROM documents WHERE id=?", (doc["id"],)).fetchone()
        assert len(json.loads(row[0])["items"]) == 4


class TestLabTrend:
    def test_keys_and_trend_endpoint(self, client):
        owner = _register(client, "lab3@test.ru")
        for date, text in (
            ("2026-10-12 10:00:00", "Гемоглобин 118 г/л (120-150)"),
            ("2026-11-27 10:00:00", "Гемоглобин 145 г/л 130-160"),
            ("2026-11-27 10:00:00", "СОЭ 25 мм/ч до 15"),
        ):
            doc = _upload(client, owner)
            with database.db_session() as db:
                db.execute(
                    "UPDATE documents SET ocr_status='ready', ocr_text_clean=?, uploaded_at=? WHERE id=?",
                    (text, date, doc["id"]),
                )
        assert ocr.backfill_lab_values() == 3

        keys = client.get("/api/documents/lab-keys", headers=_auth(owner)).json()["items"]
        assert {k["key"] for k in keys} == {"hemoglobin", "esr"}

        trend = client.get("/api/documents/lab-trend?key=hemoglobin", headers=_auth(owner)).json()
        assert trend["label"] == "Гемоглобин"
        assert [p["value"] for p in trend["items"]] == [118, 145]  # по датам

    def test_unknown_key_422(self, client):
        owner = _register(client, "lab4@test.ru")
        r = client.get("/api/documents/lab-trend?key=мозг", headers=_auth(owner))
        assert r.status_code == 422

    def test_trend_is_private(self, client):
        owner = _register(client, "lab5@test.ru")
        doc = _upload(client, owner)
        with database.db_session() as db:
            db.execute(
                "UPDATE documents SET ocr_status='ready', ocr_text_clean=? WHERE id=?",
                ("Гемоглобин 145 г/л 130-160", doc["id"]),
            )
        ocr.backfill_lab_values()
        other = _register(client, "lab6@test.ru")
        trend = client.get("/api/documents/lab-trend?key=hemoglobin", headers=_auth(other)).json()
        assert trend["items"] == []
        keys = client.get("/api/documents/lab-keys", headers=_auth(other)).json()["items"]
        assert keys == []


class TestChatLabTools:
    def _prepare(self, client) -> tuple[dict, int, int]:
        owner = _register(client, "lab7@test.ru")
        docs = []
        for text in ("Гемоглобин 118 г/л (120-150)", "Гемоглобин 145 г/л 130-160"):
            doc = _upload(client, owner)
            with database.db_session() as db:
                db.execute(
                    "UPDATE documents SET ocr_status='ready', ocr_text_clean=?, lab_values=? WHERE id=?",
                    (text, lab_parse.store_json(lab_parse.parse(text)), doc["id"]),
                )
            docs.append(doc["id"])
        with database.db_session() as db:
            row = db.execute("SELECT id FROM users WHERE email=?", ("lab7@test.ru",)).fetchone()
            user = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
        return user, docs[0], docs[1]

    def test_my_lab_values_latest(self, client):
        user, doc1, doc2 = self._prepare(client)
        with database.db_session() as db:
            result = json.loads(chat_agent._my_lab_values(db, user, {}))
        assert {i["key"] for i in result["items"]} == {"hemoglobin"}
        item = result["items"][0]
        assert item["value"] in (118, 145)  # последнее значение — из свежего документа

    def test_my_lab_values_history_by_key(self, client):
        user, doc1, doc2 = self._prepare(client)
        with database.db_session() as db:
            result = json.loads(chat_agent._my_lab_values(db, user, {"key": "hemoglobin"}))
        assert result["label"] == "Гемоглобин"
        assert [i["value"] for i in result["items"]] == [145, 118]  # новые сверху

    def test_compare_documents(self, client):
        user, doc1, doc2 = self._prepare(client)
        with database.db_session() as db:
            result = json.loads(chat_agent._compare_lab_documents(
                db, user, {"document_id_1": doc1, "document_id_2": doc2}))
        assert result["items"][0]["v1"] == 118 and result["items"][0]["v2"] == 145
        assert result["items"][0]["delta"] == 27

    def test_compare_rejects_foreign_document(self, client):
        user, doc1, _ = self._prepare(client)
        other = _register(client, "lab8@test.ru")
        foreign = _upload(client, other)
        with database.db_session() as db:
            result = json.loads(chat_agent._compare_lab_documents(
                db, user, {"document_id_1": doc1, "document_id_2": foreign["id"]}))
        assert "error" in result

