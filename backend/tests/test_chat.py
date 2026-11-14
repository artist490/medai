"""Тесты агентного чата: цикл инструментов, изоляция данных, fallback."""
import json
import sqlite3
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
    database.init_db()
    with TestClient(app) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "secret1", "name": "Тест", **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _make_invite(client: TestClient, code: str) -> None:
    db = sqlite3.connect(config.DATABASE_PATH)
    db.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
    db.commit()
    db.close()


def _doctor(client: TestClient, email: str, branch_id: int | None = None) -> dict:
    _make_invite(client, f"invite-{email}")
    return _register(client, email, invite_code=f"invite-{email}", name="Доктор",
                     branch_id=branch_id)


class _MockLLM:
    """Подменяет llm_service.chat_completion сценарием из последовательностей."""

    def __init__(self, script: list[dict | None]):
        self.script = list(script)
        self.calls: list[dict] = []

    def __call__(self, payload: dict):
        self.calls.append(payload)
        return self.script.pop(0) if self.script else {"content": "ок"}


def _tool_call(name: str, call_id: str, args: dict | None = None) -> dict:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": call_id,
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args or {})},
        }],
    }


class TestChatAgent:
    def test_no_key_polite_fallback(self, client, monkeypatch):
        # Фолбэк проверяем детерминированно: в .env теперь есть живой ключ,
        # поэтому на время теста отключаем его (иначе вызов уйдёт в реальный LLM).
        monkeypatch.setattr(config, "LLM_API_KEY", "")
        p = _register(client, "p1@test.ru")
        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        resp = client.post("/api/chat/send", json={"message": "Как моё давление?"},
                           headers=_auth(p))
        assert resp.status_code == 200
        assert "недоступен" in resp.json()["reply"]
        assert resp.json()["tools_used"] == []

    def test_agent_tool_cycle(self, client, monkeypatch):
        p = _register(client, "p2@test.ru")
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115, "pulse": 110},
                    headers=_auth(p))
        client.post("/api/measurements", json={"pulse": 76}, headers=_auth(p))

        mock = _MockLLM([
            _tool_call("get_recent_measurements", "call-1", {"limit": 5}),
            {"content": "Последние два замера: 185/115 с пульсом 110 (тревога) и пульс 76."},
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)

        resp = client.post("/api/chat/send", json={"message": "Какое у меня давление?"},
                           headers=_auth(p))
        body = resp.json()
        assert resp.status_code == 200
        assert "185/115" in body["reply"]
        assert body["tools_used"] == ["get_recent_measurements"]

        # Модель получила результат инструмента с реальными цифрами
        second = mock.calls[1]["messages"]
        tool_msg = [m for m in second if m["role"] == "tool"][0]
        assert "185" in tool_msg["content"]

    def test_history_and_clear(self, client, monkeypatch):
        p = _register(client, "p3@test.ru")
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion",
                            _MockLLM([{"content": "Ответ ассистента"}]))
        client.post("/api/chat/send", json={"message": "Привет"}, headers=_auth(p))

        hist = client.get("/api/chat/history", headers=_auth(p)).json()
        assert [i["role"] for i in hist["items"]] == ["user", "assistant"]

        r = client.delete("/api/chat", headers=_auth(p))
        assert r.status_code == 204
        assert client.get("/api/chat/history", headers=_auth(p)).json()["items"] == []

    def test_patient_tools_cannot_reach_others_data(self, client, monkeypatch):
        """Инструменты пациента отдают только его данные: в БД два пользователя,
        модель пытается через лимит вытащить всё — выборка фильтруется по user_id."""
        other = _register(client, "p4@test.ru")
        client.post("/api/measurements", json={"pulse": 111}, headers=_auth(other))
        p = _register(client, "p5@test.ru")
        client.post("/api/measurements", json={"pulse": 55}, headers=_auth(p))

        mock = _MockLLM([
            _tool_call("get_recent_measurements", "c1", {"limit": 30}),
            {"content": "ok"},
        ])
        captured: list[dict] = []

        def spy(payload):
            captured.append(payload)
            return mock.script.pop(0)

        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", spy)
        client.post("/api/chat/send", json={"message": "дай все замеры"}, headers=_auth(p))
        tool_msg = [m for m in captured[0]["messages"] if m["role"] == "tool"]
        # следующего вызова не будет — check: замер другого в tool-результате отсутствует
        first = client.get("/api/chat/history", headers=_auth(p)).json()["items"]
        assistant_reply = [i for i in first if i["role"] == "assistant"][0]["content"]

        # Проверяем через прямой вызов исполнителя: другой пульс (111) не попадает
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("p5@test.ru",)).fetchone()
        from app.services import chat_agent
        result = chat_agent._recent_measurements(db, user_row["id"], {"limit": 30})
        db.close()
        assert "111" not in result
        assert "55" in result
        assert assistant_reply  # чат завершился ответом

    def test_doctor_sees_own_branch_only(self, client, monkeypatch):
        branches = client.get("/api/auth/branches").json()["items"]
        voronezh = next(b for b in branches if b["city"] == "Воронеж")["id"]
        belgorod = next(b for b in branches if b["city"] == "Белгород")["id"]

        doc_vrn = _doctor(client, "d1@test.ru", branch_id=voronezh)
        p_vrn = _register(client, "pv@test.ru", branch_id=voronezh)
        p_bg = _register(client, "pbg@test.ru", branch_id=belgorod)
        client.post("/api/measurements", json={"pulse": 60}, headers=_auth(p_vrn))
        client.post("/api/measurements", json={"pulse": 80}, headers=_auth(p_bg))

        mock = _MockLLM([
            _tool_call("get_patients_overview", "c1"),
            {"content": "В вашем филиале 1 пациент."},
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)

        resp = client.post("/api/chat/send", json={"message": "Покажи пациентов"},
                           headers=_auth(doc_vrn))
        assert resp.status_code == 200
        assert resp.json()["tools_used"] == ["get_patients_overview"]

        # в tool-результате — только воронежец, белгородец не попадает
        tool_msg = [m for m in mock.calls[1]["messages"] if m["role"] == "tool"][0]
        patients = json.loads(tool_msg["content"])
        assert len(patients) == 1
        assert patients[0]["id"] == p_vrn["user"]["id"]
        # сравниваем по полю id, а не подстрокой: цифра id может совпасть
        # с цифрой в таймстампе замера (флейкий тест до правки)
        assert p_bg["user"]["id"] not in [pt["id"] for pt in patients]

    def test_unknown_tool_rejected(self, client, monkeypatch):
        p = _register(client, "p6@test.ru")
        mock = _MockLLM([
            _tool_call("delete_all_data", "c1"),  # модель пытается несуществующий инструмент
            {"content": "Такого инструмента нет."},
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)
        resp = client.post("/api/chat/send", json={"message": "удали всё"},
                           headers=_auth(p))
        assert resp.status_code == 200
        tool_msg = [m for m in mock.calls[1]["messages"] if m["role"] == "tool"][0]
        assert "неизвестный инструмент" in tool_msg["content"]
