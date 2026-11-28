"""Pytest fixtures for backend tests."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import init_db
from app.services import rules
from app.services.llm import patient_alias


@pytest.fixture(autouse=True)
def isolate_background_ocr(monkeypatch):
    """Worker не должен перейти на следующую временную БД между тестами."""
    from app import config
    from app.services import ocr
    ocr.stop_local_worker()
    monkeypatch.setattr(config, "OCR_ENABLED", False)
    monkeypatch.setattr(config, "_ocr_model_installed", lambda: False)
    yield
    ocr.stop_local_worker()


@pytest.fixture(autouse=True)
def reset_in_memory_rate_limits():
    """Лимитеры — состояние приложения, а не общее состояние всех тестов."""
    from app.routers import auth, chat
    for obj in (auth, chat):
        for value in vars(obj).values():
            events = getattr(value, "_events", None)
            if events is not None:
                events.clear()
    yield


@pytest.fixture(scope="session")
def db_path(tmp_path_factory):
    """Create a temporary database for testing."""
    db_file = tmp_path_factory.mktemp("data") / "test_medai.db"
    return str(db_file)


@pytest.fixture(scope="function")
def db_session(db_path):
    """Create a fresh database session for each test."""
    import os
    os.environ["DATABASE_PATH"] = db_path
    
    # Re-import to pick up new path
    import importlib

    import app.database
    importlib.reload(app.database)
    from app.database import db_session as db_sess
    
    init_db()
    with db_sess() as conn:
        yield conn


@pytest.fixture
def sample_user(db_session):
    """Create a sample user in the database with unique email."""
    import uuid
    unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    cursor = db_session.cursor()
    cursor.execute("""
        INSERT INTO users (branch_id, email, password_hash, name, age, sex, height_cm, role, disabled, created_at)
        VALUES (1, ?, 'hash', 'Тест Тестов', 35, 'male', 180, 'patient', 0, datetime('now'))
    """, (unique_email,))
    db_session.commit()
    user_id = cursor.lastrowid
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    return cursor.fetchone()


@pytest.fixture
def sample_measurement(db_session, sample_user):
    """Create a sample measurement in the database."""
    cursor = db_session.cursor()
    cursor.execute("""
        INSERT INTO measurements (user_id, systolic, diastolic, pulse, temperature, spo2, sleep_hours, steps, water_ml, weight_kg, recorded_at)
        VALUES (?, 120, 80, 72, 36.6, 98, 8.0, 8000, 2000, 75.5, datetime('now', 'localtime'))
    """, (sample_user["id"],))
    db_session.commit()
    meas_id = cursor.lastrowid
    cursor.execute("SELECT * FROM measurements WHERE id = ?", (meas_id,))
    return cursor.fetchone()


@pytest.fixture
def mock_llm_enrich(monkeypatch):
    """Mock LLM enrich function for testing."""
    def mock_enrich(profile, indicators, rule_result):
        return {
            "summary": "Тестовое резюме от LLM",
            "items": ["Пункт 1", "Пункт 2"]
        }
    monkeypatch.setattr("app.services.analyze.llm_service.enrich", mock_enrich)


class TestRulesEngine:
    """Tests for the medical rules engine."""

    def test_normal_blood_pressure(self):
        """Normal BP should return ok status."""
        result = rules.analyze({"systolic": 115, "diastolic": 75})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "ok"

    def test_high_blood_pressure_stage1(self):
        """Stage 1 hypertension should return warn status."""
        result = rules.analyze({"systolic": 135, "diastolic": 85})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "warn"

    def test_high_blood_pressure_stage2(self):
        """Stage 2 hypertension should return alarm status."""
        result = rules.analyze({"systolic": 150, "diastolic": 95})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "alarm"

    def test_hypertensive_crisis(self):
        """Hypertensive crisis should return alarm and urgent."""
        result = rules.analyze({"systolic": 190, "diastolic": 120})
        assert result.risk_level == "red"
        assert result.urgent is True

    def test_low_blood_pressure(self):
        """Low BP should return warn."""
        result = rules.analyze({"systolic": 95, "diastolic": 60})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "warn"

    def test_severe_hypotension(self):
        """Severe hypotension should return alarm."""
        result = rules.analyze({"systolic": 80, "diastolic": 50})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "alarm"

    def test_normal_pulse(self):
        """Normal pulse should return ok."""
        result = rules.analyze({"pulse": 70})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "ok"

    def test_tachycardia(self):
        """Tachycardia should return alarm."""
        result = rules.analyze({"pulse": 110})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "alarm"

    def test_bradycardia(self):
        """Bradycardia should return warn."""
        result = rules.analyze({"pulse": 50})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "warn"

    def test_normal_temperature(self):
        """Normal temperature should return ok."""
        result = rules.analyze({"temperature": 36.6})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "ok"

    def test_fever(self):
        """Fever should return alarm."""
        result = rules.analyze({"temperature": 38.5})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "alarm"

    def test_hypothermia(self):
        """Hypothermia should return alarm."""
        result = rules.analyze({"temperature": 35.0})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "alarm"

    def test_normal_spo2(self):
        """Normal SpO2 should return ok."""
        result = rules.analyze({"spo2": 98})
        spo2_finding = next((f for f in result.findings if f.key == "spo2"), None)
        assert spo2_finding is not None
        assert spo2_finding.status == "ok"

    def test_low_spo2(self):
        """Low SpO2 should return alarm."""
        result = rules.analyze({"spo2": 92})
        spo2_finding = next((f for f in result.findings if f.key == "spo2"), None)
        assert spo2_finding is not None
        assert spo2_finding.status == "alarm"

    def test_bmi_calculation(self):
        """BMI should be calculated when weight and height provided."""
        result = rules.analyze({"weight_kg": 80}, height_cm=180)
        assert result.bmi is not None
        assert abs(result.bmi - 24.7) < 0.2

    def test_risk_level_green_all_ok(self):
        """All normal indicators should give green risk."""
        result = rules.analyze({
            "systolic": 115, "diastolic": 75,
            "pulse": 70, "temperature": 36.6,
            "spo2": 98, "sleep_hours": 8,
            "steps": 8000, "water_ml": 2000
        })
        assert result.risk_level == "green"
        assert not result.urgent

    def test_risk_level_yellow_warn(self):
        """Any warn should give yellow risk."""
        result = rules.analyze({"systolic": 135, "diastolic": 85})
        assert result.risk_level == "yellow"

    def test_risk_level_red_alarm(self):
        """Any alarm should give red risk."""
        result = rules.analyze({"systolic": 150, "diastolic": 95})
        assert result.risk_level == "red"

    def test_urgent_combination_bp_tachy(self):
        """High BP + tachycardia should trigger urgent."""
        result = rules.analyze({"systolic": 150, "diastolic": 95, "pulse": 110})
        assert result.urgent is True

    def test_urgent_combination_bp_fever(self):
        """High BP + fever should trigger urgent."""
        result = rules.analyze({"systolic": 150, "diastolic": 95, "temperature": 38.5})
        assert result.urgent is True


class TestAnalyzeOrchestrator:
    """Tests for the analyze orchestrator."""

    def test_run_analysis_basic(self, db_session, sample_user, sample_measurement, mock_llm_enrich):
        """Full analysis should return complete result."""
        from app.services.analyze import run_analysis
        
        result = run_analysis(sample_measurement, sample_user)
        
        assert "risk_level" in result
        assert "findings" in result
        assert "recommendations" in result
        assert "urgent" in result
        assert "bmi" in result
        assert "llm_summary" in result
        assert "llm_items" in result
        assert "source" in result
        assert result["source"] == "rules+llm"
        assert result["llm_summary"] == "Тестовое резюме от LLM"

    def test_run_analysis_without_llm(self, db_session, sample_user, sample_measurement, monkeypatch):
        """Analysis should work when LLM fails."""
        def mock_enrich_fail(profile, indicators, rule_result):
            return None
        monkeypatch.setattr("app.services.analyze.llm_service.enrich", mock_enrich_fail)
        
        from app.services.analyze import run_analysis
        result = run_analysis(sample_measurement, sample_user)
        
        assert result["source"] == "rules"
        assert result["llm_summary"] is None
        assert result["llm_items"] is None


class TestPatientAlias:
    """Tests for patient anonymization."""

    def test_patient_alias_format(self):
        """Alias не раскрывает ID записи БД."""
        alias = patient_alias(42, 35)
        assert alias == "Пациент, 35 лет"

    def test_patient_alias_no_pii(self):
        """Alias should not contain name, email, or other PII."""
        alias = patient_alias(999, 25)
        assert "999" not in alias
        assert "25" in alias
        assert "Тестов" not in alias
        assert "test@" not in alias