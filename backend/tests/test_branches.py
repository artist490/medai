"""Тесты филиалов: сид городов, регистрация/смена филиала, изоляция врачей."""
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


class TestBranches:
    def test_seed_15_cities(self, client):
        items = client.get("/api/auth/branches").json()["items"]
        assert len(items) == 15
        cities = {b["city"] for b in items}
        assert {"Воронеж", "Сочи", "Тамбов", "Белгород"} <= cities
        assert all(b["phone"] for b in items)

    def test_branches_public(self, client):
        # без токена — список доступен
        assert client.get("/api/auth/branches").status_code == 200

    def test_register_with_branch(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")
        p = _register(client, "p1@test.ru", branch_id=vrn["id"])
        assert p["user"]["branch"]["city"] == "Воронеж"
        assert p["user"]["branch"]["phone"] == vrn["phone"]

    def test_register_unknown_branch_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "p2@test.ru", "password": "secret1", "branch_id": 99999,
        })
        assert resp.status_code == 422

    def test_register_without_branch_ok(self, client):
        p = _register(client, "p3@test.ru")
        assert p["user"]["branch"] is None

    def test_change_branch_via_profile(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        sochi = next(b for b in branches if b["city"] == "Сочи")["id"]
        p = _register(client, "p4@test.ru", branch_id=vrn)
        r = client.put("/api/auth/me", json={"branch_id": sochi}, headers=_auth(p))
        assert r.status_code == 200
        assert r.json()["branch"]["city"] == "Сочи"
        # несуществующий — 422
        r = client.put("/api/auth/me", json={"branch_id": 424242}, headers=_auth(p))
        assert r.status_code == 422

    def test_doctor_isolated_by_branch(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        bg = next(b for b in branches if b["city"] == "Белгород")["id"]

        _make_invite(client, "inv-a")
        doc_vrn = _register(client, "dvrn@test.ru", invite_code="inv-a", branch_id=vrn)
        _make_invite(client, "inv-b")
        _register(client, "dbg@test.ru", invite_code="inv-b", branch_id=bg)
        p_vrn = _register(client, "pvrn@test.ru", branch_id=vrn)
        p_bg = _register(client, "pbg@test.ru", branch_id=bg)

        client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p_vrn))
        client.post("/api/measurements", json={"pulse": 90}, headers=_auth(p_bg))

        items = client.get("/api/doctor/patients", headers=_auth(doc_vrn)).json()["items"]
        ids = {i["id"] for i in items}
        assert p_vrn["user"]["id"] in ids
        assert p_bg["user"]["id"] not in ids

        # пациент другого филиала не открывается
        r = client.get(f"/api/doctor/patients/{p_bg['user']['id']}", headers=_auth(doc_vrn))
        assert r.status_code == 404

    def test_doctor_and_patient_same_null_branch(self, client):
        """Врач и пациент без филиала видят друг друга (NULL IS NULL)."""
        _make_invite(client, "inv-c")
        doc = _register(client, "dn@test.ru", invite_code="inv-c")
        p = _register(client, "pn@test.ru")
        items = client.get("/api/doctor/patients", headers=_auth(doc)).json()["items"]
        assert any(i["id"] == p["user"]["id"] for i in items)
