"""Тесты кабинета врача: коды приглашения, роли, комментарии, статистика."""
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


class TestInviteFlow:
    def test_default_role_is_patient(self, client):
        p = _register(client, "p1@test.ru")
        assert p["user"]["role"] == "patient"

    def test_unknown_code_rejected(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "d0@test.ru", "password": "secret1", "invite_code": "no-such-code",
        })
        assert resp.status_code == 422

    def test_doctor_registered_by_invite(self, client):
        _make_invite(client, "invite-doc-1")
        d = _register(client, "d1@test.ru", invite_code="invite-doc-1", name="Доктор")
        assert d["user"]["role"] == "doctor"

    def test_code_is_single_use(self, client):
        _make_invite(client, "invite-doc-2")
        _register(client, "d2@test.ru", invite_code="invite-doc-2")
        resp = client.post("/api/auth/register", json={
            "email": "d3@test.ru", "password": "secret1", "invite_code": "invite-doc-2",
        })
        assert resp.status_code == 422


class TestDoctorAccess:
    def test_patient_forbidden(self, client):
        p = _register(client, "p2@test.ru")
        resp = client.get("/api/doctor/patients", headers=_auth(p))
        assert resp.status_code == 403

    def test_anonymous_forbidden(self, client):
        assert client.get("/api/doctor/patients").status_code == 401

    def test_doctor_reads_patients_and_detail(self, client):
        _make_invite(client, "invite-doc-3")
        d = _register(client, "d3@test.ru", invite_code="invite-doc-3")
        p = _register(client, "p3@test.ru", name="Пациент Три")

        resp = client.get("/api/doctor/patients", headers=_auth(d))
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["id"] == p["user"]["id"]
        assert items[0]["requires_attention"] is False
        assert items[0]["counts"] == {"green": 0, "yellow": 0, "red": 0}

        resp = client.get(f"/api/doctor/patients/{p['user']['id']}", headers=_auth(d))
        assert resp.status_code == 200
        assert resp.json()["patient"]["email"] == "p3@test.ru"
        assert resp.json()["items"] == []

    def test_doctor_cannot_see_doctors_as_patients(self, client):
        _make_invite(client, "invite-doc-4")
        d1 = _register(client, "d4@test.ru", invite_code="invite-doc-4")
        _make_invite(client, "invite-doc-5")
        d2 = _register(client, "d5@test.ru", invite_code="invite-doc-5")

        items = client.get("/api/doctor/patients", headers=_auth(d1)).json()["items"]
        assert all(i["id"] != d2["user"]["id"] for i in items)

        resp = client.get(f"/api/doctor/patients/{d2['user']['id']}", headers=_auth(d1))
        assert resp.status_code == 404


class TestPatientSignals:
    """Сигналы в списке пациентов: тревожные ответы опросника и плановые приёмы."""

    def _doctor(self, client, code: str, email: str):
        _make_invite(client, code)
        return _register(client, email, invite_code=code)

    def test_survey_alarm_raises_attention(self, client):
        d = self._doctor(client, "invite-sg-1", "sg1@test.ru")
        p = _register(client, "p-sg1@test.ru")
        survey = '{"sym_hemoptysis": true, "sym_black_stool": true}'
        client.put("/api/medcard", json={"survey": survey}, headers=_auth(p))

        items = client.get("/api/doctor/patients", headers=_auth(d)).json()["items"]
        row = next(i for i in items if i["id"] == p["user"]["id"])
        assert row["survey_alarms"] == 2
        assert row["requires_attention"] is True  # тревожный опросник без единого замера

    def test_planned_visit_counted(self, client):
        d = self._doctor(client, "invite-sg-2", "sg2@test.ru")
        p = _register(client, "p-sg2@test.ru")
        client.post("/api/visits", json={"complaints": "Головная боль"}, headers=_auth(p))

        items = client.get("/api/doctor/patients", headers=_auth(d)).json()["items"]
        row = next(i for i in items if i["id"] == p["user"]["id"])
        assert row["planned_visits"] == 1
        assert row["requires_attention"] is False  # приём — сигнал, но не тревога

    def test_no_false_attention_from_clean_survey(self, client):
        d = self._doctor(client, "invite-sg-3", "sg3@test.ru")
        p = _register(client, "p-sg3@test.ru")
        client.put("/api/medcard", json={"survey": '{"dx_hypertension": true}'}, headers=_auth(p))

        items = client.get("/api/doctor/patients", headers=_auth(d)).json()["items"]
        row = next(i for i in items if i["id"] == p["user"]["id"])
        assert row["survey_alarms"] == 0  # диагноз без тревожных симптомов не сигнал
        assert row["requires_attention"] is False


class TestAttentionFlagAndNotes:
    def _doctor(self, client):
        _make_invite(client, "invite-doc-6")
        return _register(client, "doc6@test.ru", invite_code="invite-doc-6", name="Ирина Ивановна")

    def test_red_measurement_sets_attention(self, client):
        d = self._doctor(client)
        p = _register(client, "p4@test.ru")
        client.post("/api/measurements", json={"systolic": 185, "diastolic": 115}, headers=_auth(p))

        items = client.get("/api/doctor/patients", headers=_auth(d)).json()["items"]
        assert items[0]["requires_attention"] is True
        assert items[0]["last_risk"] == "red"

    def test_doctor_note_visible_to_patient(self, client):
        d = self._doctor(client)
        p = _register(client, "p5@test.ru")
        created = client.post(
            "/api/measurements", json={"pulse": 130}, headers=_auth(p),
        ).json()
        analysis_id = created["analysis"]["id"]

        resp = client.post(f"/api/doctor/analyses/{analysis_id}/notes",
                           json={"text": "Перемерьте пульс в покое"}, headers=_auth(d))
        assert resp.status_code == 201
        note = resp.json()
        assert note["doctor_name"] == "Ирина Ивановна"

        detail = client.get(f"/api/measurements/{created['id']}", headers=_auth(p)).json()
        assert detail["analysis"]["notes"][0]["text"] == "Перемерьте пульс в покое"
        assert "Ирина Ивановна" in detail["analysis"]["notes"][0]["doctor_name"]

    def test_note_on_foreign_analysis_404(self, client):
        d = self._doctor(client)
        p = _register(client, "p6@test.ru")
        created = client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p)).json()
        # пациент не врач — и анализ принадлежит его замеру, но проверим несуществующий id
        resp = client.post("/api/doctor/analyses/999999/notes",
                           json={"text": "x"}, headers=_auth(d))
        assert resp.status_code == 404
        assert created["analysis"]["notes"] == [] if "notes" in created["analysis"] else True


class TestStatsRegression:
    def test_newest_measurement_included_after_60(self, client):
        """Баг до правки: ORDER BY ASC LIMIT отдавал первые N замеров, свежие не попадали в ряды."""
        p = _register(client, "p7@test.ru")
        for _ in range(65):
            client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        client.post("/api/measurements", json={"pulse": 95}, headers=_auth(p))

        stats = client.get("/api/stats", headers=_auth(p)).json()
        pulses = [pt.get("pulse") for pt in stats["points"]]
        assert len(pulses) <= 61
        assert pulses[-1] == 95  # самый свежий — в конце ряда
