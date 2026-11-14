"""Тесты медкарты: анкета-анамнез, доступ пациента и врача, гвард филиала."""
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


class TestPatientCard:
    def test_anonymous_401(self, client):
        assert client.get("/api/medcard").status_code == 401
        assert client.put("/api/medcard", json={"allergies": "пенициллин"}).status_code == 401

    def test_empty_card_by_default(self, client):
        p = _register(client, "p1@test.ru")
        card = client.get("/api/medcard", headers=_auth(p)).json()
        assert card["allergies"] == ""
        assert card["chronic"] == ""
        assert card["updated_by"] is None
        assert card["updated_at"] is None

    def test_patient_saves_card(self, client):
        p = _register(client, "p2@test.ru")
        resp = client.put("/api/medcard", json={
            "blood_type": "A(II) Rh+",
            "allergies": "пенициллин, пыльца",
            "chronic": "гипертония",
            "medications": "энап 5 мг утром",
            "smoking": "нет",
            "alcohol": "редко",
            "activity": "средняя",
        }, headers=_auth(p))
        assert resp.status_code == 200
        card = resp.json()
        assert card["blood_type"] == "A(II) Rh+"
        assert card["allergies"] == "пенициллин, пыльца"
        assert card["smoking"] == "нет"
        assert card["updated_by"] == "patient"
        assert card["updated_at"]

    def test_patient_card_persists_after_reread(self, client):
        p = _register(client, "p3@test.ru")
        client.put("/api/medcard", json={"chronic": "диабет 2 типа"}, headers=_auth(p))
        card = client.get("/api/medcard", headers=_auth(p)).json()
        assert card["chronic"] == "диабет 2 типа"

    def test_doctor_cannot_save_own_card(self, client):
        _make_invite(client, "invite-mc-1")
        d = _register(client, "d1@test.ru", invite_code="invite-mc-1")
        resp = client.put("/api/medcard", json={"allergies": "x"}, headers=_auth(d))
        assert resp.status_code == 403

    def test_habit_validation(self, client):
        p = _register(client, "p4@test.ru")
        resp = client.put("/api/medcard", json={"smoking": "иногда"}, headers=_auth(p))
        assert resp.status_code == 422

    def test_field_length_validation(self, client):
        p = _register(client, "p5@test.ru")
        resp = client.put("/api/medcard", json={"allergies": "а" * 1001}, headers=_auth(p))
        assert resp.status_code == 422

    def test_patient_cannot_use_doctor_card_route(self, client):
        p = _register(client, "p6@test.ru")
        resp = client.get(f"/api/medcard/patient/{p['user']['id']}", headers=_auth(p))
        assert resp.status_code == 403
        resp = client.put(f"/api/medcard/patient/{p['user']['id']}",
                          json={"allergies": "x"}, headers=_auth(p))
        assert resp.status_code == 403


class TestDoctorCardAccess:
    def _doctor(self, client, code: str, email: str):
        _make_invite(client, code)
        return _register(client, email, invite_code=code)

    def test_doctor_reads_and_edits_patient_card(self, client):
        d = self._doctor(client, "invite-mc-2", "d2@test.ru")
        p = _register(client, "p7@test.ru")

        # Сначала пусто
        card = client.get(f"/api/medcard/patient/{p['user']['id']}", headers=_auth(d)).json()
        assert card["allergies"] == "" and card["updated_by"] is None

        resp = client.put(f"/api/medcard/patient/{p['user']['id']}", json={
            "chronic": "ишемическая болезнь",
            "medications": "аспирин 75 мг",
        }, headers=_auth(d))
        assert resp.status_code == 200
        assert resp.json()["updated_by"] == "doctor"

        # Пациент видит правку врача
        card = client.get("/api/medcard", headers=_auth(p)).json()
        assert card["chronic"] == "ишемическая болезнь"
        assert card["updated_by"] == "doctor"

    def test_other_branch_patient_404(self, client):
        _make_invite(client, "invite-mc-3")
        d1 = _register(client, "d3@test.ru", invite_code="invite-mc-3", branch_id=1)
        _make_invite(client, "invite-mc-4")
        d2 = _register(client, "d4@test.ru", invite_code="invite-mc-4", branch_id=2)
        p = _register(client, "p8@test.ru", branch_id=2)

        resp = client.get(f"/api/medcard/patient/{p['user']['id']}", headers=_auth(d1))
        assert resp.status_code == 404
        resp = client.put(f"/api/medcard/patient/{p['user']['id']}",
                          json={"allergies": "x"}, headers=_auth(d1))
        assert resp.status_code == 404

        # Врач того же филиала видит пациента
        resp = client.get(f"/api/medcard/patient/{p['user']['id']}", headers=_auth(d2))
        assert resp.status_code == 200

    def test_doctor_cannot_read_doctor_card(self, client):
        d1 = self._doctor(client, "invite-mc-5", "d5@test.ru")
        _make_invite(client, "invite-mc-6")
        d2 = _register(client, "d6@test.ru", invite_code="invite-mc-6")
        resp = client.get(f"/api/medcard/patient/{d2['user']['id']}", headers=_auth(d1))
        assert resp.status_code == 404

    def test_doctor_without_branch_sees_only_null_branch_patients(self, client):
        d = self._doctor(client, "invite-mc-7", "d7@test.ru")
        p_branch = _register(client, "p9@test.ru", branch_id=1)
        p_free = _register(client, "p10@test.ru")
        assert client.get(f"/api/medcard/patient/{p_branch['user']['id']}",
                          headers=_auth(d)).status_code == 404
        assert client.get(f"/api/medcard/patient/{p_free['user']['id']}",
                          headers=_auth(d)).status_code == 200


class TestSurvey:
    """Опросник Минздрава (404н): JSON ответов сохраняется и виден врачу."""

    def test_survey_saved_and_visible_to_doctor(self, client):
        _make_invite(client, "invite-mc-8")
        d = _register(client, "d8@test.ru", invite_code="invite-mc-8")
        p = _register(client, "p11@test.ru")

        survey = '{"dx_hypertension": true, "dx_hypertension_rx": true, "sym_hemoptysis": true, "audit": 0}'
        resp = client.put("/api/medcard", json={"survey": survey, "chronic": "Из опросника: гипертоническая болезнь"},
                          headers=_auth(p))
        assert resp.status_code == 200
        assert resp.json()["survey"] == survey

        card = client.get(f"/api/medcard/patient/{p['user']['id']}", headers=_auth(d)).json()
        assert card["survey"] == survey
        assert "гипертоническая" in card["chronic"]

    def test_survey_too_long_rejected(self, client):
        p = _register(client, "p12@test.ru")
        resp = client.put("/api/medcard", json={"survey": "x" * 12001}, headers=_auth(p))
        assert resp.status_code == 422
