"""Смена пароля и email (Г1—Г2): подтверждение паролем, отзыв сессий,
уникальность email, брутфорс-гвард.
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
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "creds.db")
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    database.init_db()
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, password: str = "test-password-2026") -> dict:
    resp = c.post("/api/auth/register", json={
        "email": email, "password": password, "name": "Тест", "branch_id": 1,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


class TestPasswordChange:
    def test_change_and_login_with_new(self, client):
        s = _register(client, "c1@test.ru")
        r = client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "new-password-2027",
        }, headers=_auth(s))
        assert r.status_code == 200 and r.json() == {"ok": True}

        client.post("/api/auth/logout", headers=_auth(s))
        login = client.post("/api/auth/login", json={
            "email": "c1@test.ru", "password": "new-password-2027",
        })
        assert login.status_code == 200

    def test_wrong_current_password_403(self, client):
        s = _register(client, "c2@test.ru")
        r = client.put("/api/auth/me/password", json={
            "current_password": "wrong-password-123", "new_password": "new-password-2027",
        }, headers=_auth(s))
        assert r.status_code == 403

    def test_old_password_stops_working(self, client):
        s = _register(client, "c3@test.ru")
        client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "new-password-2027",
        }, headers=_auth(s))
        login = client.post("/api/auth/login", json={
            "email": "c3@test.ru", "password": "test-password-2026",
        })
        assert login.status_code == 401

    def test_other_sessions_revoked(self, client):
        """Г1: после смены пароля чужие сессии отозваны, текущая жива."""
        s = _register(client, "c4@test.ru")
        extra = client.post("/api/auth/login", json={
            "email": "c4@test.ru", "password": "test-password-2026",
        }).json()
        client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "new-password-2027",
        }, headers=_auth(s))

        db = database.connect()
        count = db.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ?",
                           (s["user"]["id"],)).fetchone()[0]
        db.close()
        assert count == 1
        # и второй токен больше не авторизует
        assert client.get("/api/auth/me", headers=_auth(extra)).status_code == 401

    def test_too_short_new_password_422(self, client):
        s = _register(client, "c5@test.ru")
        r = client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "short12",
        }, headers=_auth(s))
        assert r.status_code == 422

    def test_same_password_rejected(self, client):
        s = _register(client, "c6@test.ru")
        r = client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "test-password-2026",
        }, headers=_auth(s))
        assert r.status_code == 422

    def test_bruteforce_guard(self, client):
        """Брутфорс-гвард: 5 неверных попыток за окно — 429 (нужен и правильный)."""
        s = _register(client, "c7@test.ru")
        for _ in range(5):
            client.put("/api/auth/me/password", json={
                "current_password": "wrong-password-123", "new_password": "new-password-2027",
            }, headers=_auth(s))
        r = client.put("/api/auth/me/password", json={
            "current_password": "test-password-2026", "new_password": "new-password-2027",
        }, headers=_auth(s))
        assert r.status_code == 429

    def test_requires_auth(self, client):
        r = client.put("/api/auth/me/password", json={
            "current_password": "x", "new_password": "new-password-2027",
        })
        assert r.status_code == 401


class TestEmailChange:
    def test_change_and_login_with_new(self, client):
        s = _register(client, "e1@test.ru")
        r = client.put("/api/auth/me/email", json={
            "current_password": "test-password-2026", "email": "E1-New@Test.Ru",
        }, headers=_auth(s))
        assert r.status_code == 200
        assert r.json()["email"] == "e1-new@test.ru"  # нормализован в нижний регистр

        login = client.post("/api/auth/login", json={
            "email": "e1-new@test.ru", "password": "test-password-2026",
        })
        assert login.status_code == 200

    def test_duplicate_email_409(self, client):
        s = _register(client, "e2a@test.ru")
        _register(client, "e2b@test.ru")
        r = client.put("/api/auth/me/email", json={
            "current_password": "test-password-2026", "email": "e2b@test.ru",
        }, headers=_auth(s))
        assert r.status_code == 409

    def test_wrong_password_403(self, client):
        s = _register(client, "e3@test.ru")
        r = client.put("/api/auth/me/email", json={
            "current_password": "wrong-password-123", "email": "e3-new@test.ru",
        }, headers=_auth(s))
        assert r.status_code == 403

    def test_same_email_is_noop(self, client):
        s = _register(client, "e4@test.ru")
        r = client.put("/api/auth/me/email", json={
            "current_password": "test-password-2026", "email": "e4@test.ru",
        }, headers=_auth(s))
        assert r.status_code == 200
        assert r.json()["email"] == "e4@test.ru"

    def test_invalid_email_422(self, client):
        s = _register(client, "e5@test.ru")
        r = client.put("/api/auth/me/email", json={
            "current_password": "test-password-2026", "email": "не-почта",
        }, headers=_auth(s))
        assert r.status_code == 422

    def test_bruteforce_guard(self, client):
        s = _register(client, "e6@test.ru")
        for _ in range(5):
            client.put("/api/auth/me/email", json={
                "current_password": "wrong-password-123", "email": "e6-new@test.ru",
            }, headers=_auth(s))
        r = client.put("/api/auth/me/email", json={
            "current_password": "test-password-2026", "email": "e6-new@test.ru",
        }, headers=_auth(s))
        assert r.status_code == 429
