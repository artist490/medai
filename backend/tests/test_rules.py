"""Тесты движка правил: пороги, статусы, комбинации, итоговый риск."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.rules import analyze, calc_bmi


def bp(s, d=None):
    return analyze({"systolic": s, "diastolic": d if d is not None else s - 10})


class TestBloodPressure:
    def test_optimal(self):
        r = bp(110, 70)
        f = r.findings[0]
        assert f.status == "ok" and r.risk_level == "green"

    def test_high_normal_warn(self):
        r = bp(135, 88)
        assert r.findings[0].status == "warn" and r.risk_level == "yellow"

    def test_grade1_warn(self):
        r = bp(150, 95)
        assert r.findings[0].status == "warn" and r.risk_level == "yellow"

    def test_grade2_alarm(self):
        r = bp(165, 105)
        assert r.findings[0].status == "alarm" and r.risk_level == "red"

    def test_crisis_alarm(self):
        r = bp(190, 120)
        assert r.findings[0].status == "alarm" and r.risk_level == "red" and r.urgent

    def test_hypotension_warn(self):
        r = bp(95, 55)
        assert r.findings[0].status == "warn" and r.risk_level == "yellow"

    def test_severe_hypotension_alarm(self):
        r = bp(85, 50)
        assert r.findings[0].status == "alarm" and r.risk_level == "red"

    def test_worst_of_both_used(self):
        # систолическое нормальное, диастолическое — АГ 2 степени
        r = bp(125, 105)
        assert r.findings[0].status == "alarm"


class TestPulse:
    def test_normal(self):
        assert analyze({"pulse": 72}).risk_level == "green"

    def test_brady_warn(self):
        assert analyze({"pulse": 55}).risk_level == "yellow"

    def test_brady_alarm(self):
        assert analyze({"pulse": 45}).risk_level == "red"

    def test_tachy_warn(self):
        assert analyze({"pulse": 110}).risk_level == "yellow"

    def test_tachy_alarm(self):
        assert analyze({"pulse": 135}).risk_level == "red"


class TestTemperature:
    def test_normal(self):
        assert analyze({"temperature": 36.6}).risk_level == "green"

    def test_subfebrile_warn(self):
        assert analyze({"temperature": 37.5}).risk_level == "yellow"

    def test_fever_alarm(self):
        assert analyze({"temperature": 38.5}).risk_level == "red"

    def test_high_fever_alarm(self):
        r = analyze({"temperature": 39.6})
        assert r.risk_level == "red" and r.urgent


class TestSpo2:
    def test_normal(self):
        assert analyze({"spo2": 98}).risk_level == "green"

    def test_borderline_warn(self):
        assert analyze({"spo2": 93}).risk_level == "yellow"

    def test_low_alarm_urgent(self):
        r = analyze({"spo2": 89})
        assert r.risk_level == "red" and r.urgent
        assert "103" in r.recommendations[0]


class TestBmi:
    def test_calc(self):
        assert calc_bmi(170, 65) == 22.5

    def test_none_without_height(self):
        assert calc_bmi(None, 65) is None

    def test_normal(self):
        r = analyze({"weight_kg": 65}, height_cm=170)
        assert r.risk_level == "green" and r.bmi == 22.5

    def test_overweight_warn(self):
        r = analyze({"weight_kg": 90}, height_cm=170)
        assert r.risk_level == "yellow" and r.bmi == 31.1

    def test_obese_alarm(self):
        r = analyze({"weight_kg": 115}, height_cm=170)
        assert r.risk_level == "red"


class TestLifestyle:
    def test_good_sleep_steps_water(self):
        r = analyze({"sleep_hours": 8, "steps": 9000, "water_ml": 2000})
        assert r.risk_level == "green"

    def test_lack_of_sleep_warn(self):
        assert analyze({"sleep_hours": 5}).risk_level == "yellow"

    def test_low_water_warn(self):
        assert analyze({"water_ml": 800}).risk_level == "yellow"

    def test_too_much_water_warn(self):
        assert analyze({"water_ml": 4500}).risk_level == "yellow"

    def test_low_steps_warn(self):
        assert analyze({"steps": 1500}).risk_level == "yellow"


class TestCombinations:
    def test_fever_plus_tachycardia(self):
        r = analyze({"temperature": 37.8, "pulse": 105})
        joined = " ".join(r.recommendations)
        assert "Жар" in joined or "жар" in joined

    def test_bp_plus_pulse(self):
        bp(145, 92)
        r2 = analyze({"systolic": 145, "diastolic": 92, "pulse": 105})
        joined = " ".join(r2.recommendations)
        assert "вместе" in joined

    def test_bmi_plus_low_steps(self):
        r = analyze({"weight_kg": 95, "steps": 1200}, height_cm=170)
        joined = " ".join(r.recommendations)
        assert "прогулок" in joined

    def test_low_bp_with_dehydration(self):
        r = analyze({"systolic": 95, "diastolic": 55, "water_ml": 900})
        joined = " ".join(r.recommendations)
        assert "обезвоживанием" in joined


class TestEdgeCases:
    def test_empty(self):
        r = analyze({})
        assert r.risk_level == "green" and r.findings == []

    def test_green_gets_base_tips(self):
        r = analyze({"pulse": 70})
        assert len(r.recommendations) >= 3

    def test_urgent_first_recommendation(self):
        r = analyze({"spo2": 90, "systolic": 180, "diastolic": 115})
        assert r.urgent
        assert any("103" in rec for rec in r.recommendations)

    def test_to_dict(self):
        r = bp(120, 80).to_dict()
        assert r["risk_level"] in ("green", "yellow")
        assert isinstance(r["findings"], list)
        assert "bmi" in r
