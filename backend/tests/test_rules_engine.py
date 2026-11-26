"""Tests for the medical rules engine and analyze orchestrator."""
import pytest
from app.services import rules, analyze
from app.services.llm import patient_alias


class TestRulesEngine:
    """Tests for the medical rules engine."""

    def test_normal_blood_pressure(self):
        """Normal BP should return ok status."""
        result = rules.analyze({"systolic": 115, "diastolic": 75})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "ok"

    def test_high_blood_pressure_stage1(self):
        """Stage 1 hypertension (140-159/90-99) should return warn status."""
        result = rules.analyze({"systolic": 135, "diastolic": 85})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "warn"

    def test_high_blood_pressure_stage2(self):
        """Stage 2 hypertension (160-179/100-109) should return alarm status."""
        result = rules.analyze({"systolic": 165, "diastolic": 105})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "alarm"

    def test_hypertensive_crisis(self):
        """Hypertensive crisis (>=180/>=110) should return alarm and urgent."""
        result = rules.analyze({"systolic": 190, "diastolic": 120})
        assert result.risk_level == "red"
        assert result.urgent is True

    def test_low_blood_pressure(self):
        """Low BP (90-99/60-79) should return warn."""
        result = rules.analyze({"systolic": 95, "diastolic": 60})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "warn"

    def test_severe_hypotension(self):
        """Severe hypotension (<90/<60) should return alarm."""
        result = rules.analyze({"systolic": 80, "diastolic": 50})
        bp_finding = next((f for f in result.findings if f.key == "blood_pressure"), None)
        assert bp_finding is not None
        assert bp_finding.status == "alarm"

    def test_normal_pulse(self):
        """Normal pulse (60-100) should return ok."""
        result = rules.analyze({"pulse": 70})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "ok"

    def test_tachycardia_warn(self):
        """Tachycardia (101-120) should return warn."""
        result = rules.analyze({"pulse": 110})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "warn"

    def test_tachycardia_alarm(self):
        """Severe tachycardia (>120) should return alarm."""
        result = rules.analyze({"pulse": 130})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "alarm"

    def test_bradycardia(self):
        """Bradycardia (50-59) should return warn."""
        result = rules.analyze({"pulse": 55})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "warn"

    def test_severe_bradycardia(self):
        """Severe bradycardia (<50) should return alarm."""
        result = rules.analyze({"pulse": 45})
        pulse_finding = next((f for f in result.findings if f.key == "pulse"), None)
        assert pulse_finding is not None
        assert pulse_finding.status == "alarm"

    def test_normal_temperature(self):
        """Normal temperature (36.1-37.0) should return ok."""
        result = rules.analyze({"temperature": 36.6})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "ok"

    def test_subfebrile(self):
        """Subfebrile (37.1-38.0) should return warn."""
        result = rules.analyze({"temperature": 37.5})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "warn"

    def test_fever(self):
        """Fever (38.1-39.0) should return alarm."""
        result = rules.analyze({"temperature": 38.5})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "alarm"

    def test_high_fever(self):
        """High fever (>39.0) should return alarm."""
        result = rules.analyze({"temperature": 39.5})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "alarm"

    def test_hypothermia(self):
        """Hypothermia (<35.0) should return alarm."""
        result = rules.analyze({"temperature": 34.5})
        temp_finding = next((f for f in result.findings if f.key == "temperature"), None)
        assert temp_finding is not None
        assert temp_finding.status == "alarm"

    def test_normal_spo2(self):
        """Normal SpO2 (>=95) should return ok."""
        result = rules.analyze({"spo2": 98})
        spo2_finding = next((f for f in result.findings if f.key == "spo2"), None)
        assert spo2_finding is not None
        assert spo2_finding.status == "ok"

    def test_low_spo2(self):
        """Low SpO2 (92-94) should return warn."""
        result = rules.analyze({"spo2": 93})
        spo2_finding = next((f for f in result.findings if f.key == "spo2"), None)
        assert spo2_finding is not None
        assert spo2_finding.status == "warn"

    def test_critical_spo2(self):
        """Critical SpO2 (<90) should return alarm."""
        result = rules.analyze({"spo2": 85})
        spo2_finding = next((f for f in result.findings if f.key == "spo2"), None)
        assert spo2_finding is not None
        assert spo2_finding.status == "alarm"

    def test_bmi_calculation(self):
        """BMI should be calculated when weight and height provided."""
        result = rules.analyze({"weight_kg": 80}, height_cm=180)
        assert result.bmi is not None
        assert abs(result.bmi - 24.7) < 0.2

    def test_bmi_none_without_height(self):
        """BMI should be None when height not provided."""
        result = rules.analyze({"weight_kg": 80})
        assert result.bmi is None

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
        result = rules.analyze({"systolic": 165, "diastolic": 105})
        assert result.risk_level == "red"

    def test_urgent_combination_bp_tachy(self):
        """High BP (stage 2+) + severe tachycardia should trigger urgent."""
        result = rules.analyze({"systolic": 165, "diastolic": 105, "pulse": 130})
        assert result.urgent is True

    def test_urgent_combination_bp_fever(self):
        """High BP (stage 2+) + fever should trigger urgent."""
        result = rules.analyze({"systolic": 165, "diastolic": 105, "temperature": 38.5})
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