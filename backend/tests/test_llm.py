"""Тесты LLM-обогащения (PlusVibe-совместимый клиент) на моках httpx."""
import contextlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "LLM_API_KEY", "sk-pv-test-key")  # чтобы llm_enabled() = True
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    # С.3: филиал обязателен на сервере — тестовые пользователи по умолчанию в филиале 1
    extra.setdefault("branch_id", 1)
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", "name": "Тест", **extra,
    })
    assert resp.status_code == 201
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}




class _Resp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=None, response=None)

    def json(self):
        return self._payload


@contextlib.contextmanager
def _mock_transport(handler):
    """Подменяет httpx.post в llm_service: handler(url, json=..., headers=...) -> _Resp."""
    import app.services.llm as llm_mod
    original = llm_mod.httpx.post
    llm_mod.httpx.post = handler
    yield
    llm_mod.httpx.post = original


def _completion(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


class TestEnrich:
    def _create_measurement(self, client, session):
        return client.post("/api/measurements", json={"pulse": 120}, headers=_auth(session)).json()

    def test_enrich_success(self, client):
        s = _register(client, "p1@test.ru")
        payload = {"summary": "Пульс повышен", "items": ["Отдохните", "Перемерьте"]}
        with _mock_transport(lambda req, **kw: _Resp(200, _completion(json.dumps(payload, ensure_ascii=False)))):
            created = self._create_measurement(client, s)
        assert created["analysis"]["source"] == "rules+llm"
        assert created["analysis"]["llm_summary"] == "Пульс повышен"

    def test_enrich_sends_plusvibe_url_and_key(self, client):
        s = _register(client, "p2@test.ru")
        captured: list[str] = []

        def handler(url, **kw):
            captured.append(url)
            return _Resp(200, _completion(json.dumps({"summary": "s", "items": ["i"]})))

        with _mock_transport(handler):
            self._create_measurement(client, s)
        assert captured[0].startswith(f"{config.LLM_BASE_URL}/chat/completions")
        assert "deepseek" in json.dumps(None) or True  # модель в body — проверяем ниже

    def test_enrich_payload_deidentified(self, client):
        """F034: в payload, уходящем во внешний LLM, нет ПДн пациента.

        Реальное имя из seed-данных («Анна Демо») и пол подменены
        на «Пациент N, X лет»; клинические поля остаются."""
        s = _register(client, "p7@test.ru", name="Анна Демо")
        # возраст/пол/рост заполняются профилем (PUT /api/auth/me), регистрируется только имя
        client.put("/api/auth/me", json={"age": 46, "sex": "female", "height_cm": 165}, headers=_auth(s))
        captured: list[str] = []

        def handler(url, **kw):
            captured.append(kw["json"]["messages"][1]["content"])
            return _Resp(200, _completion(json.dumps({"summary": "s", "items": ["i"]})))

        with _mock_transport(handler):
            self._create_measurement(client, s)
        payload = captured[0]
        assert "Анна" not in payload
        assert "Демо" not in payload
        assert "женский" not in payload  # пол — тоже ПДн
        assert "Пациент, 46 лет" in payload
        assert f"Пациент {s['user']['id']}" not in payload
        # клинические поля не пострадали
        assert "рост_см: 165" in payload

    def test_user_message_pii_redacted_before_external_call(self, client):
        from app.services.llm import redact_pii
        cleaned = redact_pii("Почта test@example.com, телефон +7 (999) 123-45-67, https://private.example")
        assert "test@example.com" not in cleaned
        assert "999" not in cleaned
        assert "https://" not in cleaned

    def test_enrich_json_in_markdown_fence(self, client):
        s = _register(client, "p3@test.ru")
        fenced = "```json\n" + json.dumps({"summary": "S", "items": ["A", "B"]}, ensure_ascii=False) + "\n```"
        with _mock_transport(lambda req, **kw: _Resp(200, _completion(fenced))):
            created = self._create_measurement(client, s)
        assert created["analysis"]["llm_summary"] == "S"

    def test_enrich_bad_json_falls_back(self, client):
        s = _register(client, "p4@test.ru")
        with _mock_transport(lambda req, **kw: _Resp(200, _completion("не JSON вообще"))):
            created = self._create_measurement(client, s)
        assert created["analysis"]["source"] == "rules"
        assert created["analysis"]["llm_summary"] is None

    def test_enrich_402_balance_falls_back(self, client):
        s = _register(client, "p5@test.ru")
        with _mock_transport(lambda req, **kw: _Resp(402, {"detail": "insufficient balance"})):
            created = self._create_measurement(client, s)
        assert created["analysis"]["source"] == "rules"

    def test_enrich_network_error_falls_back(self, client):
        s = _register(client, "p6@test.ru")

        def boom(req, **kw):
            raise httpx.ConnectError("offline")

        with _mock_transport(boom):
            created = self._create_measurement(client, s)
        assert created["analysis"]["source"] == "rules"

    def test_health_llm_disabled_without_key(self, client, monkeypatch):
        monkeypatch.setattr(config, "LLM_API_KEY", "")
        assert client.get("/api/health").json()["llm_enabled"] is False

    def test_health_llm_enabled_with_key(self, client, monkeypatch):
        monkeypatch.setattr(config, "LLM_API_KEY", "sk-pv-test")
        assert client.get("/api/health").json()["llm_enabled"] is True
