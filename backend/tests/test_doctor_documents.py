"""Документы пациента у врача (В1—В4): гвард филиала, просмотр текста,
скачивание, аудит и «врач открывал» пациенту.
"""
import io
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
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "docdoc.db")
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
    db = sqlite3.connect(config.DATABASE_PATH)
    db.execute("INSERT INTO invite_codes (code) VALUES (?)", (f"invite-{email}",))
    db.commit()
    db.close()
    return _register(c, email, branch_id=branch_id, invite_code=f"invite-{email}")


def _upload(c: TestClient, session: dict, name: str = "blank.png") -> dict:
    r = c.post("/api/documents", headers=_auth(session), files={
        "file": (name, io.BytesIO(b"\x89PNG\r\n\x1a\nTEST"), "image/png"),
    })
    assert r.status_code == 201, r.text
    return r.json()[0]


class TestDoctorDocuments:
    def test_list_and_download_own_branch(self, client):
        patient = _register(client, "v1@test.ru")
        doctor = _doctor(client, "v1doc@test.ru")
        doc = _upload(client, patient)

        data = client.get(f"/api/doctor/patients/{patient['user']['id']}/documents",
                          headers=_auth(doctor)).json()
        assert [d["id"] for d in data["items"]] == [doc["id"]]
        assert data["items"][0]["doctor_viewed_at"] is None

        r = client.get(f"/api/doctor/patients/{patient['user']['id']}/documents/{doc['id']}/download",
                       headers=_auth(doctor))
        assert r.status_code == 200 and b"\x89PNG" in r.content

    def test_download_marks_viewed_for_patient(self, client):
        """В4: после скачивания врачом пациент видит «врач открывал: дата»."""
        patient = _register(client, "v2@test.ru")
        doctor = _doctor(client, "v2doc@test.ru")
        doc = _upload(client, patient)
        pid = patient["user"]["id"]

        assert doc["doctor_viewed_at"] is None
        client.get(f"/api/doctor/patients/{pid}/documents/{doc['id']}/download",
                   headers=_auth(doctor))

        items = client.get("/api/documents", headers=_auth(patient)).json()["items"]
        assert items[0]["doctor_viewed_at"] is not None

        # Врач тоже видит отметку — свежую дату
        data = client.get(f"/api/doctor/patients/{pid}/documents", headers=_auth(doctor)).json()
        assert data["items"][0]["doctor_viewed_at"] is not None

    def test_ocr_text_marks_viewed_and_audits(self, client):
        """Открытие текста — тоже «открытие документа» (В4)."""
        patient = _register(client, "v3@test.ru")
        doctor = _doctor(client, "v3doc@test.ru")
        doc = _upload(client, patient)
        pid = patient["user"]["id"]

        r = client.get(f"/api/doctor/patients/{pid}/documents/{doc['id']}/ocr",
                       headers=_auth(doctor))
        assert r.status_code == 200 and r.json()["status"] == "disabled"

        db = sqlite3.connect(config.DATABASE_PATH)
        row = db.execute("SELECT doctor_viewed_at FROM documents WHERE id = ?", (doc["id"],)).fetchone()
        audit = db.execute(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'document.viewed_by_doctor' AND entity_id = ?",
            (doc["id"],),
        ).fetchone()[0]
        db.close()
        assert row[0] is not None and audit == 1

    def test_other_branch_patient_404(self, client):
        """Гвард филиала: пациент другого филиала не виден (как у медкарты)."""
        patient = _register(client, "v4@test.ru", branch_id=2)
        doctor = _doctor(client, "v4doc@test.ru", branch_id=1)
        doc = _upload(client, patient)
        pid = patient["user"]["id"]
        base = f"/api/doctor/patients/{pid}/documents"
        assert client.get(base, headers=_auth(doctor)).status_code == 404
        assert client.get(f"{base}/{doc['id']}/download", headers=_auth(doctor)).status_code == 404
        assert client.get(f"{base}/{doc['id']}/ocr", headers=_auth(doctor)).status_code == 404

    def test_patient_cannot_use_doctor_route(self, client):
        """Документы другого пациента не отдаются через эндпоинт врача."""
        a = _register(client, "v5a@test.ru")
        b = _register(client, "v5b@test.ru")
        doc = _upload(client, a)
        pid = a["user"]["id"]
        r = client.get(f"/api/doctor/patients/{pid}/documents/{doc['id']}/download",
                       headers=_auth(b))
        assert r.status_code == 403  # пациент вообще не врач

    def test_missing_document_404(self, client):
        patient = _register(client, "v6@test.ru")
        doctor = _doctor(client, "v6doc@test.ru")
        pid = patient["user"]["id"]
        r = client.get(f"/api/doctor/patients/{pid}/documents/99999/ocr", headers=_auth(doctor))
        assert r.status_code == 404
