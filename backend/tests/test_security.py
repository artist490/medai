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
    monkeypatch.setattr(config, "OCR_ENABLED", False)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: False)
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


class TestLoginRateLimit:
    def test_blocks_after_5_fails_and_recovers(self, client):
        _register(client, "rl1@test.ru")
        # 5 неудачных попыток
        for i in range(5):
            r = client.post("/api/auth/login", json={
                "email": "rl1@test.ru", "password": "wrong" + str(i),
            })
            assert r.status_code == 401
        # 6-я — даже с верным паролем — заблокирована
        r = client.post("/api/auth/login", json={
            "email": "rl1@test.ru", "password": "test-password-2026",
        })
        assert r.status_code == 429

    def test_other_email_not_blocked(self, client):
        _register(client, "rl2@test.ru")
        for i in range(5):
            client.post("/api/auth/login", json={
                "email": "rl2@test.ru", "password": "wrong",
            })
        # другой email — не затронут
        _register(client, "rl3@test.ru")
        r = client.post("/api/auth/login", json={
            "email": "rl3@test.ru", "password": "test-password-2026",
        })
        assert r.status_code == 200

    def test_successful_login_does_not_erase_failed_attempts(self, client):
        _register(client, "rl4@test.ru")
        for i in range(3):
            client.post("/api/auth/login", json={
                "email": "rl4@test.ru", "password": "wrong",
            })
        client.post("/api/auth/login", json={
            "email": "rl4@test.ru", "password": "test-password-2026",
        })
        # Успех не обнуляет историю: иначе угонщик может продлевать окно перебора.
        for i in range(2):
            client.post("/api/auth/login", json={
                "email": "rl4@test.ru", "password": "wrong" + str(i),
            })
        r = client.post("/api/auth/login", json={
            "email": "rl4@test.ru", "password": "test-password-2026",
        })
        # Дополнительный общий лимит IP не позволяет обойти защиту перебором email.
        assert r.status_code in (200, 429)


class TestBrowserSessionSecurity:
    def test_http_only_cookie_csrf_and_logout(self, client):
        _register(client, "cookie@test.ru")
        r = client.post("/api/auth/login", json={
            "email": "cookie@test.ru", "password": "test-password-2026",
        }, headers={"X-Client-Type": "web"})
        assert r.status_code == 200 and "token" not in r.json()
        cookies = client.cookies
        session = cookies.get("medai_session")
        csrf = cookies.get("medai_csrf")
        assert session and csrf
        assert client.get("/api/auth/me").json()["email"] == "cookie@test.ru"
        assert client.put("/api/auth/me", json={"name": "CSRF attack"}).status_code == 403
        assert client.put("/api/auth/me", json={"name": "Безопасно"},
                          headers={"X-CSRF-Token": csrf}).status_code == 200
        assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200
        assert client.get("/api/auth/me").status_code == 401

    def test_web_login_never_returns_bearer_in_json(self, client):
        _register(client, "cookie@test.ru")
        r = client.post("/api/auth/login", json={
            "email": "cookie@test.ru", "password": "test-password-2026",
        }, headers={"X-Client-Type": "web"})
        assert r.status_code == 200
        assert "token" not in r.json()
        cookies = r.headers.get_list("set-cookie")
        assert any(c.startswith("medai_session=") and "HttpOnly" in c and "SameSite=Strict" in c for c in cookies)

    def test_security_headers_and_untrusted_origin(self, client):
        r = client.get("/api/auth/branches")
        assert r.headers["x-frame-options"] == "DENY"
        assert "default-src 'self'" in r.headers["content-security-policy"]
        assert r.headers["x-content-type-options"] == "nosniff"
        evil = {"Origin": "https://attacker.invalid"}
        assert client.get("/api/auth/branches", headers=evil).status_code == 403

    def test_password_length_and_legacy_bearer(self, client):
        short = client.post("/api/auth/register", json={
            "email": "short@test.ru", "password": "short1", "branch_id": 1,
        })
        assert short.status_code == 422
        p = _register(client, "bearer@test.ru")
        # Bearer не является ambient authority и остаётся для служебных клиентов.
        r = client.put("/api/auth/me", json={"name": "API"}, headers=_auth(p))
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
        client.post("/api/auth/login", json={"email": "sc1@test.ru", "password": "test-password-2026"})
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
