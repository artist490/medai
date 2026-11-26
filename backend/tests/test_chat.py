"""Тесты агентного чата: цикл инструментов, изоляция данных, fallback."""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import chat_agent


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "test.db")
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    # С.3: филиал обязателен на сервере — тестовые пользователи по умолчанию в филиале 1
    extra.setdefault("branch_id", 1)
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", "name": "Тест", **extra,
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
    extra = {"invite_code": f"invite-{email}", "name": "Доктор"}
    if branch_id is not None:
        extra["branch_id"] = branch_id  # иначе _register подставит филиал по умолчанию
    return _register(client, email, **extra)


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
        assert patients[0]["id"] == chat_agent._anonymous_patient_id(p_vrn["user"]["id"])
        # сравниваем по полю id, а не подстрокой: цифра id может совпасть
        # с цифрой в таймстампе замера (флейкий тест до правки)
        assert chat_agent._anonymous_patient_id(p_bg["user"]["id"]) not in [pt["id"] for pt in patients]

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

    def test_tool_loop_forced_to_answer(self, client, monkeypatch):
        """Модель зациклилась на инструментах (6 раундов) — агент принудительно
        запрашивает финальный ответ без инструментов (chat_agent.py:302-311)."""
        from app.services import chat_agent

        p = _register(client, "p7@test.ru")
        mock = _MockLLM([
            _tool_call("get_recent_measurements", f"c{i}", {"limit": 1})
            for i in range(chat_agent.MAX_TOOL_ROUNDS)
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)

        resp = client.post("/api/chat/send", json={"message": "дай данные"},
                           headers=_auth(p))
        body = resp.json()
        assert resp.status_code == 200
        assert len(body["tools_used"]) == chat_agent.MAX_TOOL_ROUNDS
        assert body["reply"]  # финальный вызов без инструментов вернул ответ
        # Последний запрос модели не содержит tools — форс-подсказка подмешана
        last_user_msgs = [m for m in mock.calls[-1]["messages"] if m["role"] == "user"]
        assert any("без вызовов инструментов" in m["content"] for m in last_user_msgs)

    def test_chat_rate_limited(self, client, monkeypatch):
        """Платный LLM-чат ограничен по частоте (F002): сверх лимита — 429."""
        from app.routers import chat as chat_router

        p = _register(client, "p8@test.ru")
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion",
                            _MockLLM([{"content": "ответ"}]))
        monkeypatch.setattr(chat_router, "_CHAT_SENDS", {})
        monkeypatch.setattr(chat_router, "CHAT_MAX_SENDS", 2)

        for _ in range(2):
            resp = client.post("/api/chat/send", json={"message": "привет"},
                               headers=_auth(p))
            assert resp.status_code == 200
        resp = client.post("/api/chat/send", json={"message": "ещё"},
                           headers=_auth(p))
        assert resp.status_code == 429
        # Лимит пер-пользовательский: другой пациент не заблокирован
        other = _register(client, "p9@test.ru")
        resp = client.post("/api/chat/send", json={"message": "моё первое"},
                           headers=_auth(other))
        assert resp.status_code == 200

    def test_offtopic_rule_in_system_prompt(self, client, monkeypatch):
        """Посторонние темы: ассистенту жёстко предписано отвечать только
        по здоровью/медицине — правило должно быть в системном промпте,
        а отказ модели доходит пациенту без изменений."""
        refusal = ("Я ассистент здоровья и обсуждаю только вопросы здоровья. "
                   "Расскажите, какие показатели вас беспокоят?")
        mock = _MockLLM([{"content": refusal}])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)

        p = _register(client, "p10@test.ru")
        resp = client.post("/api/chat/send", json={"message": "Напиши код на Python"},
                           headers=_auth(p))
        assert resp.status_code == 200
        assert resp.json()["reply"] == refusal

        # Правило об ограничении тем — в системном промпте (и у пациента, и у врача)
        system = mock.calls[0]["messages"][0]["content"]
        assert "ТОЛЬКО темы здоровья и медицины" in system
        assert "вежливо откажись" in system
        for prompt in (chat_agent.SYSTEM_PROMPT_PATIENT, chat_agent.SYSTEM_PROMPT_DOCTOR):
            assert "ТОЛЬКО темы здоровья и медицины" in prompt


class TestPatientToolsExtended:
    """Уровень 1: ассистент пациента видит свою медкарту, приёмы, заметки
    врача, цели и документы — данные уже в БД, но инструментов не было."""

    def test_my_medcard(self, client, monkeypatch):
        p = _register(client, "mc1@test.ru")
        client.put("/api/medcard", json={"blood_type": "II Rh+", "allergies": "пенициллин"},
                   headers=_auth(p))
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("mc1@test.ru",)).fetchone()
        result = json.loads(chat_agent._my_medcard(db, user_row, {}))
        db.close()
        assert result["blood_type"] == "II Rh+"
        assert "пенициллин" in result["allergies"]

    def test_my_medcard_empty_is_honest(self, client):
        _register(client, "mc2@test.ru")
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("mc2@test.ru",)).fetchone()
        result = json.loads(chat_agent._my_medcard(db, user_row, {}))
        db.close()
        assert "error" in result
        assert "медкарта не заполнена" in result["error"].lower()

    def test_my_visits(self, client):
        p = _register(client, "v1@test.ru")
        client.post("/api/visits", json={"visit_date": "2026-12-01", "reason": "Давление",
                                        "complaints": "Болит голова"}, headers=_auth(p))
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("v1@test.ru",)).fetchone()
        rows = json.loads(chat_agent._my_visits(db, user_row, {}))
        db.close()
        assert len(rows) == 1
        assert rows[0]["reason"] == "Давление"

    def test_doctor_notes_for_my_analyses(self, client):
        p = _register(client, "n1@test.ru")
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115}, headers=_auth(p))
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("n1@test.ru",)).fetchone()
        analysis = db.execute("SELECT id FROM analyses WHERE user_id = ?",
                              (user_row["id"],)).fetchone()
        db.execute("""INSERT INTO doctor_notes (analysis_id, doctor_id, doctor_name, text)
                      VALUES (?, ?, ?, ?)""",
                   (analysis["id"], user_row["id"], "Доктор Тест", "Следите за давлением"))
        db.commit()
        rows = json.loads(chat_agent._doctor_notes(db, user_row, {}))
        db.close()
        assert len(rows) == 1
        assert "Следите за давлением" in rows[0]["text"]

    def test_my_goals(self, client):
        p = _register(client, "g1@test.ru")
        client.put("/api/goals", json={"steps": 8000, "sleep": 8}, headers=_auth(p))
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("g1@test.ru",)).fetchone()
        result = json.loads(chat_agent._my_goals(db, user_row, {}))
        db.close()
        assert result["steps"] == 8000
        assert result["sleep"] == 8

    def test_my_documents_metadata_only(self, client):
        """Документы: только метаданные, содержимое файла модели не отдаём."""
        _register(client, "d1@test.ru")
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("d1@test.ru",)).fetchone()
        db.execute("""INSERT INTO documents (user_id, title, filename, mime, size, data)
                      VALUES (?, ?, ?, ?, ?, ?)""",
                   (user_row["id"], "МРТ головы", "mrt.pdf", "application/pdf", 1024, b"x" * 1024))
        db.commit()
        rows = json.loads(chat_agent._my_documents(db, user_row, {}))
        db.close()
        assert len(rows) == 1
        assert rows[0]["title"] == "МРТ головы"
        assert "data" not in rows[0]

    def test_search_measurements_by_period(self, client):
        p = _register(client, "s1@test.ru")
        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        from app.database import connect
        db = connect()
        user_row = db.execute("SELECT * FROM users WHERE email = ?", ("s1@test.ru",)).fetchone()
        found = json.loads(chat_agent._search_measurements(
            db, user_row, {"date_from": "2020-01-01", "date_to": "2099-12-31"}))
        missed = json.loads(chat_agent._search_measurements(
            db, user_row, {"date_from": "1990-01-01", "date_to": "1990-12-31"}))
        db.close()
        assert len(found) == 1
        assert missed == []


class TestDoctorToolsExtended:
    def test_patient_visits_for_doctor(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        _doctor(client, "dv@test.ru", branch_id=vrn)
        pat = _register(client, "pv1@test.ru", branch_id=vrn)
        client.post("/api/visits", json={"visit_date": "2026-12-01", "reason": "Осмотр",
                                        "complaints": "Кашель"}, headers=_auth(pat))
        from app.database import connect
        db = connect()
        doc_row = db.execute("SELECT * FROM users WHERE email = ?", ("dv@test.ru",)).fetchone()
        rows = json.loads(chat_agent._exec_patient_visits(
            db, doc_row, {"patient_id": chat_agent._anonymous_patient_id(pat["user"]["id"])}))
        db.close()
        assert len(rows) == 1
        assert rows[0]["reason"] == "Осмотр"

    def test_other_branch_patient_blocked(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        bld = next(b for b in branches if b["city"] == "Белгород")["id"]
        _doctor(client, "dv2@test.ru", branch_id=vrn)
        foreign = _register(client, "pbg1@test.ru", branch_id=bld)
        from app.database import connect
        db = connect()
        doc_row = db.execute("SELECT * FROM users WHERE email = ?", ("dv2@test.ru",)).fetchone()
        result = json.loads(chat_agent._exec_patient_visits(
            db, doc_row, {"patient_id": chat_agent._anonymous_patient_id(foreign["user"]["id"])}))
        db.close()
        assert "error" in result

    def test_patients_needing_attention(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        _doctor(client, "dv3@test.ru", branch_id=vrn)
        bad = _register(client, "bad1@test.ru", branch_id=vrn)
        good = _register(client, "good1@test.ru", branch_id=vrn)
        client.post("/api/measurements", json={"systolic": 190, "diastolic": 120},
                    headers=_auth(bad))
        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(good))
        from app.database import connect
        db = connect()
        doc_row = db.execute("SELECT * FROM users WHERE email = ?", ("dv3@test.ru",)).fetchone()
        rows = json.loads(chat_agent._exec_patients_needing_attention(db, doc_row, {"days": 30}))
        db.close()
        assert all("patient_id" not in r for r in rows)
        assert len(rows) == 1
        assert rows[0]["id"] == chat_agent._anonymous_patient_id(bad["user"]["id"])
        assert all(r["id"] != chat_agent._anonymous_patient_id(good["user"]["id"]) for r in rows)


class TestChatDeidentified:
    """F034: tool-результаты чата уходят в тот же внешний LLM (PlusVibe),
    поэтому реальные имена/пол пациентов и имена врачей в них не попадают —
    вместо них «Пациент N, X лет» (llm_service.patient_alias)."""

    @staticmethod
    def _tool_contents(mock: _MockLLM) -> str:
        return "\n".join(m["content"] for call in mock.calls
                         for m in call["messages"] if m["role"] == "tool")

    def test_patient_tool_results_deidentified(self, client, monkeypatch):
        p = _register(client, "deid-p@test.ru", name="Анна Демо")
        client.put("/api/auth/me", json={"age": 46, "sex": "female"}, headers=_auth(p))
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115},
                    headers=_auth(p))
        # заметка врача с реальным именем из seed-данных (medai.db, users id 1)
        from app.database import connect
        db = connect()
        analysis = db.execute("SELECT id FROM analyses ORDER BY id DESC LIMIT 1").fetchone()
        db.execute("""INSERT INTO doctor_notes (analysis_id, doctor_id, doctor_name, text)
                      VALUES (?, ?, ?, ?)""",
                   (analysis["id"], p["user"]["id"], "Ирина Ивановна", "Следите за давлением"))
        db.commit()
        db.close()

        mock = _MockLLM([
            _tool_call("get_profile", "c1"),
            _tool_call("get_doctor_notes", "c2"),
            {"content": "Ваши показатели требуют внимания."},
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)
        resp = client.post("/api/chat/send", json={"message": "Что с моим давлением?"},
                           headers=_auth(p))
        assert resp.status_code == 200
        assert resp.json()["tools_used"] == ["get_profile", "get_doctor_notes"]
        joined = self._tool_contents(mock)
        assert "Анна" not in joined
        assert "Демо" not in joined
        assert "женский" not in joined  # пол — тоже ПДн
        assert "Ирина Ивановна" not in joined  # имя врача модели не нужно
        assert "Пациент, 46 лет" in joined

    def test_doctor_tool_results_deidentified(self, client, monkeypatch):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        d = _doctor(client, "deid-d@test.ru", branch_id=vrn)
        bad = _register(client, "deid-bad@test.ru", branch_id=vrn, name="Анна Демо")
        client.put("/api/auth/me", json={"age": 46, "sex": "female"}, headers=_auth(bad))
        good = _register(client, "deid-good@test.ru", branch_id=vrn, name="Мария Сидорова")
        client.post("/api/measurements", json={"systolic": 190, "diastolic": 120}, headers=_auth(bad))
        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(good))

        mock = _MockLLM([
            _tool_call("get_patients_overview", "c1"),
            _tool_call("get_patients_needing_attention", "c2", {"days": 30}),
            {"content": "Есть пациент с тревожным разбором."},
        ])
        monkeypatch.setattr("app.services.chat_agent.llm_service.chat_completion", mock)
        resp = client.post("/api/chat/send", json={"message": "Кого показать врачу?"},
                           headers=_auth(d))
        assert resp.status_code == 200
        assert resp.json()["tools_used"] == ["get_patients_overview",
                                             "get_patients_needing_attention"]
        joined = self._tool_contents(mock)
        # реальные имена обоих пациентов (seed-имена из medai.db) не уходят в LLM
        assert "Анна" not in joined
        assert "Демо" not in joined
        assert "Мария" not in joined
        assert "Сидорова" not in joined
        # ID записей БД не нужен модели и не передаётся внешнему обработчику.
        assert "Пациент, 46 лет" in joined
        assert "Пациент" in joined

