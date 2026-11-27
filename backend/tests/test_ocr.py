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
    return r.json()


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
