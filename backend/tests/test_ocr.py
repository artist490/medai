"""Серверный OCR: очередь, доступ, результат, ошибки и отсутствие внешнего API."""
import io

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import ocr


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "ocr.db")
    monkeypatch.setattr(config, "OCR_ENABLED", False)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: False)
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c
    # fixture autouse восстановит флаг; worker остановлен общим conftest.


def _register(c, email):
    r = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", "name": "Тест", "branch_id": 1,
    })
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _upload(c, headers):
    r = c.post("/api/documents", headers=headers, files={
        "file": ("analysis.png", io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    })
    assert r.status_code == 201, r.text
    return r.json()[0]  # мультизагрузка: ответ — список, здесь один файл


def test_ocr_disabled_and_private(client):
    owner = _register(client, "ocr-owner@test.ru")
    doc = _upload(client, owner)
    assert doc["ocr"]["status"] == "disabled"
    assert client.post(f"/api/documents/{doc['id']}/ocr", headers=owner).status_code == 503
    other = _register(client, "ocr-other@test.ru")
    assert client.get(f"/api/documents/{doc['id']}/ocr", headers=other).status_code == 404


def test_worker_success_and_text_access(client, monkeypatch):
    owner = _register(client, "ocr-success@test.ru")
    doc = _upload(client, owner)
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    raw = "| Показатель | Значение |\n|---|---|\n| Hb | 145 r/n |"
    monkeypatch.setattr(ocr, "_run_liteparse", lambda source: raw)
    assert client.post(f"/api/documents/{doc['id']}/ocr", headers=owner).status_code == 202
    assert ocr.process_one(doc["id"]) is True
    result = client.get(f"/api/documents/{doc['id']}/ocr", headers=owner).json()
    assert result["status"] == "ready"
    # Пользователь видит очищенный текст: таблица выровнена, единицы исправлены.
    assert result["text"] == "Показатель  Значение\nHb          145 г/л"
    # Исходный ответ OCR сохраняется без изменений — постобработка ничего не теряет.
    assert result["text_raw"] == raw
    # Повторный клик не запускает новую платную/тяжёлую задачу.
    assert client.post(f"/api/documents/{doc['id']}/ocr", headers=owner).status_code == 202
    assert ocr.process_one(doc["id"]) is False
    ready_again = client.post(f"/api/documents/{doc['id']}/ocr", headers=owner).json()
    assert ready_again["text"] == result["text"]


def test_postprocessed_text_is_persisted(client, monkeypatch):
    """Постобработка считается один раз и сохраняется в БД, а не на каждый запрос."""
    owner = _register(client, "ocr-persist@test.ru")
    doc = _upload(client, owner)
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    monkeypatch.setattr(ocr, "_run_liteparse", lambda source: "# Итог\n\nHb 145 r/n")
    ocr.enqueue(doc["id"])
    assert ocr.process_one(doc["id"]) is True
    with database.db_session() as db:
        row = db.execute(
            "SELECT ocr_text, ocr_text_clean FROM documents WHERE id=?", (doc["id"],)
        ).fetchone()
    assert row["ocr_text"] == "# Итог\n\nHb 145 r/n"
    assert row["ocr_text_clean"] == "Итог\n\nHb 145 г/л"


def test_backfill_cleans_legacy_documents(client, monkeypatch):
    """Документы, распознанные до постобработки, получают очищенный текст."""
    owner = _register(client, "ocr-backfill@test.ru")
    doc = _upload(client, owner)
    with database.db_session() as db:
        db.execute(
            "UPDATE documents SET ocr_status='ready', ocr_text=?, ocr_text_clean=NULL WHERE id=?",
            ("**Hb** 145 r/n", doc["id"]),
        )
    assert ocr.backfill_postprocessed() >= 1
    with database.db_session() as db:
        row = db.execute(
            "SELECT ocr_text_clean FROM documents WHERE id=?", (doc["id"],)
        ).fetchone()
    assert row["ocr_text_clean"] == "Hb 145 г/л"
    # Идемпотентно: второй прогон ничего не переписывает.
    assert ocr.backfill_postprocessed() == 0


def test_worker_failure_is_safe_and_retryable(client, monkeypatch):
    owner = _register(client, "ocr-failed@test.ru")
    doc = _upload(client, owner)
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    monkeypatch.setattr(ocr, "_run_liteparse", lambda *_: (_ for _ in ()).throw(RuntimeError("Нечитаемый документ")))
    ocr.enqueue(doc["id"])
    ocr.process_one(doc["id"])
    result = client.get(f"/api/documents/{doc['id']}/ocr", headers=owner).json()
    assert result["status"] == "failed"
    assert result["error"] == "Нечитаемый документ"
    assert "temp" not in result["error"].lower()
    assert "stderr" not in result["error"].lower()
    assert result.get("text") is None
    assert ocr.enqueue(doc["id"], user_id=1) is True


def test_ocr_ownership_cannot_be_bypassed(client, monkeypatch):
    owner = _register(client, "ocr-right@test.ru")
    doc = _upload(client, owner)
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    assert ocr.enqueue(doc["id"], user_id=999999) is False
    result = client.get(f"/api/documents/{doc['id']}/ocr", headers=owner).json()
    assert result["status"] == "disabled"


def test_interrupted_job_recovers(client, monkeypatch):
    owner = _register(client, "ocr-recover@test.ru")
    doc = _upload(client, owner)
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    ocr.enqueue(doc["id"])
    with database.db_session() as db:
        db.execute("UPDATE documents SET ocr_status='processing' WHERE id=?", (doc["id"],))
    ocr.recover_interrupted()
    result = client.get(f"/api/documents/{doc['id']}/ocr", headers=owner).json()
    assert result["status"] == "pending"


# ---------- Категоризация и авто-названия (DOC_CATEGORIES_PLAN.md) ----------

BLANK_MARKDOWN = (
    "# Общий анализ крови\n\n| Показатель | Значение |\n"
    "|---|---|\n| Гемоглобин | 145 г/л |\n| СОЭ | 12 мм/ч |"
)


def test_upload_title_source_and_auto_enqueue(client):
    """Пустое название → title_source='auto'; ручное → 'user' и не перезаписывается."""
    owner = _register(client, "ocr-titles@test.ru")
    auto = _upload(client, owner)
    assert auto["title_source"] == "auto"
    r = client.post("/api/documents", headers=owner, files={
        "file": ("scan.png", io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    }, data={"title": "Моё название"})
    assert r.status_code == 201
    manual = r.json()[0]  # мультизагрузка: ответ — список
    assert manual["title_source"] == "user"
    assert manual["title"] == "Моё название"


def test_worker_classifies_and_titled_auto(client, monkeypatch):
    """После OCR: категория по бланку, авто-название — заголовок бланка."""
    owner = _register(client, "ocr-classify@test.ru")
    doc = _upload(client, owner)
    assert doc["title_source"] == "auto"
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    monkeypatch.setattr(ocr, "_run_liteparse", lambda source: BLANK_MARKDOWN)
    ocr.enqueue(doc["id"])
    assert ocr.process_one(doc["id"]) is True
    with database.db_session() as db:
        row = db.execute("SELECT category, title FROM documents WHERE id=?", (doc["id"],)).fetchone()
    assert row["category"] == "blood"
    assert row["title"] == "Общий анализ крови"


def test_worker_keeps_user_title(client, monkeypatch):
    """Ручное название переживает OCR; категория всё равно выставляется."""
    owner = _register(client, "ocr-keep@test.ru")
    r = client.post("/api/documents", headers=owner, files={
        "file": ("scan.png", io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    }, data={"title": "Ручное название"})
    assert r.status_code == 201
    doc = r.json()[0]  # мультизагрузка: ответ — список
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
    monkeypatch.setattr(ocr, "_run_liteparse", lambda source: BLANK_MARKDOWN)
    ocr.enqueue(doc["id"])
    assert ocr.process_one(doc["id"]) is True
    with database.db_session() as db:
        row = db.execute("SELECT category, title, title_source FROM documents WHERE id=?", (doc["id"],)).fetchone()
    assert row["category"] == "blood"
    assert row["title"] == "Ручное название"
    assert row["title_source"] == "user"


def test_backfill_categories_is_idempotent(client, monkeypatch):
    """Готовые до внедрения документы получают категорию и (auto) название."""
    owner = _register(client, "ocr-backcat@test.ru")
    doc = _upload(client, owner)
    with database.db_session() as db:
        db.execute(
            "UPDATE documents SET ocr_status='ready', ocr_text_clean=? WHERE id=?",
            ("Общий анализ крови\n\nГемоглобин 145 г/л", doc["id"]),
        )
    assert ocr.backfill_categories() == 1
    with database.db_session() as db:
        row = db.execute("SELECT category, title FROM documents WHERE id=?", (doc["id"],)).fetchone()
    assert row["category"] == "blood"
    assert row["title"] == "Общий анализ крови"
    # Идемпотентно: второй прогон ничего не находит.
    assert ocr.backfill_categories() == 0


def test_backfill_categories_keeps_user_title(client, monkeypatch):
    owner = _register(client, "ocr-backcat2@test.ru")
    r = client.post("/api/documents", headers=owner, files={
        "file": ("scan.png", io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    }, data={"title": "Мой бланк"})
    assert r.status_code == 201
    doc = r.json()[0]  # мультизагрузка: ответ — список
    with database.db_session() as db:
        db.execute(
            "UPDATE documents SET ocr_status='ready', ocr_text_clean=? WHERE id=?",
            ("МРТ головного мозга", doc["id"]),
        )
    assert ocr.backfill_categories() == 1
    with database.db_session() as db:
        row = db.execute("SELECT category, title FROM documents WHERE id=?", (doc["id"],)).fetchone()
    assert row["category"] == "imaging"
    assert row["title"] == "Мой бланк"


# ---------- Ручная правка названия и категории (PATCH /api/documents/{id}) ----------

class TestDocumentEdit:
    def test_rename_sets_user_source_and_survives_ocr(self, client, monkeypatch):
        owner = _register(client, "edit-rename@test.ru")
        doc = _upload(client, owner)
        assert doc["title_source"] == "auto"
        resp = client.patch(f"/api/documents/{doc['id']}",
                            json={"title": "Правильное название"}, headers=owner)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "Правильное название"
        assert body["title_source"] == "user"

        monkeypatch.setattr(config, "OCR_ENABLED", True)
        monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
        monkeypatch.setattr(ocr, "_run_liteparse", lambda source: BLANK_MARKDOWN)
        ocr.enqueue(doc["id"])
        assert ocr.process_one(doc["id"]) is True
        with database.db_session() as db:
            row = db.execute("SELECT title, title_source, category FROM documents WHERE id=?", (doc["id"],)).fetchone()
        assert row["title"] == "Правильное название"
        assert row["title_source"] == "user"
        assert row["category"] == "blood"

    def test_category_change_and_reclassify(self, client, monkeypatch):
        owner = _register(client, "edit-cat@test.ru")
        doc = _upload(client, owner)
        r = client.patch(f"/api/documents/{doc['id']}", json={"category": "imaging"}, headers=owner)
        assert r.status_code == 200
        assert r.json()["category"] == "imaging"

        # Готовим распознанный текст и сбрасываем категорию — сервер
        # переклассифицирует по нему прямо в PATCH.
        monkeypatch.setattr(config, "OCR_ENABLED", True)
        monkeypatch.setattr(config, "_ocr_model_installed", lambda: True)
        monkeypatch.setattr(ocr, "_run_liteparse", lambda source: BLANK_MARKDOWN)
        ocr.enqueue(doc["id"])
        assert ocr.process_one(doc["id"]) is True

        r = client.patch(f"/api/documents/{doc['id']}", json={"category": ""}, headers=owner)
        assert r.status_code == 200
        assert r.json()["category"] == "blood"

    def test_unknown_category_and_empty_title_rejected(self, client):
        owner = _register(client, "edit-bad@test.ru")
        doc = _upload(client, owner)
        assert client.patch(f"/api/documents/{doc['id']}",
                            json={"category": "космос"}, headers=owner).status_code == 422
        assert client.patch(f"/api/documents/{doc['id']}",
                            json={"title": "   "}, headers=owner).status_code == 422
        assert client.patch(f"/api/documents/{doc['id']}", json={}, headers=owner).status_code == 422

    def test_other_user_cannot_edit(self, client):
        owner = _register(client, "edit-owner@test.ru")
        doc = _upload(client, owner)
        stranger = _register(client, "edit-stranger@test.ru")
        assert client.patch(f"/api/documents/{doc['id']}",
                            json={"title": "чужое"}, headers=stranger).status_code == 404
