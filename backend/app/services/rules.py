"""Движок правил: медицинские нормы, статусы показателей, комбинации и рекомендации.

Статусы: "ok" (норма), "warn" (внимание), "alarm" (тревога → к врачу).
Итоговый риск: green / yellow / red. Риск определяется ТОЛЬКО правилами —
LLM не может его изменить (см. analyze.py).
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Finding:
    key: str            # ключ показателя: blood_pressure, pulse, ...
    label: str          # человекочитаемое название
    value: str          # значение строкой (или "—")
    unit: str
    status: str         # ok | warn | alarm
    message: str        # что это значит
    norm: str           # диапазон нормы для подсказки


@dataclass
class RuleResult:
    risk_level: str                       # green | yellow | red
    findings: List[Finding] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    urgent: bool = False                  # есть ли флаг срочного обращения к врачу
    bmi: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "risk_level": self.risk_level,
            "findings": [f.__dict__ for f in self.findings],
            "recommendations": self.recommendations,
            "urgent": self.urgent,
            "bmi": self.bmi,
        }


# ---------------------------------------------------------------- пороги ----

def _bp_finding(systolic: Optional[float], diastolic: Optional[float]) -> Optional[Finding]:
    """Классификация АД по ESC/ESH (2023). Для категории берём худший показатель."""
    if systolic is None and diastolic is None:
        return None
    sys_ = systolic if systolic is not None else 0
    dia_ = diastolic if diastolic is not None else 0
    value = f"{systolic:g}/{diastolic:g}" if systolic is not None and diastolic is not None \
        else f"{systolic if systolic is not None else '—'}/{diastolic if diastolic is not None else '—'}"
    norm = "до 120/80"

    def sys_cat(v: float) -> int:
        if v < 90: return -2       # выраженная гипотония
        if v < 100: return -1      # гипотония
        if v < 120: return 0       # оптимальное
        if v < 130: return 1       # нормальное
        if v < 140: return 2       # повышенное нормальное
        if v < 160: return 3       # АГ 1 степени
        if v < 180: return 4       # АГ 2 степени
        return 5                   # АГ 3 степени / криз

    def dia_cat(v: float) -> int:
        if v < 60: return -1
        if v < 80: return 0
        if v < 85: return 1
        if v < 90: return 2
        if v < 100: return 3
        if v < 110: return 4
        return 5

    # Тяжесть отклонения от нормы: чем дальше от зоны 0..1, тем хуже
    severity = {-2: 3, -1: 2, 0: 0, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4}

    def cat_of(v: Optional[float], fn) -> Optional[int]:
        return fn(v) if v is not None else None

    sys_c = cat_of(systolic, sys_cat)
    dia_c = cat_of(diastolic, dia_cat)
    candidates = [c for c in (sys_c, dia_c) if c is not None]
    cat = max(candidates, key=lambda c: severity[c])

    if cat <= -2:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "alarm", "Выраженная гипотония — возможны обмороки, обратитесь к врачу", norm)
    if cat == -1:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "warn", "Пониженное давление: возможны слабость и головокружение", norm)
    if cat <= 1:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "ok", "Давление в норме — так держать", norm)
    if cat == 2:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "warn", "Повышенное нормальное: следите за солью и стрессом", norm)
    if cat == 3:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "warn", "Артериальная гипертензия 1 степени — стоит показаться терапевту", norm)
    if cat == 4:
        return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                       "alarm", "Артериальная гипертензия 2 степени — обратитесь к врачу", norm)
    return Finding("blood_pressure", "Артериальное давление", value, "мм рт. ст.",
                   "alarm", "Очень высокое давление! Возможен гипертонический криз — срочно к врачу", norm)


def _pulse_finding(pulse: Optional[float]) -> Optional[Finding]:
    if pulse is None:
        return None
    if pulse < 50:
        return Finding("pulse", "Пульс", f"{pulse:g}", "уд/мин", "alarm",
                       "Выраженная брадикардия — обратитесь к врачу", "60–100")
    if pulse < 60:
        return Finding("pulse", "Пульс", f"{pulse:g}", "уд/мин", "warn",
                       "Пульс ниже нормы — если вы не спортсмен, сообщите врачу", "60–100")
    if pulse <= 100:
        return Finding("pulse", "Пульс", f"{pulse:g}", "уд/мин", "ok",
                       "Пульс в норме", "60–100")
    if pulse <= 120:
        return Finding("pulse", "Пульс", f"{pulse:g}", "уд/мин", "warn",
                       "Учащённый пульс: кофеин, стресс или нагрузка — отдохните и перемерьте", "60–100")
    return Finding("pulse", "Пульс", f"{pulse:g}", "уд/мин", "alarm",
                   "Сильно учащённый пульс (тахикардия) — обратитесь к врачу", "60–100")


def _temp_finding(temp: Optional[float]) -> Optional[Finding]:
    if temp is None:
        return None
    if temp < 35.0:
        return Finding("temperature", "Температура", f"{temp:g}", "°C", "alarm",
                       "Переохлаждение — срочно согрейтесь и обратитесь к врачу", "36.1–37.0")
    if temp < 36.1:
        return Finding("temperature", "Температура", f"{temp:g}", "°C", "warn",
                       "Немного снижена — тепло одевайтесь, проверьте повторно", "36.1–37.0")
    if temp <= 37.0:
        return Finding("temperature", "Температура", f"{temp:g}", "°C", "ok",
                       "Температура в норме", "36.1–37.0")
    if temp <= 38.0:
        return Finding("temperature", "Температура", f"{temp:g}", "°C", "warn",
                       "Субфебрильная: пейте больше жидкости, наблюдайте за состоянием", "36.1–37.0")
    if temp <= 39.0:
        return Finding("temperature", "Температура", f"{temp:g}", "°C", "alarm",
                       "Высокая температура — обратитесь к врачу и отдыхайте", "36.1–37.0")
    return Finding("temperature", "Температура", f"{temp:g}", "°C", "alarm",
                   "Очень высокая температура! Срочно к врачу или вызывайте 103", "36.1–37.0")


def _spo2_finding(spo2: Optional[float]) -> Optional[Finding]:
    if spo2 is None:
        return None
    if spo2 < 92:
        return Finding("spo2", "Сатурация (SpO₂)", f"{spo2:g}", "%", "alarm",
                       "Низкая сатурация! Возможна гипоксия — срочно к врачу или 103", "95–100")
    if spo2 < 95:
        return Finding("spo2", "Сатурация (SpO₂)", f"{spo2:g}", "%", "warn",
                       "Чуть ниже нормы: перемерьте спокойно, при одышке — к врачу", "95–100")
    return Finding("spo2", "Сатурация (SpO₂)", f"{spo2:g}", "%", "ok",
                   "Сатурация в норме", "95–100")


def _bmi_finding(bmi: Optional[float]) -> Optional[Finding]:
    if bmi is None:
        return None
    if bmi < 16:
        msg, st = "Выраженный дефицит массы — обратитесь к врачу", "alarm"
    elif bmi < 18.5:
        msg, st = "Недостаточный вес — добавьте калорийности рациону", "warn"
    elif bmi < 25:
        msg, st = "ИМТ в норме — отличный результат", "ok"
    elif bmi < 30:
        msg, st = "Избыточная масса — помогут питание и шаги", "warn"
    elif bmi < 35:
        msg, st = "Ожирение 1 степени — обсудите с врачом план снижения веса", "warn"
    else:
        msg, st = "Ожирение 2+ степени — важно обратиться к врачу", "alarm"
    return Finding("bmi", "ИМТ", f"{bmi:g}", "кг/м²", st, msg, "18.5–24.9")


def _sleep_finding(sleep: Optional[float]) -> Optional[Finding]:
    if sleep is None:
        return None
    if sleep < 5:
        return Finding("sleep", "Сон", f"{sleep:g}", "ч", "warn",
                       "Сильно недосыпаете — это бьёт по давлению и иммунитету", "7–9")
    if sleep < 7:
        return Finding("sleep", "Сон", f"{sleep:g}", "ч", "warn",
                       "Немного недосыпаете — постарайтесь лечь раньше", "7–9")
    if sleep <= 9:
        return Finding("sleep", "Сон", f"{sleep:g}", "ч", "ok",
                       "Отличный режим сна", "7–9")
    return Finding("sleep", "Сон", f"{sleep:g}", "ч", "warn",
                   "Слишком долгий сон — если это постоянно, обсудите с врачом", "7–9")


def _steps_finding(steps: Optional[int]) -> Optional[Finding]:
    if steps is None:
        return None
    if steps < 3000:
        return Finding("steps", "Шаги", str(steps), "шаг/день", "warn",
                       "Мало движения: попробуйте короткие прогулки после еды", "8000–10000")
    if steps < 8000:
        return Finding("steps", "Шаги", str(steps), "шаг/день", "ok",
                       "Неплохая активность — добавьте ещё пару тысяч шагов", "8000–10000")
    return Finding("steps", "Шаги", str(steps), "шаг/день", "ok",
                   "Отличная активность!", "8000–10000")


def _water_finding(water_ml: Optional[int], weight_kg: Optional[float]) -> Optional[Finding]:
    if water_ml is None:
        return None
    target = round(30 * weight_kg) if weight_kg and weight_kg > 30 else 2000
    if water_ml < 1200:
        return Finding("water", "Вода", str(water_ml), "мл", "warn",
                       "Мало жидкости — возможное обезвоживание, пейте больше воды", f"≈{target}")
    if water_ml > 4000:
        return Finding("water", "Вода", str(water_ml), "мл", "warn",
                       "Очень много жидкости за день — избыток тоже вреден", f"≈{target}")
    return Finding("water", "Вода", str(water_ml), "мл", "ok",
                   "Хороший питьевой режим", f"≈{target}")


# ------------------------------------------------------------- комбинации ----

def _combination_rules(flags: Dict[str, bool], recommendations: List[str]) -> bool:
    """Перекрёстные правила. Возвращает True, если выявлен срочный случай."""
    urgent = False

    if flags["spo2_alarm"]:
        urgent = True
        recommendations.insert(0, "Низкая сатурация — не откладывайте: обратитесь за медицинской помощью (103).")
    if flags["bp_alarm"] or flags["temp_alarm"]:
        urgent = True
        recommendations.insert(0, "Есть тревожный показатель — обратитесь к врачу в ближайшее время, не ждите ухудшения.")

    if flags["temp_high"] and flags["pulse_high"]:
        recommendations.append(
            "Жар с учащённым пульсом: пейте больше воды и отдыхайте; если температура держится 2+ дней — к терапевту."
        )
    if flags["bp_high"] and flags["pulse_high"]:
        recommendations.append(
            "Давление и пульс повышены вместе: уберите кофеин и стресс на день, перемерьте вечером в покое."
        )
    if flags["bp_high"] and flags["sleep_low"]:
        recommendations.append(
            "Недосып сам поднимает давление: попробуйте спать 7–8 часов неделю и сравните цифры."
        )
    if flags["bmi_high"] and flags["steps_low"]:
        recommendations.append(
            "Комбинация лишнего веса и низкой активности: начните с 15-минутных прогулок 2 раза в день."
        )
    if flags["bp_low"] and (flags["water_low"] or flags["sleep_low"]):
        recommendations.append(
            "Низкое давление часто связано с обезвоживанием и недосыпом — вода и режим помогут."
        )
    return urgent


# -------------------------------------------------------------- главная ----

def calc_bmi(height_cm: Optional[float], weight_kg: Optional[float]) -> Optional[float]:
    if height_cm and weight_kg and height_cm > 50 and weight_kg > 20:
        return round(weight_kg / (height_cm / 100) ** 2, 1)
    return None


def analyze(indicators: dict, height_cm: Optional[float] = None) -> RuleResult:
    """Анализ набора показателей. indicators — только заполненные поля.

    Ключи: systolic, diastolic, pulse, temperature, spo2, sleep_hours,
    steps, water_ml, weight_kg. height_cm — рост из профиля пользователя.
    """
    findings: List[Finding] = []

    bp = _bp_finding(indicators.get("systolic"), indicators.get("diastolic"))
    if bp:
        findings.append(bp)
    for f in (_pulse_finding(indicators.get("pulse")),
              _temp_finding(indicators.get("temperature")),
              _spo2_finding(indicators.get("spo2"))):
        if f:
            findings.append(f)

    bmi = calc_bmi(height_cm, indicators.get("weight_kg"))
    bmi_f = _bmi_finding(bmi)
    if bmi_f:
        findings.append(bmi_f)

    for f in (_sleep_finding(indicators.get("sleep_hours")),
              _steps_finding(indicators.get("steps")),
              _water_finding(indicators.get("water_ml"), indicators.get("weight_kg"))):
        if f:
            findings.append(f)

    if not findings:
        return RuleResult("green", bmi=bmi)

    # ---- флаги для перекрёстных правил
    systolic = indicators.get("systolic")
    diastolic = indicators.get("diastolic")
    bp_status = next((f.status for f in findings if f.key == "blood_pressure"), None)
    temp_val = indicators.get("temperature")
    pulse_val = indicators.get("pulse")

    flags = {
        "bp_high": bp_status in ("warn", "alarm")
                   and ((systolic is not None and systolic >= 130)
                        or (diastolic is not None and diastolic >= 85)),
        "bp_low": (systolic is not None and systolic < 90)
                  or (diastolic is not None and diastolic < 60),
        "bp_alarm": ((systolic is not None and systolic >= 160)
                     or (diastolic is not None and diastolic >= 110)),
        "temp_high": temp_val is not None and temp_val >= 37.1,
        "temp_alarm": temp_val is not None and temp_val > 39.0,
        "pulse_high": pulse_val is not None and pulse_val > 100,
        "spo2_alarm": indicators.get("spo2") is not None and indicators["spo2"] < 92,
        "sleep_low": (indicators.get("sleep_hours") or 99) < 7,
        "water_low": (indicators.get("water_ml") or 9999) < 1200,
        "bmi_high": bmi is not None and bmi >= 25,
        "steps_low": (indicators.get("steps") or 99999) < 3000,
    }

    recommendations = [f.message for f in findings if f.status != "ok"]
    urgent = _combination_rules(flags, recommendations)

    # ---- общий риск: только по правилам
    if any(f.status == "alarm" for f in findings) or urgent:
        risk = "red"
    elif any(f.status == "warn" for f in findings):
        risk = "yellow"
    else:
        risk = "green"

    # ---- базовые советы, если всё хорошо
    if risk == "green":
        recommendations = [
            "Все показатели в норме — поддерживайте текущий режим!",
            "Старайтесь пить воду равномерно в течение дня и спать 7–9 часов.",
            "Замеряйте показатели в одно и то же время для точной динамики.",
        ]

    return RuleResult(risk, findings, recommendations, urgent, bmi)
