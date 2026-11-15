"""Тесты фич расширения: цели, документы, дневник/периоды, сигналы, аналитика."""
import io
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


def _doctor(client: TestClient, email: str) -> dict:
    db = __import__("sqlite3").connect(config.DATABASE_PATH)
    code = f"inv-{email}"
    db.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
    db.commit()
    db.close()
    return _register(client, email, invite_code=code, name="Доктор")


class TestGoals:
    def test_default_empty(self, client):
        p = _register(client, "g1@test.ru")
        r = client.get("/api/goals", headers=_auth(p))
        assert r.json() == {"steps": None, "sleep": None, "water": None, "weight": None}

    def test_save_and_merge(self, client):
        p = _register(client, "g2@test.ru")
        r = client.put("/api/goals", json={"steps": 10000, "sleep": 8}, headers=_auth(p))
        assert r.json()["steps"] == 10000
        # второй PUT частично: вес добавляется, шаги остаются
        r = client.put("/api/goals", json={"weight": 75}, headers=_auth(p))
        body = r.json()
        assert body["steps"] == 10000 and body["weight"] == 75

    def test_goals_private(self, client):
        p = _register(client, "g3@test.ru")
        client.put("/api/goals", json={"steps": 5000}, headers=_auth(p))
        other = _register(client, "g4@test.ru")
        r = client.get("/api/goals", headers=_auth(other))
        assert r.json()["steps"] is None

    def test_validation_bounds(self, client):
        p = _register(client, "g5@test.ru")
        r = client.put("/api/goals", json={"steps": -5}, headers=_auth(p))
        assert r.status_code == 422


class TestDocuments:
    def test_upload_list_download_delete(self, client):
        p = _register(client, "d1@test.ru")
        h = _auth(p)
        files = {"file": ("mri.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
        r = client.post("/api/documents", data={"title": "МРТ головы"}, files=files, headers=h)
        assert r.status_code == 201, r.text
        doc = r.json()
        assert doc["title"] == "МРТ головы" and doc["size"] > 0

        lst = client.get("/api/documents", headers=h).json()["items"]
        assert len(lst) == 1 and lst[0]["filename"] == "mri.pdf"

        r = client.get(f"/api/documents/{doc['id']}/download", headers=h)
        assert r.headers["content-type"].startswith("application/pdf")
        assert b"%PDF" in r.content

        r = client.delete(f"/api/documents/{doc['id']}", headers=h)
        assert r.status_code == 204

    def test_size_and_mime_limits(self, client):
        p = _register(client, "d2@test.ru")
        big = {"file": ("big.pdf", io.BytesIO(b"x" * (8 * 1024 * 1024 + 1)), "application/pdf")}
        assert client.post("/api/documents", files=big, headers=_auth(p)).status_code == 422
        exe = {"file": ("virus.exe", io.BytesIO(b"MZ"), "application/x-msdownload")}
        assert client.post("/api/documents", files=exe, headers=_auth(p)).status_code == 422

    def test_private_documents(self, client):
        p = _register(client, "d3@test.ru")
        h = _auth(p)
        doc = client.post("/api/documents",
                          files={"file": ("a.png", io.BytesIO(b"PNGDATA"), "image/png")},
                          headers=h).json()
        other = _register(client, "d4@test.ru")
        r = client.get(f"/api/documents/{doc['id']}/download", headers=_auth(other))
        assert r.status_code == 404


class TestDiaryPeriods:
    def test_period_saved(self, client):
        p = _register(client, "v1@test.ru")
        r = client.post("/api/measurements", json={"pulse": 70, "period": "morning"}, headers=_auth(p))
        assert r.json()["period"] == "morning"

    def test_repeat_copies_last(self, client):
        p = _register(client, "v2@test.ru")
        client.post("/api/measurements", json={"systolic": 130, "diastolic": 85, "pulse": 76},
                    headers=_auth(p))
        r = client.post("/api/measurements/repeat?period=evening", headers=_auth(p))
        assert r.status_code == 201
        body = r.json()
        assert body["systolic"] == 130 and body["pulse"] == 76
        assert body["period"] == "evening"

    def test_repeat_empty_422(self, client):
        p = _register(client, "v3@test.ru")
        r = client.post("/api/measurements/repeat", headers=_auth(p))
        assert r.status_code == 422


class TestDoctorSignals:
    def test_signal_cycle(self, client):
        doc = _doctor(client, "sig-doc@test.ru")
        p = _register(client, "sig-p@test.ru")
        m = client.post("/api/measurements", json={"systolic": 185, "diastolic": 115},
                        headers=_auth(p)).json()
        aid = m["analysis"]["id"]

        sig = client.get("/api/doctor/signals", headers=_auth(doc)).json()
        assert sig["unread"] == 1 and sig["items"][0]["patient_name"] == "Тест"

        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        sig = client.get("/api/doctor/signals", headers=_auth(doc)).json()
        assert sig["unread"] == 1  # зелёный замер не создаёт сигнал

        client.post(f"/api/doctor/analyses/{aid}/seen", headers=_auth(doc))
        sig = client.get("/api/doctor/signals", headers=_auth(doc)).json()
        assert sig["unread"] == 0

    def test_comment_marks_seen(self, client):
        doc = _doctor(client, "sig-doc2@test.ru")
        p = _register(client, "sig-p2@test.ru")
        m = client.post("/api/measurements", json={"systolic": 180, "diastolic": 110},
                        headers=_auth(p)).json()
        client.post(f"/api/doctor/analyses/{m['analysis']['id']}/notes",
                    json={"text": "разобрал"}, headers=_auth(doc))
        sig = client.get("/api/doctor/signals", headers=_auth(doc)).json()
        assert sig["unread"] == 0

    def test_branch_isolation(self, client):
        doc = _doctor(client, "sig-doc3@test.ru")
        p = _register(client, "sig-p3@test.ru")
        client.post("/api/measurements", json={"systolic": 190, "diastolic": 120},
                    headers=_auth(p))
        sig = client.get("/api/doctor/signals", headers=_auth(doc)).json()
        # у врача нет филиала, у пациента нет филиала — совпадают (NULL IS NULL)
        assert sig["unread"] == 1


class TestAnalytics:
    def test_doctor_sees_branch_stats(self, client):
        doc = _doctor(client, "an-doc@test.ru")
        p = _register(client, "an-p@test.ru")
        client.post("/api/measurements", json={"systolic": 130, "diastolic": 85}, headers=_auth(p))
        r = client.get("/api/analytics", headers=_auth(doc))
        assert r.status_code == 200
        body = r.json()
        assert body["patients_total"] == 1
        assert body["patients"][0]["last_risk"] == "yellow"
        assert len(body["measurements_14d"]) == 14
        assert sum(d["count"] for d in body["measurements_14d"]) == 1

    def test_patient_forbidden(self, client):
        p = _register(client, "an-p2@test.ru")
        assert client.get("/api/analytics", headers=_auth(p)).status_code == 403
