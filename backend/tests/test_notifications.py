"""Колокольчик уведомлений (Б1—Б3): подсчёт непрочитанных, сброс при просмотре,
изоляция ролей. Derived-запрос — состояние проверяем через API, не через таблицу.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "notif.db")
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


def _doctor(c: TestClient, email: str) -> dict:
    db = database.connect()
    db.execute("INSERT INTO invite_codes (code) VALUES ('DOC-INVITE')")
    db.commit()
    db.close()
    return _register(c, email, invite_code="DOC-INVITE")


def _add_analysis(user_id: int, risk: str = "red", doctor_seen: bool = False) -> int:
    db = database.connect()
    cursor = db.execute(
        "INSERT INTO measurements (user_id, pulse) VALUES (?, 110)", (user_id,)
    )
    meas_id = cursor.lastrowid
    cursor = db.execute(
        """INSERT INTO analyses (measurement_id, user_id, risk_level, doctor_seen_at)
           VALUES (?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)""",
        (meas_id, user_id, risk, int(doctor_seen)),
    )
    analysis_id = cursor.lastrowid
    db.commit()
    db.close()
    return int(analysis_id)


class TestPatientNotifications:
    def test_empty_for_new_patient(self, client):
        p = _register(client, "n0@test.ru")
        data = client.get("/api/notifications", headers=_auth(p)).json()
        assert data == {"unread": 0, "items": []}

    def test_note_counts_then_seen_resets(self, client):
        patient = _register(client, "n1@test.ru")
        doctor = _doctor(client, "n1doc@test.ru")
        analysis_id = _add_analysis(patient["user"]["id"], risk="yellow")

        r = client.post(f"/api/doctor/analyses/{analysis_id}/notes",
                        json={"text": "Пересдайте кровь"}, headers=_auth(doctor))
        assert r.status_code == 201, r.text

        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 1
        item = data["items"][0]
        assert item["type"] == "note" and "Пересдайте кровь" in item["text"]
        assert item["target"] == "/medcard?tab=meas"

        assert client.post("/api/notifications/seen", headers=_auth(patient)).status_code == 200
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 0 and data["items"] == []

    def test_completed_visit_with_conclusion_counts(self, client):
        patient = _register(client, "n2@test.ru")
        visit = client.post("/api/visits", json={"complaints": "Болит голова"},
                            headers=_auth(patient)).json()
        doctor = _doctor(client, "n2doc@test.ru")
        r = client.put(f"/api/doctor/visits/{visit['id']}",
                       json={"conclusion": "Направление к неврологу"}, headers=_auth(doctor))
        assert r.status_code == 200, r.text

        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 1 and data["items"][0]["type"] == "visit_done"

        client.post("/api/notifications/seen", headers=_auth(patient))
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 0

    def test_visit_tomorrow_persists_until_date(self, client):
        """Напоминалка «приём завтра» — не одноразовая: живёт до даты приёма."""
        patient = _register(client, "n3@test.ru")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        client.post("/api/visits", json={"visit_date": tomorrow, "complaints": "Осмотр"},
                    headers=_auth(patient))
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 1 and data["items"][0]["type"] == "visit_tomorrow"
        client.post("/api/notifications/seen", headers=_auth(patient))
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 1  # напоминание не исчезает после просмотра

    def test_patient_isolation(self, client):
        """Чужие заметки не попадают: уведомления считаются по своим разборам."""
        a = _register(client, "n4a@test.ru")
        b = _register(client, "n4b@test.ru")
        doctor = _doctor(client, "n4doc@test.ru")
        analysis_id = _add_analysis(a["user"]["id"], risk="yellow")
        client.post(f"/api/doctor/analyses/{analysis_id}/notes",
                    json={"text": "Только пациенту A"}, headers=_auth(doctor))

        data = client.get("/api/notifications", headers=_auth(b)).json()
        assert data["unread"] == 0

    def test_seen_is_per_user(self, client):
        a = _register(client, "n5a@test.ru")
        b = _register(client, "n5b@test.ru")
        doctor = _doctor(client, "n5doc@test.ru")
        for user in (a, b):
            _add_analysis(user["user"]["id"], risk="yellow")
        analysis = client.get("/api/doctor/patients", headers=_auth(doctor)).json()
        # врач комментирует разборы обоих пациентов
        for item in analysis["items"]:
            measurements = client.get(f"/api/doctor/patients/{item['id']}",
                                      headers=_auth(doctor)).json()["items"]
            aid = next(m["analysis"]["id"] for m in measurements if m["analysis"])
            client.post(f"/api/doctor/analyses/{aid}/notes",
                        json={"text": "Заметка"}, headers=_auth(doctor))

        assert client.get("/api/notifications", headers=_auth(a)).json()["unread"] == 1
        client.post("/api/notifications/seen", headers=_auth(a))
        assert client.get("/api/notifications", headers=_auth(a)).json()["unread"] == 0
        # B колокольчик не открывал — его уведомление на месте
        assert client.get("/api/notifications", headers=_auth(b)).json()["unread"] == 1


class TestDoctorNotifications:
    def test_doctor_gets_signals_not_patient_items(self, client):
        patient = _register(client, "n6@test.ru")
        _add_analysis(patient["user"]["id"], risk="red")  # непрочитанный сигнал
        doctor = _doctor(client, "n6doc@test.ru")

        data = client.get("/api/notifications", headers=_auth(doctor)).json()
        assert data["unread"] == 1
        assert data["items"][0]["type"] == "signal"
        assert data["items"][0]["target"].startswith("/patients/")

    def test_patient_never_receives_signals(self, client):
        patient = _register(client, "n7@test.ru")
        _add_analysis(patient["user"]["id"], risk="red")
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert data["unread"] == 0  # свой красный разбор — не сигнал, колокольчик молчит

    def test_patient_cannot_use_doctor_endpoints(self, client):
        """Гвард роли: пациент не должен попасть в списки сигналов врача."""
        patient = _register(client, "n8@test.ru")
        _add_analysis(patient["user"]["id"], risk="red")
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert all(i["type"] != "signal" for i in data["items"])


class TestSeenMarker:
    def test_seen_requires_auth(self, client):
        assert client.post("/api/notifications/seen").status_code == 401

    def test_unread_is_full_count_while_items_windowed(self, client):
        """Больше 10 событий: бейдж показывает полный счёт, список — последние 10."""
        patient = _register(client, "n9@test.ru")
        doctor = _doctor(client, "n9doc@test.ru")
        for _ in range(12):
            analysis_id = _add_analysis(patient["user"]["id"], risk="yellow")
            client.post(f"/api/doctor/analyses/{analysis_id}/notes",
                        json={"text": "Заметка"}, headers=_auth(doctor))
        data = client.get("/api/notifications", headers=_auth(patient)).json()
        assert len(data["items"]) == 10
        assert data["unread"] == 12  # полный счёт непрочитанных, не потолок списка
