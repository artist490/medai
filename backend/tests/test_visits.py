"""Тесты приёмов: запись пациента с жалобами, завершение врачом, гварды."""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app


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


def _doctor(client: TestClient, code: str, email: str, **extra) -> dict:
    _make_invite(client, code)
    return _register(client, email, invite_code=code, **extra)


def _create_visit(c: TestClient, session: dict, **extra) -> dict:
    body = {"complaints": "Головная боль три дня", "reason": "Консультация", **extra}
    resp = c.post("/api/visits", json=body, headers=_auth(session))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestCreateVisit:
    def test_patient_creates_visit(self, client):
        p = _register(client, "p1@test.ru", branch_id=1)
        visit = _create_visit(client, p, visit_date="2026-11-20")
        assert visit["status"] == "planned"
        assert visit["complaints"] == "Головная боль три дня"
        assert visit["visit_date"] == "2026-11-20"
        assert visit["branch_id"] == 1
        assert visit["conclusion"] == ""

    def test_complaints_required(self, client):
        p = _register(client, "p2@test.ru")
        resp = client.post("/api/visits", json={"reason": "Консультация"}, headers=_auth(p))
        assert resp.status_code == 422

    def test_bad_date_format(self, client):
        p = _register(client, "p3@test.ru")
        resp = client.post("/api/visits", json={"complaints": "x", "visit_date": "20.11.2026"},
                           headers=_auth(p))
        assert resp.status_code == 422

    def test_doctor_cannot_create(self, client):
        d = _doctor(client, "invite-v-1", "d1@test.ru")
        resp = client.post("/api/visits", json={"complaints": "x"}, headers=_auth(d))
        assert resp.status_code == 403

    def test_anonymous_401(self, client):
        assert client.post("/api/visits", json={"complaints": "x"}).status_code == 401


class TestPatientViewsAndEdits:
    def test_mine_lists_own_only(self, client):
        p1 = _register(client, "p4@test.ru")
        p2 = _register(client, "p5@test.ru")
        _create_visit(client, p1, reason="Первый")
        _create_visit(client, p2, reason="Второй")

        items = client.get("/api/visits/mine", headers=_auth(p1)).json()["items"]
        assert len(items) == 1
        assert items[0]["reason"] == "Первый"

    def test_patch_planned_visit(self, client):
        p = _register(client, "p6@test.ru")
        visit = _create_visit(client, p)
        resp = client.patch(f"/api/visits/{visit['id']}", json={
            "complaints": "Головная боль и шум в ушах", "visit_date": "2026-11-25",
        }, headers=_auth(p))
        assert resp.status_code == 200
        assert resp.json()["complaints"] == "Головная боль и шум в ушах"
        assert resp.json()["visit_date"] == "2026-11-25"

    def test_cancel_planned_visit(self, client):
        p = _register(client, "p7@test.ru")
        visit = _create_visit(client, p)
        resp = client.post(f"/api/visits/{visit['id']}/cancel", headers=_auth(p))
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    def test_cannot_touch_processed_visit(self, client):
        d = _doctor(client, "invite-v-2", "d2@test.ru")
        p = _register(client, "p8@test.ru")
        visit = _create_visit(client, p)
        resp = client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": "ОК"}, headers=_auth(d))
        assert resp.status_code == 200

        resp = client.patch(f"/api/visits/{visit['id']}",
                            json={"complaints": "заново"}, headers=_auth(p))
        assert resp.status_code == 409
        resp = client.post(f"/api/visits/{visit['id']}/cancel", headers=_auth(p))
        assert resp.status_code == 409

    def test_foreign_visit_404(self, client):
        p1 = _register(client, "p9@test.ru")
        p2 = _register(client, "p10@test.ru")
        visit = _create_visit(client, p2)
        assert client.patch(f"/api/visits/{visit['id']}",
                            json={"complaints": "x"}, headers=_auth(p1)).status_code == 404
        assert client.post(f"/api/visits/{visit['id']}/cancel",
                           headers=_auth(p1)).status_code == 404


class TestDoctorVisitAccess:
    def test_doctor_sees_patient_visits_and_completes(self, client):
        d = _doctor(client, "invite-v-3", "d3@test.ru", branch_id=1)
        p = _register(client, "p11@test.ru", branch_id=1)
        _create_visit(client, p, reason="Расшифровка МРТ")

        items = client.get(f"/api/doctor/patients/{p['user']['id']}/visits",
                           headers=_auth(d)).json()["items"]
        assert len(items) == 1
        assert items[0]["status"] == "planned"

        visit_id = items[0]["id"]
        resp = client.put(f"/api/doctor/visits/{visit_id}", json={
            "conclusion": "Данных за патологию нет",
            "recommendations": "Контроль давления через месяц",
        }, headers=_auth(d))
        assert resp.status_code == 200
        done = resp.json()
        assert done["status"] == "completed"
        assert done["doctor_id"] == d["user"]["id"]
        assert done["conclusion"] == "Данных за патологию нет"

        # Пациент видит заключение
        items = client.get("/api/visits/mine", headers=_auth(p)).json()["items"]
        assert items[0]["conclusion"] == "Данных за патологию нет"

    def test_double_completion_409(self, client):
        d = _doctor(client, "invite-v-4", "d4@test.ru")
        p = _register(client, "p12@test.ru")
        visit = _create_visit(client, p)
        resp = client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": "первый раз"}, headers=_auth(d))
        assert resp.status_code == 200
        resp = client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": "второй раз"}, headers=_auth(d))
        assert resp.status_code == 409

    def test_other_branch_404(self, client):
        d1 = _doctor(client, "invite-v-5", "d5@test.ru", branch_id=1)
        _doctor(client, "invite-v-6", "d6@test.ru", branch_id=2)
        p = _register(client, "p13@test.ru", branch_id=2)
        visit = _create_visit(client, p)

        assert client.get(f"/api/doctor/patients/{p['user']['id']}/visits",
                          headers=_auth(d1)).status_code == 404
        assert client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": "x"}, headers=_auth(d1)).status_code == 404

    def test_patient_cannot_complete(self, client):
        p1 = _register(client, "p14@test.ru")
        p2 = _register(client, "p15@test.ru")
        visit = _create_visit(client, p2)
        resp = client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": "сам себе врач"}, headers=_auth(p1))
        assert resp.status_code == 403

    def test_empty_conclusion_422(self, client):
        d = _doctor(client, "invite-v-7", "d7@test.ru")
        p = _register(client, "p16@test.ru")
        visit = _create_visit(client, p)
        resp = client.put(f"/api/doctor/visits/{visit['id']}",
                          json={"conclusion": ""}, headers=_auth(d))
        assert resp.status_code == 422
