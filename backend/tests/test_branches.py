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
    monkeypatch.setattr(config, "LLM_API_KEY", "")  # без сети: анализ только по правилам
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
            "email": "p2@test.ru", "password": "test-password-2026", "branch_id": 99999,
        })
        assert resp.status_code == 422

    def test_login_returns_branch(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        _register(client, "p5@test.ru", branch_id=vrn)
        login = client.post("/api/auth/login", json={
            "email": "p5@test.ru", "password": "test-password-2026",
        }).json()
        assert login["user"]["branch"]["city"] == "Воронеж"

    def test_register_without_branch_422(self, client):
        """С.3: филиал обязателен на сервере для любой роли — «невидимых» не создавать."""
        resp = client.post("/api/auth/register", json={
            "email": "p3@test.ru", "password": "test-password-2026", "name": "Тест",
        })
        assert resp.status_code == 422
        db = sqlite3.connect(config.DATABASE_PATH)
        n = db.execute("SELECT COUNT(*) FROM users WHERE email = 'p3@test.ru'").fetchone()[0]
        db.close()
        assert n == 0  # пользователь не создан

    def test_change_branch_via_profile(self, client):
        branches = client.get("/api/auth/branches").json()["items"]
        vrn = next(b for b in branches if b["city"] == "Воронеж")["id"]
        sochi = next(b for b in branches if b["city"] == "Сочи")["id"]
        p = _register(client, "p4@test.ru", branch_id=vrn)
        r = client.put("/api/auth/me", json={"branch_id": sochi}, headers=_auth(p))
        assert r.status_code == 200
        assert r.json()["branch"]["city"] == "Воронеж"  # нельзя скрыто сменить через общий профиль
        r = client.post("/api/auth/me/branch", json={"branch_id": sochi, "current_password": "test-password-2026"}, headers=_auth(p))
        assert r.status_code == 200
        assert r.json()["branch"]["city"] == "Сочи"
        # несуществующий — 422
        r = client.post("/api/auth/me/branch", json={"branch_id": 424242, "current_password": "test-password-2026"}, headers=_auth(p))
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
        """Легаси-пользователи без филиала (branch_id NULL, созданы до С.3):
        NULL IS NULL — врач видит пациента без филиала. Зарегистрировать таких
        через API больше нельзя, поэтому NULL проставляем напрямую в БД."""
        _make_invite(client, "inv-c")
        doc = _register(client, "dn@test.ru", invite_code="inv-c")
        p = _register(client, "pn@test.ru")
        db = sqlite3.connect(config.DATABASE_PATH)
        db.execute("UPDATE users SET branch_id = NULL WHERE email IN ('dn@test.ru', 'pn@test.ru')")
        db.commit()
        db.close()
        items = client.get("/api/doctor/patients", headers=_auth(doc)).json()["items"]
        assert any(i["id"] == p["user"]["id"] for i in items)
