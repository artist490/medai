"""Тесты защит: rate-limit логина, чистка сессий, валидация даты, лимиты stats."""
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
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


class TestLoginRateLimit:
    def test_blocks_after_5_fails_and_recovers(self, client):
        s = _register(client, "rl1@test.ru")
        # 5 неудачных попыток
        for i in range(5):
            r = client.post("/api/auth/login", json={
                "email": "rl1@test.ru", "password": "wrong" + str(i),
            })
            assert r.status_code == 401
        # 6-я — даже с верным паролем — заблокирована
        r = client.post("/api/auth/login", json={
            "email": "rl1@test.ru", "password": "secret1",
        })
        assert r.status_code == 429

    def test_other_email_not_blocked(self, client):
        _register(client, "rl2@test.ru")
        for i in range(5):
            client.post("/api/auth/login", json={
                "email": "rl2@test.ru", "password": "wrong",
            })
        # другой email — не затронут
        s = _register(client, "rl3@test.ru")
        r = client.post("/api/auth/login", json={
            "email": "rl3@test.ru", "password": "secret1",
        })
        assert r.status_code == 200

    def test_successful_login_resets_counter(self, client):
        _register(client, "rl4@test.ru")
        for i in range(3):
            client.post("/api/auth/login", json={
                "email": "rl4@test.ru", "password": "wrong",
            })
        client.post("/api/auth/login", json={
            "email": "rl4@test.ru", "password": "secret1",
        })
        # после успешного входа счётчик сброшен: 4 новых неудачи не блокируют
        for i in range(4):
            client.post("/api/auth/login", json={
                "email": "rl4@test.ru", "password": "wrong" + str(i),
            })
        r = client.post("/api/auth/login", json={
            "email": "rl4@test.ru", "password": "secret1",
        })
        assert r.status_code == 200


class TestSessionCleanup:
    def test_expired_sessions_removed_on_startup(self, client, tmp_path):
        db = sqlite3.connect(config.DATABASE_PATH)
        expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        db.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES ('dead-token', 1, ?)",
            (expired,),
        )
        db.commit()
        db.close()

        # новая инициализация (как при рестарте сервера) чистит истёкшие
        database.init_db()
        db = sqlite3.connect(config.DATABASE_PATH)
        row = db.execute("SELECT * FROM sessions WHERE token = 'dead-token'").fetchone()
        db.close()
        assert row is None

    def test_login_purges_own_expired_sessions(self, client):
        s = _register(client, "sc1@test.ru")
        db = sqlite3.connect(config.DATABASE_PATH)
        expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        db.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES ('old', ?, ?)",
            (s["user"]["id"], expired),
        )
        db.commit()
        db.close()
        client.post("/api/auth/login", json={"email": "sc1@test.ru", "password": "secret1"})
        db = sqlite3.connect(config.DATABASE_PATH)
        row = db.execute("SELECT * FROM sessions WHERE token = 'old'").fetchone()
        db.close()
        assert row is None


class TestRecordedAtValidation:
    def test_valid_iso_accepted_and_normalized(self, client):
        p = _register(client, "v1@test.ru")
        r = client.post("/api/measurements", json={
            "pulse": 70, "recorded_at": "2026-01-31T14:30:00",
        }, headers=_auth(p))
        assert r.status_code == 201
        assert r.json()["recorded_at"] == "2026-01-31 14:30:00"

    def test_invalid_date_422(self, client):
        p = _register(client, "v2@test.ru")
        r = client.post("/api/measurements", json={
            "pulse": 70, "recorded_at": "не дата вообще",
        }, headers=_auth(p))
        assert r.status_code == 422
        assert "дата" in r.json()["detail"].lower()

    def test_empty_date_gets_now(self, client):
        p = _register(client, "v3@test.ru")
        r = client.post("/api/measurements", json={"pulse": 70}, headers=_auth(p))
        assert r.status_code == 201
        assert r.json()["recorded_at"]  # заполнено текущим временем


class TestStatsLimitBounds:
    def test_zero_limit_422(self, client):
        p = _register(client, "v4@test.ru")
        r = client.get("/api/stats?limit=0", headers=_auth(p))
        assert r.status_code == 422

    def test_over_limit_422(self, client):
        p = _register(client, "v5@test.ru")
        r = client.get("/api/stats?limit=500", headers=_auth(p))
        assert r.status_code == 422

    def test_ok_limit(self, client):
        p = _register(client, "v6@test.ru")
        r = client.get("/api/stats?limit=10", headers=_auth(p))
        assert r.status_code == 200


@pytest.mark.skipif(not config.FRONTEND_DIST.is_dir(),
                    reason="SPA-раздача монтируется только при наличии frontend/dist")
class TestStaticPathTraversal:
    """Регрессия: SPA-fallback не должен отдавать файлы вне frontend/dist.

    До правки GET /..%2f..%2fbackend%2f.env возвращал содержимое .env
    (ключ LLM), а /..%2fmedai.db — базу пациентов.
    """

    def test_traversal_serves_index_not_secret(self, client, tmp_path, monkeypatch):
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("SAFE-INDEX-HTML", encoding="utf-8")
        secret = tmp_path / "secret.txt"
        secret.write_text("TOP-SECRET-VALUE", encoding="utf-8")
        monkeypatch.setattr(config, "FRONTEND_DIST", dist)

        for path in ("/..%2fsecret.txt", "/..%2f..%2fsecret.txt", "/../secret.txt"):
            r = client.get(path)
            assert r.status_code == 200
            assert "TOP-SECRET-VALUE" not in r.text
            assert "SAFE-INDEX-HTML" in r.text  # SPA-fallback отдал index.html

    def test_real_file_inside_dist_served(self, client, tmp_path, monkeypatch):
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("SAFE-INDEX-HTML", encoding="utf-8")
        (dist / "app.js").write_text("console.log(1)", encoding="utf-8")
        monkeypatch.setattr(config, "FRONTEND_DIST", dist)

        r = client.get("/app.js")
        assert r.status_code == 200
        assert r.text == "console.log(1)"  # легитимные файлы внутри dist доступны
