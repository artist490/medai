"""Тесты ИИ-сводки пациента для врача: успех на моке, 503 без LLM, гвард филиала."""
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
    monkeypatch.setattr(config, "LLM_API_KEY", "sk-pv-test-key")
    database.init_db()
    with TestClient(app) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    # С.3: филиал обязателен на сервере — тестовые пользователи по умолчанию в филиале 1
    extra.setdefault("branch_id", 1)
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "secret1", "name": "Тест", **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _make_invite(client: TestClient, code: str) -> None:
    import sqlite3
    db = sqlite3.connect(config.DATABASE_PATH)
    db.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
    db.commit()
    db.close()


def _doctor(client: TestClient, code: str, email: str, **extra) -> dict:
    _make_invite(client, code)
    return _register(client, email, invite_code=code, **extra)


class _Resp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _completion(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


class TestSummary:
    def _setup(self, client: TestClient):
        d = _doctor(client, "invite-s-1", "d1@test.ru", branch_id=1)
        p = _register(client, "p1@test.ru", branch_id=1, name="Анна Петровна")
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115}, headers=_auth(p))
        client.post("/api/visits", json={"complaints": "Давление подскочило"},
                    headers=_auth(p))
        return d, p

    def test_summary_success_on_mock(self, client, monkeypatch):
        d, p = self._setup(client)
        import app.services.llm as llm_mod
        seen = {}

        def handler(url, **kw):
            seen["payload"] = kw["json"]["messages"][1]["content"]
            return _Resp(_completion("Пациентка с гипертоническим кризом в анамнезе замера."))

        monkeypatch.setattr(llm_mod.httpx, "post", handler)
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(d))
        assert resp.status_code == 200, resp.text
        assert "гипертоническим" in resp.json()["summary"]
        # В промпт попали жалобы, замер с тревогой и данные пациента
        assert "Давление подскочило" in seen["payload"]
        assert "185" in seen["payload"]
        assert "ТРЕВОГА" in seen["payload"]
        # F034: реальное имя пациента в LLM не уходит
        assert "Анна Петровна" not in seen["payload"]
        assert f"Пациент {p['user']['id']}" in seen["payload"]

    def test_summary_payload_deidentified(self, client, monkeypatch):
        """F034: имя/пол/возраст подменяются на «Пациент N, X лет», клиника остаётся."""
        d = _doctor(client, "invite-s-5", "d5@test.ru", branch_id=1)
        p = _register(client, "p5@test.ru", branch_id=1, name="Анна Демо")
        # возраст/пол заполняются профилем (PUT /api/auth/me), регистрируется только имя
        client.put("/api/auth/me", json={"age": 46, "sex": "female"}, headers=_auth(p))
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115}, headers=_auth(p))
        client.post("/api/visits", json={"complaints": "Давление подскочило"}, headers=_auth(p))

        import app.services.llm as llm_mod
        seen = {}

        def handler(url, **kw):
            seen["payload"] = kw["json"]["messages"][1]["content"]
            return _Resp(_completion("Справка."))

        monkeypatch.setattr(llm_mod.httpx, "post", handler)
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(d))
        assert resp.status_code == 200
        payload = seen["payload"]
        assert "Анна" not in payload
        assert "Демо" not in payload
        assert "женский" not in payload  # пол — тоже ПДн
        assert f"Пациент {p['user']['id']}, 46 лет" in payload
        # клинические поля не пострадали
        assert "Давление подскочило" in payload
        assert "Анамнез" in payload
        assert "185" in payload

    def test_summary_503_when_llm_down(self, client, monkeypatch):
        d, p = self._setup(client)
        import app.services.llm as llm_mod

        def broken(url, **kw):
            raise httpx.ConnectError("no network")

        monkeypatch.setattr(llm_mod.httpx, "post", broken)
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(d))
        assert resp.status_code == 503

    def test_summary_other_branch_404(self, client):
        d1 = _doctor(client, "invite-s-2", "d2@test.ru", branch_id=1)
        _doctor(client, "invite-s-3", "d3@test.ru", branch_id=2)
        p = _register(client, "p2@test.ru", branch_id=2)
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(d1))
        assert resp.status_code == 404

    def test_summary_patient_forbidden(self, client):
        p = _register(client, "p3@test.ru")
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(p))
        assert resp.status_code == 403

    def test_summary_includes_survey_answers(self, client, monkeypatch):
        """Тревожные ответы опросника МЗ попадают в промпт сводки."""
        d = _doctor(client, "invite-s-4", "d4@test.ru", branch_id=1)
        p = _register(client, "p4@test.ru", branch_id=1)
        survey = '{"dx_hypertension": true, "sym_hemoptysis": true, "alcohol_freq": 3, "alcohol_portions": 2, "alcohol_binge": 1}'
        client.put("/api/medcard", json={"survey": survey}, headers=_auth(p))

        import app.services.llm as llm_mod
        seen = {}

        def handler(url, **kw):
            seen["payload"] = kw["json"]["messages"][1]["content"]
            return _Resp(_completion("Справка."))

        monkeypatch.setattr(llm_mod.httpx, "post", handler)
        resp = client.post(f"/api/doctor/patients/{p['user']['id']}/summary", headers=_auth(d))
        assert resp.status_code == 200
        payload = seen["payload"]
        assert "кровохарканье" in payload
        assert "гипертоническая болезнь" in payload
        assert "AUDIT-C" in payload
