"""Тесты контура доступа (ROADMAP С.3): обязательный филиал при регистрации,
срок действия кодов приглашения, отключение врача с отзывом сессий.

Дополнение к test_security.py: здесь — серверные гварды регистрации/доступа
и CLI-скрипты tools/make_invite.py, tools/disable_user.py.
"""
import importlib.util
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TOOLS_DIR = REPO_ROOT / "tools"


def _load_tool(name: str):
    """Импорт tools/<name>.py как модуля: в тесте исполняется тот же код,
    что запускает админ клиники из консоли."""
    spec = importlib.util.spec_from_file_location(f"tools_{name}", TOOLS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def _db() -> sqlite3.Connection:
    db = sqlite3.connect(config.DATABASE_PATH)
    db.row_factory = sqlite3.Row
    return db


def _make_invite(code: str, expires_at: str | None = None) -> None:
    db = _db()
    db.execute("INSERT INTO invite_codes (code, expires_at) VALUES (?, ?)", (code, expires_at))
    db.commit()
    db.close()


def _user_column(email: str, column: str):
    db = _db()
    row = db.execute(f"SELECT {column} FROM users WHERE email = ?", (email,)).fetchone()
    db.close()
    return None if row is None else row[column]


def _sessions_count(user_id: int) -> int:
    db = _db()
    n = db.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ?", (user_id,)).fetchone()[0]
    db.close()
    return n


class TestBranchRequired:
    """Дыра 1: branch_id обязателен на сервере для любой роли (фронтовый гвард не считается)."""

    def test_patient_without_branch_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "nb1@test.ru", "password": "test-password-2026", "name": "Без филиала",
        })
        assert resp.status_code == 422
        db = _db()
        n = db.execute("SELECT COUNT(*) FROM users WHERE email = 'nb1@test.ru'").fetchone()[0]
        db.close()
        assert n == 0  # «невидимый» пациент не создан

    def test_doctor_without_branch_422_code_not_burned(self, client):
        """Отказ не расходует одноразовый код: регистрация с филиалом возможна."""
        _make_invite("inv-nb")
        resp = client.post("/api/auth/register", json={
            "email": "nb2@test.ru", "password": "test-password-2026", "invite_code": "inv-nb",
        })
        assert resp.status_code == 422
        db = _db()
        row = db.execute("SELECT used_by FROM invite_codes WHERE code = 'inv-nb'").fetchone()
        n = db.execute("SELECT COUNT(*) FROM users WHERE email = 'nb2@test.ru'").fetchone()[0]
        db.close()
        assert row["used_by"] is None  # код не потрачен
        assert n == 0

    def test_patient_with_branch_registered(self, client):
        p = _register(client, "nb3@test.ru", branch_id=2)
        assert p["user"]["branch"]["id"] == 2

    def test_doctor_with_branch_registered(self, client):
        _make_invite("inv-br")
        d = _register(client, "doc-br@test.ru", invite_code="inv-br", branch_id=1)
        assert d["user"]["role"] == "doctor"
        assert d["user"]["branch"]["id"] == 1


class TestInviteExpiry:
    """Дыра 2: у кодов приглашения есть срок действия; проверяется при регистрации."""

    def test_expired_code_422(self, client):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        _make_invite("inv-expired", past)
        resp = client.post("/api/auth/register", json={
            "email": "exp1@test.ru", "password": "test-password-2026", "invite_code": "inv-expired",
            "branch_id": 1,
        })
        assert resp.status_code == 422
        assert "истёк" in resp.json()["detail"]
        db = _db()
        row = db.execute("SELECT used_by FROM invite_codes WHERE code = 'inv-expired'").fetchone()
        n = db.execute("SELECT COUNT(*) FROM users WHERE email = 'exp1@test.ru'").fetchone()[0]
        db.close()
        assert row["used_by"] is None  # просроченный код не помечается использованным
        assert n == 0

    def test_fresh_code_accepted(self, client):
        future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        _make_invite("inv-fresh", future)
        d = _register(client, "exp2@test.ru", invite_code="inv-fresh")
        assert d["user"]["role"] == "doctor"

    def test_legacy_code_without_expiry_accepted(self, client):
        """Коды, созданные до миграции (expires_at IS NULL), остаются бессрочными:
        срок не назначается задним числом."""
        _make_invite("inv-legacy", None)
        d = _register(client, "exp3@test.ru", invite_code="inv-legacy")
        assert d["user"]["role"] == "doctor"

    def test_make_invite_script_sets_expiry(self, client):
        """tools/make_invite.py проставляет срок: дефолт 14 дней, --days переопределяет."""
        tool = _load_tool("make_invite")
        tool.main(2)       # дефолтный срок
        tool.main(1, 30)   # свой срок
        db = _db()
        rows = db.execute("SELECT code, expires_at FROM invite_codes").fetchall()
        db.close()
        assert len(rows) == 3
        now = datetime.now(timezone.utc)
        expires_list = []
        for row in rows:
            assert row["expires_at"] is not None
            assert row["expires_at"].endswith("+00:00")  # UTC ISO — конвенция сессий (config.py)
            expires_list.append(datetime.fromisoformat(row["expires_at"]))
        assert any(now + timedelta(days=13) < e < now + timedelta(days=15) for e in expires_list)
        assert any(e > now + timedelta(days=29) for e in expires_list)

    def test_migration_adds_invite_expires_at(self, tmp_path, monkeypatch):
        """Миграция по образцу doctor_seen_at: колонка появляется у БД старой схемы."""
        path = _legacy_db(tmp_path, monkeypatch)
        db = sqlite3.connect(path)
        db.row_factory = sqlite3.Row
        cols = {r["name"] for r in db.execute("PRAGMA table_info(invite_codes)")}
        row = db.execute("SELECT expires_at FROM invite_codes WHERE code = 'old-code'").fetchone()
        db.close()
        assert "expires_at" in cols
        assert row["expires_at"] is None  # старым кодам срок не назначается задним числом


class TestDisabledUser:
    """Дыра 3: disable-флаг, отказ в доступе на сервере, отзыв сессий через CLI."""

    def test_disabled_token_rejected_401(self, client):
        p = _register(client, "dis1@test.ru")
        assert client.get("/api/auth/me", headers=_auth(p)).status_code == 200
        db = _db()
        db.execute("UPDATE users SET disabled = 1 WHERE email = 'dis1@test.ru'")
        db.commit()
        db.close()
        # валидный (неистёкший) токен больше не работает: get_current_user отклоняет disabled
        r = client.get("/api/auth/me", headers=_auth(p))
        assert r.status_code == 401

    def test_disabled_login_403_no_new_session(self, client):
        p = _register(client, "dis2@test.ru")
        db = _db()
        db.execute("UPDATE users SET disabled = 1 WHERE email = 'dis2@test.ru'")
        db.commit()
        db.close()
        before = _sessions_count(p["user"]["id"])
        r = client.post("/api/auth/login", json={"email": "dis2@test.ru", "password": "test-password-2026"})
        assert r.status_code == 403
        assert _sessions_count(p["user"]["id"]) == before  # новых сессий отключённому не выдаётся

    def test_disable_cli_revokes_sessions_and_blocks_token(self, client):
        """tools/disable_user.py: disable отзывает сессии; старый валидный токен → 401."""
        _make_invite("inv-cli")
        d = _register(client, "doc-cli@test.ru", invite_code="inv-cli", branch_id=1)
        old_token = d["token"]
        assert client.get("/api/auth/me", headers=_auth(d)).status_code == 200

        tool = _load_tool("disable_user")
        assert tool.main(["doc-cli@test.ru"]) == 0

        assert _user_column("doc-cli@test.ru", "disabled") == 1
        assert _sessions_count(d["user"]["id"]) == 0  # активные сессии отозваны
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"})
        assert r.status_code == 401  # «disable → 401 на любом валидном токене» (ROADMAP С.3)

    def test_enable_cli_restores_access(self, client):
        _make_invite("inv-cli2")
        _register(client, "doc2@test.ru", invite_code="inv-cli2", branch_id=1)
        tool = _load_tool("disable_user")
        assert tool.main(["doc2@test.ru"]) == 0
        assert client.post("/api/auth/login",
                           json={"email": "doc2@test.ru", "password": "test-password-2026"}).status_code == 403

        assert tool.main(["doc2@test.ru", "--enable"]) == 0
        assert _user_column("doc2@test.ru", "disabled") == 0
        r = client.post("/api/auth/login", json={"email": "doc2@test.ru", "password": "test-password-2026"})
        assert r.status_code == 200
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"})
        assert me.status_code == 200  # свежий токен снова работает

    def test_disable_cli_rejects_patient(self, client):
        """Скрипт отключает только врачей — пациенты не персонал клиники."""
        p = _register(client, "pat-cli@test.ru")
        tool = _load_tool("disable_user")
        rc = tool.main(["pat-cli@test.ru"])
        assert rc != 0
        assert _user_column("pat-cli@test.ru", "disabled") == 0
        assert _sessions_count(p["user"]["id"]) == 1  # сессия регистрации не тронута
        assert client.get("/api/auth/me", headers=_auth(p)).status_code == 200

    def test_disable_cli_unknown_email(self, client):
        tool = _load_tool("disable_user")
        assert tool.main(["ghost@test.ru"]) != 0

    def test_migration_adds_users_disabled(self, tmp_path, monkeypatch):
        """Миграция: колонка disabled появляется у БД старой схемы, доступ не отозван."""
        path = _legacy_db(tmp_path, monkeypatch)
        db = sqlite3.connect(path)
        db.row_factory = sqlite3.Row
        cols = {r["name"] for r in db.execute("PRAGMA table_info(users)")}
        row = db.execute("SELECT disabled FROM users WHERE email = 'old@clinic.ru'").fetchone()
        db.close()
        assert "disabled" in cols
        assert row["disabled"] == 0
        # разделение ФИО: у старой БД части имени доливаются миграцией
        assert {"first_name", "last_name", "middle_name"} <= cols


def _legacy_db(tmp_path, monkeypatch) -> Path:
    """БД схемы «до С.3»: users без disabled, invite_codes без expires_at.
    init_db должна долить колонки миграциями, не трогая существующие строки."""
    path = tmp_path / "legacy.db"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name          TEXT NOT NULL DEFAULT '',
            age           INTEGER,
            sex           TEXT,
            height_cm     REAL,
            role          TEXT NOT NULL DEFAULT 'patient',
            branch_id     INTEGER,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE invite_codes (
            code       TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            used_by    INTEGER,
            used_at    TEXT
        );
        INSERT INTO users (email, password_hash, role, branch_id)
            VALUES ('old@clinic.ru', 'x', 'doctor', NULL);
        INSERT INTO invite_codes (code) VALUES ('old-code');
    """)
    db.commit()
    db.close()
    monkeypatch.setattr(config, "DATABASE_PATH", path)
    database.init_db()
    return path
