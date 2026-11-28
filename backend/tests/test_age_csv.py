"""Возрастные нормы (Е4) и CSV-выгрузка пациентов (Е6)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import config, database
from app.main import app
from app.services import rules


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "age.db")
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


class TestAgeNorms:
    def test_pulse_65plus_relaxed(self):
        """Пульс 57 у 70-летнего — вариант нормы; у 40-летнего — внимание."""
        senior = rules.analyze({"pulse": 57}, age=70)
        adult = rules.analyze({"pulse": 57}, age=40)
        pulse_of = lambda r: next(f for f in r.findings if f.key == "pulse")
        assert pulse_of(senior).status == "ok"
        assert pulse_of(adult).status == "warn"

    def test_pulse_alarm_threshold_same(self):
        """Ниже 50 — тревога в любой возрастной группе."""
        for age in (40, 70):
            result = rules.analyze({"pulse": 48}, age=age)
            pulse = next(f for f in result.findings if f.key == "pulse")
            assert pulse.status == "alarm", age

    def test_bmi_senior_band(self):
        """ИМТ 25.7: у 40-летнего — избыточная масса, у 70-летнего — норма."""
        adult = rules.analyze({"weight_kg": 70}, height_cm=165, age=40)
        senior = rules.analyze({"weight_kg": 70}, height_cm=165, age=70)
        bmi_of = lambda r: next(f for f in r.findings if f.key == "bmi")
        assert bmi_of(adult).status == "warn"
        assert bmi_of(senior).status == "ok"
        assert bmi_of(senior).norm == "22–27.9"

    def test_bmi_senior_underweight_threshold(self):
        """Недостаточный вес у пожилых начинается раньше (22 вместо 18.5)."""
        result = rules.analyze({"weight_kg": 54}, height_cm=157, age=72)  # ИМТ ≈ 21.9
        bmi = next(f for f in result.findings if f.key == "bmi")
        assert bmi.status == "warn"

    def test_no_age_still_works(self):
        """Возраст не передан — прежние взрослые пороги (обратная совместимость)."""
        result = rules.analyze({"pulse": 57})
        pulse = next(f for f in result.findings if f.key == "pulse")
        assert pulse.status == "warn"

    def test_age_passes_through_run_analysis(self, client):
        """run_analysis передаёт возраст пользователя в движок правил."""
        from app.services.analyze import run_analysis
        db = database.connect()
        cursor = db.execute(
            "INSERT INTO users (email, password_hash, name, age, height_cm, role, branch_id)"
            " VALUES ('age-run@test.ru', 'hash', 'Т', 70, 165, 'patient', 1)")
        user_id = cursor.lastrowid
        cursor = db.execute(
            "INSERT INTO measurements (user_id, pulse, weight_kg) VALUES (?, 57, 70)",
            (user_id,))
        meas_id = cursor.lastrowid
        user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        measurement = db.execute("SELECT * FROM measurements WHERE id=?", (meas_id,)).fetchone()
        db.close()
        result = run_analysis(measurement, user)
        pulse = next(f for f in result["findings"] if f["key"] == "pulse")
        bmi = next(f for f in result["findings"] if f["key"] == "bmi")
        assert pulse["status"] == "ok" and bmi["status"] == "ok"


class TestPatientsCsv:
    def test_csv_export(self, client):
        patient = _register(client, "csv1@test.ru")
        client.put("/api/auth/me", json={"phone": "+7 (900) 123-45-67"}, headers=_auth(patient))
        doctor = _doctor_inv(client, "csvdoc@test.ru")
        client.post("/api/measurements", json={"systolic": 170, "diastolic": 105},
                    headers=_auth(patient))
        from app.services.analyze import run_analysis
        db = database.connect()
        user = db.execute("SELECT * FROM users WHERE email='csv1@test.ru'").fetchone()
        measurement = db.execute(
            "SELECT * FROM measurements WHERE user_id=?", (user["id"],)).fetchone()
        run_analysis(measurement, user)
        db.close()

        r = client.get("/api/doctor/patients/export.csv", headers=_auth(doctor))
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        text = r.content.decode("utf-8-sig")
        assert text.startswith("ФИО;Email;Телефон")
        assert "csv1@test.ru" in text and "Тревога" in text

    def test_csv_requires_doctor(self, client):
        p = _register(client, "csv2@test.ru")
        assert client.get("/api/doctor/patients/export.csv", headers=_auth(p)).status_code == 403

    def test_csv_only_own_branch(self, client):
        _register(client, "csv3@test.ru", branch_id=2)
        doctor = _doctor_inv(client, "csv3doc@test.ru", branch_id=1)
        r = client.get("/api/doctor/patients/export.csv", headers=_auth(doctor))
        assert "csv3@test.ru" not in r.content.decode("utf-8-sig")


def _doctor_inv(c: TestClient, email: str, branch_id: int = 1) -> dict:
    db = database.connect()
    db.execute("INSERT OR IGNORE INTO invite_codes (code) VALUES (?)", (f"inv-{email}",))
    db.commit()
    db.close()
    return _register(c, email, branch_id=branch_id, invite_code=f"inv-{email}")
