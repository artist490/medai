"""SQLite-подключение (WAL) и схема таблиц."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS branches (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    city    TEXT NOT NULL UNIQUE,
    phone   TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    age           INTEGER,
    sex           TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL),
    height_cm     REAL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor')),
    branch_id     INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS measurements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    systolic   REAL,   -- систолическое давление
    diastolic  REAL,   -- диастолическое давление
    pulse      REAL,   -- пульс, уд/мин
    temperature REAL,  -- температура, °C
    spo2       REAL,   -- сатурация, %
    sleep_hours REAL,  -- сон, часов
    steps      INTEGER,-- шаги за день
    water_ml   INTEGER,-- вода, мл
    weight_kg  REAL,   -- вес, кг (рост берётся из профиля)
    CHECK (systolic IS NOT NULL OR diastolic IS NOT NULL OR pulse IS NOT NULL
        OR temperature IS NOT NULL OR spo2 IS NOT NULL OR sleep_hours IS NOT NULL
        OR steps IS NOT NULL OR water_ml IS NOT NULL OR weight_kg IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS analyses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    measurement_id INTEGER NOT NULL UNIQUE REFERENCES measurements(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    risk_level     TEXT NOT NULL CHECK (risk_level IN ('green', 'yellow', 'red')),
    source         TEXT NOT NULL DEFAULT 'rules',  -- rules | rules+llm
    findings       TEXT NOT NULL DEFAULT '[]',     -- JSON: статусы каждого показателя
    recommendations TEXT NOT NULL DEFAULT '[]',    -- JSON: базовые рекомендации правил
    llm_text       TEXT,                            -- текстовые рекомендации LLM (или NULL)
    bmi            REAL
);

CREATE TABLE IF NOT EXISTS doctor_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    doctor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_name TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Медкарта: анамнез, заполняется пациентом и врачом (1:1 к пользователю)
CREATE TABLE IF NOT EXISTS patient_cards (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blood_type  TEXT NOT NULL DEFAULT '',   -- группа крови, резус
    allergies   TEXT NOT NULL DEFAULT '',   -- аллергии (особенно лекарственные)
    chronic     TEXT NOT NULL DEFAULT '',   -- хронические заболевания
    medications TEXT NOT NULL DEFAULT '',   -- постоянные лекарства
    surgeries   TEXT NOT NULL DEFAULT '',   -- операции, госпитализации
    smoking     TEXT NOT NULL DEFAULT '',   -- нет | бросил | курирует
    alcohol     TEXT NOT NULL DEFAULT '',   -- нет | редко | регулярно
    activity    TEXT NOT NULL DEFAULT '',   -- низкая | средняя | высокая
    survey      TEXT,                       -- JSON ответов опросника МЗ (приказ 404н)
    updated_by  TEXT NOT NULL DEFAULT 'patient',  -- кто правил последним
    updated_at  TEXT
);

-- Приёмы: пациент описывает жалобы к визиту, врач пишет заключение
CREATE TABLE IF NOT EXISTS visits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    branch_id       INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    visit_date      TEXT NOT NULL DEFAULT '',      -- YYYY-MM-DD планируемой даты
    reason          TEXT NOT NULL DEFAULT '',      -- цель визита
    complaints      TEXT NOT NULL DEFAULT '',      -- жалобы пациента
    status          TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'completed', 'cancelled')),
    conclusion      TEXT NOT NULL DEFAULT '',      -- заключение врача
    recommendations TEXT NOT NULL DEFAULT '',      -- рекомендации врача
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT
);
"""

# Федеральная сеть «Спектр-диагностика»: города и телефоны с spdmed.ru
BRANCHES_SEED = [
    ("Белая Калитва", "+7 (863) 832-52-55"),
    ("Белгород", "+7 (930) 451-55-55"),
    ("Брянск", "+7 (930) 735-88-88"),
    ("Бутурлиновка", "+7 (930) 429-33-33"),
    ("Воронеж", "+7 (920) 451-11-11"),
    ("Вязьма", "+7 (920) 333-77-33"),
    ("Калининград", "+7 (401) 279-59-00"),
    ("Калуга", "+7 (920) 095-33-33"),
    ("Каменск-Шахтинский", "+7 (928) 617-01-16"),
    ("Клинцы", "+7 (483) 364-09-54"),
    ("Михайловка", "+7 (937) 555-93-93"),
    ("Россошь", "+7 (920) 216-07-07"),
    ("Сочи", "+7 (862) 555-29-45"),
    ("Таганрог", "+7 (928) 289-23-28"),
    ("Тамбов", "+7 (920) 230-33-33"),
]


def _migrate(db: sqlite3.Connection) -> None:
    """Лёгкие миграции для БД, созданных до версии для клиники."""
    columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    if "role" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'patient'")
    if "branch_id" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id)")
    card_columns = {row["name"] for row in db.execute("PRAGMA table_info(patient_cards)").fetchall()}
    if card_columns and "survey" not in card_columns:
        db.execute("ALTER TABLE patient_cards ADD COLUMN survey TEXT")


def connect() -> sqlite3.Connection:
    # check_same_thread=False: FastAPI исполняет teardown yield-зависимости
    # (commit/close в db_session) в другом потоке threadpool — без этого флага
    # параллельные запросы дают sqlite3.ProgrammingError (см. uvicorn-логи).
    # Соединение живёт в пределах одного запроса, межзапросного шаринга нет.
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    """Сессия БД для внутреннего кода: коммит при успехе, откат при ошибке."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    """Зависимость FastAPI (yield-генератор): та же логика коммита/отката."""
    with db_session() as conn:
        yield conn


def init_db() -> None:
    config.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_session() as db:
        db.executescript(SCHEMA)
        _migrate(db)
        db.executemany(
            "INSERT OR IGNORE INTO branches (city, phone) VALUES (?, ?)",
            BRANCHES_SEED,
        )
        db.execute("DELETE FROM sessions WHERE expires_at <= ?",
                   (datetime.now(timezone.utc).isoformat(),))
