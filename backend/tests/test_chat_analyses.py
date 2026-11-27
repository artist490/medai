"""ИИ-чат и анализы: история разборов, текст распознанных документов, DLP и аудит."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import chat_agent, llm


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "chat_analyses.db")
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


def _make_invite(client: TestClient, code: str) -> None:
    db = database.connect()
    db.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
    db.commit()
    db.close()


def _doctor(client: TestClient, email: str, branch_id: int | None = None) -> dict:
    _make_invite(client, f"invite-{email}")
    extra = {"invite_code": f"invite-{email}", "name": "Доктор"}
    if branch_id is not None:
        extra["branch_id"] = branch_id
    return _register(client, email, **extra)


def _user_row(email: str):
    db = database.connect()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    db.close()
    return row


def _add_document(email: str, text: str, *, status: str = "ready") -> int:
    db = database.connect()
    user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    cursor = db.execute(
        """INSERT INTO documents (user_id, title, filename, mime, size, data,
                                  ocr_status, ocr_text, ocr_text_clean)
           VALUES (?, 'Общий анализ крови', 'blood.png', 'image/png', 128, ?, ?, ?, ?)""",
        (user["id"], b"x" * 128, status, text, text if status == "ready" else None),
    )
    db.commit()
    doc_id = cursor.lastrowid
    db.close()
    return doc_id


LAB_TEXT = (
    "Общий анализ крови\n\n"
    "ФИО: Иванов Иван Иванович\n"
    "Дата рождения: 12.03.1979\n"
    "Адрес: г. Москва, ул. Ленина, д. 5\n\n"
    "Показатель  Значение    Норма\n"
    "Гемоглобин  145 г/л     130-160\n"
    "Лейкоциты   6.2 10^9/л  4.0-9.0\n"
    "СОЭ         12 мм/ч     2-15\n"
)


class TestRedactDocument:
    def test_personal_fields_removed_lab_values_kept(self):
        safe = llm.redact_document(LAB_TEXT)
        assert "Иванов" not in safe
        assert "12.03.1979" not in safe
        assert "Ленина" not in safe
        # Лабораторные данные обязаны остаться — иначе ответ модели бесполезен.
        for value in ("Гемоглобин", "145 г/л", "130-160", "6.2 10^9/л", "СОЭ", "12 мм/ч"):
            assert value in safe

    def test_truncates_to_limit(self):
        assert len(llm.redact_document("а" * 5000, limit=100)) == 100

    def test_empty_input(self):
        assert llm.redact_document("") == ""


class TestPatientAnalyses:
    def test_read_own_document_text(self, client):
        p = _register(client, "analyses-own@test.ru")
        doc_id = _add_document("analyses-own@test.ru", LAB_TEXT)
        user = _user_row("analyses-own@test.ru")

        db = database.connect()
        result = json.loads(chat_agent._document_text(
            db, user["id"], doc_id, audit_user_id=user["id"]))
        audit = db.execute(
            "SELECT action, entity_id, details FROM audit_log WHERE action = 'chat.document_text'"
        ).fetchone()
        db.close()

        assert result["id"] == doc_id
        assert "Гемоглобин" in result["text"]
        assert "Иванов" not in result["text"]
        assert result["truncated"] is False
        # Доступ к медицинскому документу фиксируется в аудите, без содержимого.
        assert audit is not None
        assert audit["entity_id"] == doc_id
        assert "145" not in audit["details"]

    def test_document_must_be_recognised(self, client):
        _register(client, "analyses-pending@test.ru")
        doc_id = _add_document("analyses-pending@test.ru", LAB_TEXT, status="pending")
        user = _user_row("analyses-pending@test.ru")
        db = database.connect()
        result = json.loads(chat_agent._document_text(
            db, user["id"], doc_id, audit_user_id=user["id"]))
        db.close()
        assert "не распознан" in result["error"]
        assert "text" not in result

    def test_cannot_read_foreign_document(self, client):
        _register(client, "analyses-owner@test.ru")
        _register(client, "analyses-stranger@test.ru")
        doc_id = _add_document("analyses-owner@test.ru", LAB_TEXT)
        stranger = _user_row("analyses-stranger@test.ru")
        db = database.connect()
        result = json.loads(chat_agent._document_text(
            db, stranger["id"], doc_id, audit_user_id=stranger["id"]))
        db.close()
        assert result["error"] == "документ не найден"

    def test_disabled_by_config(self, client, monkeypatch):
        _register(client, "analyses-off@test.ru")
        doc_id = _add_document("analyses-off@test.ru", LAB_TEXT)
        user = _user_row("analyses-off@test.ru")
        monkeypatch.setattr(config, "CHAT_DOCUMENT_TEXT_ENABLED", False)
        db = database.connect()
        result = json.loads(chat_agent._document_text(
            db, user["id"], doc_id, audit_user_id=user["id"]))
        db.close()
        assert "отключено" in result["error"]

    def test_long_text_is_truncated(self, client, monkeypatch):
        _register(client, "analyses-long@test.ru")
        doc_id = _add_document("analyses-long@test.ru", "Гемоглобин 145 г/л\n" * 2000)
        user = _user_row("analyses-long@test.ru")
        monkeypatch.setattr(config, "CHAT_DOCUMENT_TEXT_MAX", 500)
        db = database.connect()
        result = json.loads(chat_agent._document_text(
            db, user["id"], doc_id, audit_user_id=user["id"]))
        db.close()
        assert result["truncated"] is True
        assert len(result["text"]) == 500

    def test_documents_list_reports_recognised_text(self, client):
        _register(client, "analyses-list@test.ru")
        _add_document("analyses-list@test.ru", LAB_TEXT)
        user = _user_row("analyses-list@test.ru")
        db = database.connect()
        rows = json.loads(chat_agent._my_documents(db, user, {}))
        db.close()
        assert len(rows) == 1
        assert rows[0]["has_text"] == 1
        assert "text" not in rows[0]  # содержимое — только через read_my_document

    def test_analyses_history(self, client):
        p = _register(client, "analyses-history@test.ru")
        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        client.post("/api/measurements", json={"systolic": 190, "diastolic": 120}, headers=_auth(p))
        user = _user_row("analyses-history@test.ru")
        db = database.connect()
        rows = json.loads(chat_agent._analyses_history(db, user["id"], {"limit": 10}))
        db.close()
        assert len(rows) == 2
        # Свежий разбор первым: у истории порядок от новых к старым.
        assert rows[0]["risk_level"] == "red"
        assert isinstance(rows[0]["findings"], list)

    def test_analyses_history_empty_is_honest(self, client):
        _register(client, "analyses-empty@test.ru")
        user = _user_row("analyses-empty@test.ru")
        db = database.connect()
        result = json.loads(chat_agent._analyses_history(db, user["id"], {}))
        db.close()
        assert result == {"error": "анализов пока нет"}


class TestDoctorAnalyses:
    def test_doctor_reads_patient_document(self, client):
        d = _doctor(client, "analyses-doc@test.ru", branch_id=1)
        _register(client, "analyses-pat@test.ru", branch_id=1)
        doc_id = _add_document("analyses-pat@test.ru", LAB_TEXT)
        doctor = _user_row("analyses-doc@test.ru")
        patient = _user_row("analyses-pat@test.ru")
        anonymous = chat_agent._anonymous_patient_id(patient["id"])

        db = database.connect()
        result = json.loads(chat_agent._exec_patient_document(
            db, doctor, {"patient_id": anonymous, "document_id": doc_id}))
        audit = db.execute(
            """SELECT user_id FROM audit_log
               WHERE action = 'chat.document_text' ORDER BY id DESC LIMIT 1"""
        ).fetchone()
        db.close()

        assert "Гемоглобин" in result["text"]
        assert "Иванов" not in result["text"]
        # В аудите — врач, а не пациент.
        assert audit["user_id"] == doctor["id"]

    def test_other_branch_document_blocked(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        _doctor(client, "analyses-doc2@test.ru", branch_id=vrn)
        _register(client, "analyses-pat2@test.ru", branch_id=1)
        doc_id = _add_document("analyses-pat2@test.ru", LAB_TEXT)
        doctor = _user_row("analyses-doc2@test.ru")
        patient = _user_row("analyses-pat2@test.ru")
        anonymous = chat_agent._anonymous_patient_id(patient["id"])

        db = database.connect()
        result = json.loads(chat_agent._exec_patient_document(
            db, doctor, {"patient_id": anonymous, "document_id": doc_id}))
        db.close()
        assert "не найден" in result["error"]

    def test_doctor_analyses_history(self, client):
        p = _register(client, "analyses-hp@test.ru", branch_id=1)
        client.post("/api/measurements", json={"systolic": 190, "diastolic": 120}, headers=_auth(p))
        d = _doctor(client, "analyses-hd@test.ru", branch_id=1)
        doctor = _user_row("analyses-hd@test.ru")
        patient = _user_row("analyses-hp@test.ru")
        db = database.connect()
        rows = json.loads(chat_agent._exec_patient_analyses(
            db, doctor, {"patient_id": chat_agent._anonymous_patient_id(patient["id"])}))
        db.close()
        assert len(rows) == 1
        assert rows[0]["risk_level"] == "red"


class TestToolRegistry:
    def test_new_tools_are_exposed(self):
        patient = {t["function"]["name"] for t in chat_agent.PATIENT_TOOLS}
        doctor = {t["function"]["name"] for t in chat_agent.DOCTOR_TOOLS}
        assert {"list_my_analyses", "read_my_document"} <= patient
        assert {"get_patient_analyses", "get_patient_document"} <= doctor

    def test_every_tool_has_executor(self):
        """Определение без исполнителя — молчаливый отказ модели в рантайме."""
        patient = {t["function"]["name"] for t in chat_agent.PATIENT_TOOLS}
        doctor = {t["function"]["name"] for t in chat_agent.DOCTOR_TOOLS}
        assert patient == set(chat_agent.PATIENT_EXECUTORS)
        assert doctor == set(chat_agent.DOCTOR_EXECUTORS)
