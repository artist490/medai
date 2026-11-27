"""Разделение ФИО: имя/фамилия/отчество отдельно, name — собранное отображаемое поле."""
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
    with TestClient(app, headers={"X-Client-Type": "api"}) as c:
        yield c


def _register(c: TestClient, email: str, **extra) -> dict:
    extra.setdefault("branch_id", 1)
    resp = c.post("/api/auth/register", json={
        "email": email, "password": "test-password-2026", **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


class TestFullName:
    def test_register_composes_display_name(self, client):
        """Фамилия Имя Отчество собираются в name, части приходят отдельно."""
        p = _register(client, "fio1@test.ru", first_name="Иван", last_name="Иванов",
                      middle_name="Иванович")
        me = client.get("/api/auth/me", headers=_auth(p)).json()
        assert me["first_name"] == "Иван"
        assert me["last_name"] == "Иванов"
        assert me["middle_name"] == "Иванович"
        assert me["name"] == "Иванов Иван Иванович"

    def test_register_without_patronymic(self, client):
        p = _register(client, "fio2@test.ru", first_name="Анна", last_name="Смирнова")
        me = client.get("/api/auth/me", headers=_auth(p)).json()
        assert me["name"] == "Смирнова Анна"
        assert me["middle_name"] == ""

    def test_legacy_name_kept_when_no_parts(self, client):
        """Аккаунты до разделения: разовое name живёт, пока части не заполнены."""
        p = _register(client, "legacy@test.ru", name="Демо Пациент")
        me = client.get("/api/auth/me", headers=_auth(p)).json()
        assert me["name"] == "Демо Пациент"
        assert me["first_name"] == ""

    def test_profile_partial_update_recomposes(self, client):
        """Правка одного поля пересобирает name из всех трёх частей."""
        p = _register(client, "fio3@test.ru", first_name="Иван", last_name="Иванов",
                      middle_name="Иванович")
        r = client.put("/api/auth/me", json={"middle_name": "Петрович"}, headers=_auth(p))
        assert r.json()["name"] == "Иванов Иван Петрович"
        assert r.json()["middle_name"] == "Петрович"

    def test_profile_clear_patronymic(self, client):
        """Пустая строка очищает отчество (не фильтруется как None)."""
        p = _register(client, "fio4@test.ru", first_name="Иван", last_name="Иванов",
                      middle_name="Иванович")
        r = client.put("/api/auth/me", json={"middle_name": ""}, headers=_auth(p))
        assert r.json()["middle_name"] == ""
        assert r.json()["name"] == "Иванов Иван"

    def test_profile_age_update_does_not_touch_name(self, client):
        p = _register(client, "legacy2@test.ru", name="Демо Пациент")
        r = client.put("/api/auth/me", json={"age": 40}, headers=_auth(p))
        assert r.json()["name"] == "Демо Пациент"

    def test_profile_filling_parts_replaces_legacy_name(self, client):
        p = _register(client, "legacy3@test.ru", name="Демо Пациент")
        r = client.put("/api/auth/me", json={"first_name": "Иван", "last_name": "Иванов"},
                       headers=_auth(p))
        assert r.json()["name"] == "Иванов Иван"

    def test_doctor_pool_shows_composed_name(self, client):
        """Пул врача читает тот же name — ФИО видно без правок doctor.py."""
        db = __import__("sqlite3").connect(config.DATABASE_PATH)
        db.execute("INSERT INTO invite_codes (code) VALUES (?)", ("inv-fio",))
        db.commit()
        db.close()
        doc = _register(client, "fio-doc@test.ru", invite_code="inv-fio", branch_id=1,
                        first_name="Зоя", last_name="Врачева")
        _register(client, "fio-pat@test.ru", branch_id=1, first_name="Иван",
                  last_name="Иванов", middle_name="Иванович")
        pool = client.get("/api/doctor/patients", headers=_auth(doc)).json()
        names = [p["name"] for p in pool["items"]]
        assert "Иванов Иван Иванович" in names
