"""SQLite-подключение (WAL) и схема таблиц."""
import sqlite3
from contextlib import contextmanager
from typing import Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    age           INTEGER,
    sex           TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL),
    height_cm     REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=10)
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
