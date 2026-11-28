"""Дневник самочувствия (Е2) и направления врача (Е3): CRUD, гварды ролей и филиала.
Возрастные нормы (Е4) и CSV-выгрузка (Е6) — в соседних файлах.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "symptoms.db")
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, branch_id: int = 1, **extra) -> dict:
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", "name": "Тест",
        "branch_id": branch_id, **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _doctor(c: TestClient, email: str, branch_id: int = 1) -> dict:
    db = database.connect()
    db.execute("INSERT OR IGNORE INTO invite_codes (code) VALUES (?)", (f"inv-{email}",))
    db.commit()
    db.close()
    return _register(c, email, branch_id=branch_id, invite_code=f"inv-{email}")


class TestSymptomNotes:
    def test_crud_flow(self, client):
        p = _register(client, "s1@test.ru")
        note = client.post("/api/symptoms", json={
            "recorded_at": "2026-11-27", "wellbeing": 4, "text": "Голова ясная, давление ровное",
        }, headers=_auth(p)).json()
        assert note["wellbeing"] == 4 and note["recorded_at"].startswith("2026-11-27")

        data = client.get("/api/symptoms/mine", headers=_auth(p)).json()
        assert len(data["items"]) == 1 and data["items"][0]["text"].startswith("Голова")

        assert client.delete(f"/api/symptoms/{note['id']}", headers=_auth(p)).status_code == 204
        assert client.get("/api/symptoms/mine", headers=_auth(p)).json()["items"] == []

    def test_wellbeing_bounds(self, client):
        p = _register(client, "s2@test.ru")
        assert client.post("/api/symptoms", json={"wellbeing": 6, "text": "x"},
                           headers=_auth(p)).status_code == 422
        assert client.post("/api/symptoms", json={"wellbeing": 0, "text": "x"},
                           headers=_auth(p)).status_code == 422

    def test_bad_date_422(self, client):
        p = _register(client, "s3@test.ru")
        r = client.post("/api/symptoms", json={"recorded_at": "27.11.2026", "wellbeing": 3,
                                               "text": "x"}, headers=_auth(p))
        assert r.status_code == 422

    def test_doctor_sees_patient_diary(self, client):
        patient = _register(client, "s4@test.ru")
        doctor = _doctor(client, "s4doc@test.ru")
        client.post("/api/symptoms", json={"wellbeing": 2, "text": "Бессонница три дня"},
                    headers=_auth(patient))
        pid = patient["user"]["id"]
        data = client.get(f"/api/doctor/patients/{pid}/symptoms", headers=_auth(doctor)).json()
        assert len(data["items"]) == 1 and data["items"][0]["wellbeing"] == 2

    def test_doctor_other_branch_404(self, client):
        patient = _register(client, "s5@test.ru", branch_id=2)
        doctor = _doctor(client, "s5doc@test.ru", branch_id=1)
        pid = patient["user"]["id"]
        assert client.get(f"/api/doctor/patients/{pid}/symptoms", headers=_auth(doctor)).status_code == 404

    def test_doctor_cannot_write_diary(self, client):
        _doctor(client, "s6doc@test.ru")
        r = client.post("/api/symptoms", json={"wellbeing": 3, "text": "x"},
                        headers=_auth(client.post("/api/auth/login", json={
                            "email": "s6doc@test.ru", "password": "test-password-2026",
                        }).json()))
        assert r.status_code == 403

    def test_patient_cannot_read_other_patient(self, client):
        a = _register(client, "s7a@test.ru")
        b = _register(client, "s7b@test.ru")
        client.post("/api/symptoms", json={"wellbeing": 3, "text": "приватно"},
                    headers=_auth(a))
        assert client.get("/api/symptoms/mine", headers=_auth(b)).json()["items"] == []


class TestDoctorOrders:
    def test_full_flow(self, client):
        patient = _register(client, "o1@test.ru")
        doctor = _doctor(client, "o1doc@test.ru")
        pid = patient["user"]["id"]

        order = client.post(f"/api/doctor/patients/{pid}/orders", json={
            "title": "Общий анализ крови", "category": "blood",
        }, headers=_auth(doctor)).json()
        assert order["status"] == "planned" and order["category"] == "blood"

        mine = client.get("/api/orders/mine", headers=_auth(patient)).json()["items"]
        assert len(mine) == 1 and mine[0]["title"] == "Общий анализ крови"

        done = client.post(f"/api/orders/{order['id']}/complete", headers=_auth(patient)).json()
        assert done["status"] == "done" and done["completed_at"]

    def test_unknown_category_422(self, client):
        patient = _register(client, "o2@test.ru")
        doctor = _doctor(client, "o2doc@test.ru")
        pid = patient["user"]["id"]
        r = client.post(f"/api/doctor/patients/{pid}/orders", json={
            "title": "Что-то", "category": "космос",
        }, headers=_auth(doctor))
        assert r.status_code == 422

    def test_doctor_cancels(self, client):
        patient = _register(client, "o3@test.ru")
        doctor = _doctor(client, "o3doc@test.ru")
        pid = patient["user"]["id"]
        order = client.post(f"/api/doctor/patients/{pid}/orders", json={
            "title": "Копрограмма", "category": "stool",
        }, headers=_auth(doctor)).json()
        cancelled = client.post(f"/api/doctor/orders/{order['id']}/cancel",
                                headers=_auth(doctor)).json()
        assert cancelled["status"] == "cancelled"
        # повторная отмена — конфликт
        r = client.post(f"/api/doctor/orders/{order['id']}/cancel", headers=_auth(doctor))
        assert r.status_code == 409

    def test_branch_guard(self, client):
        patient = _register(client, "o4@test.ru", branch_id=2)
        doctor = _doctor(client, "o4doc@test.ru", branch_id=1)
        pid = patient["user"]["id"]
        assert client.post(f"/api/doctor/patients/{pid}/orders", json={"title": "x"},
                           headers=_auth(doctor)).status_code == 404
        assert client.get(f"/api/doctor/patients/{pid}/orders", headers=_auth(doctor)).status_code == 404

    def test_patient_cannot_create_order(self, client):
        a = _register(client, "o5a@test.ru")
        b = _register(client, "o5b@test.ru")
        pid = b["user"]["id"]
        r = client.post(f"/api/doctor/patients/{pid}/orders", json={"title": "x"},
                        headers=_auth(a))
        assert r.status_code == 403

    def test_patient_cannot_complete_foreign_order(self, client):
        a = _register(client, "o6a@test.ru")
        b = _register(client, "o6b@test.ru")
        doctor = _doctor(client, "o6doc@test.ru")
        order = client.post(f"/api/doctor/patients/{a['user']['id']}/orders",
                            json={"title": "Анализ"}, headers=_auth(doctor)).json()
        r = client.post(f"/api/orders/{order['id']}/complete", headers=_auth(b))
        assert r.status_code == 404
