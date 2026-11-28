"""SQLite-подключение (WAL) и схема таблиц."""
import os
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
    name          TEXT NOT NULL DEFAULT '',  -- отображаемое ФИО, пересобирается из частей при записи
    first_name    TEXT NOT NULL DEFAULT '',  -- имя
    last_name     TEXT NOT NULL DEFAULT '',  -- фамилия
    middle_name   TEXT NOT NULL DEFAULT '',  -- отчество (может быть пустым)
    age           INTEGER,
    sex           TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL),
    height_cm     REAL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor')),
    branch_id     INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    phone         TEXT NOT NULL DEFAULT '',   -- контактный телефон, видит филиал
    notifications_seen_at TEXT,               -- последнее открытие колокольчика (Б1)
    disabled      INTEGER NOT NULL DEFAULT 0,  -- 1 = доступ отозван (tools/disable_user.py)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT,   -- срок действия (UTC ISO, tools/make_invite.py); NULL = бессрочный (код до миграции)
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
    period     TEXT,   -- период дня: 'morning' | 'evening' (дневник давления)
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

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  INTEGER,
    details    TEXT NOT NULL DEFAULT '{}',
    ip         TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Дневник самочувствия (Е2): записи пациента о состоянии между приёмами.
-- Не путать с жалобами приёма (visits.complaints): это регулярный дневник.
CREATE TABLE IF NOT EXISTS symptom_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    wellbeing   INTEGER NOT NULL CHECK (wellbeing BETWEEN 1 AND 5),
    text        TEXT NOT NULL
);

-- Направления врача (Е3): «сдать анализ X» — чеклист пациенту в медкарте
CREATE TABLE IF NOT EXISTS doctor_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    doctor_name  TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT '',  -- нужная категория бланка (doc_categories.py)
    status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT
);
"""

# Индексы под горячие запросы (см. TECH_DEBT_AUDIT.md): пул врача, аналитика,
# дневник, сигналы — всё фильтрует по user_id/пациенту с сортировкой по времени.
# Отдельный скрипт: создаётся ПОСЛЕ всех таблиц (documents/goals живут в своих)
INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_measurements_user_time ON measurements (user_id, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_user          ON analyses (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires       ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_documents_user         ON documents (user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_ocr_queue    ON documents (ocr_status, id);
CREATE INDEX IF NOT EXISTS idx_chat_user              ON chat_messages (user_id, id);
CREATE INDEX IF NOT EXISTS idx_visits_patient         ON visits (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_doctor_notes_analysis  ON doctor_notes (analysis_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_time        ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity           ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_symptom_notes_user     ON symptom_notes (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_doctor_orders_patient  ON doctor_orders (patient_id, status);
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

GOALS_TABLE = """
CREATE TABLE IF NOT EXISTS goals (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    steps    INTEGER,
    sleep    REAL,
    water    INTEGER,
    weight   REAL
);
"""

DOCUMENTS_TABLE = """
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size        INTEGER NOT NULL DEFAULT 0,
    data        BLOB NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ocr_status  TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('disabled', 'pending', 'processing', 'ready', 'failed')),
    ocr_text    TEXT,
    ocr_text_clean TEXT,
    ocr_error   TEXT,
    ocr_engine  TEXT,
    ocr_started_at TEXT,
    ocr_finished_at TEXT,
    ocr_attempts INTEGER NOT NULL DEFAULT 0,
    category     TEXT NOT NULL DEFAULT '',
    title_source TEXT NOT NULL DEFAULT 'auto',
    doctor_viewed_at TEXT,            -- последний раз врач филиала открывал документ (В4)
    lab_values   TEXT                 -- JSON распознанных показателей (Д2, services/lab_parse.py)
);
"""


_USERS_REBUILD_DDL = """
CREATE TABLE users_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    first_name    TEXT NOT NULL DEFAULT '',
    last_name     TEXT NOT NULL DEFAULT '',
    middle_name   TEXT NOT NULL DEFAULT '',
    age           INTEGER,
    sex           TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL),
    height_cm     REAL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor')),
    branch_id     INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _users_need_rebuild(db: sqlite3.Connection) -> bool:
    """Колонки NOT NULL без значения по умолчанию ломают INSERT, который их
    не перечисляет: register падал на 'NOT NULL constraint failed: users.disabled'
    у баз, созданных alembic-миграцией (колонки добавлены без DEFAULT)."""
    required = {"role": "'patient'", "disabled": "0", "created_at": "datetime"}
    for row in db.execute("PRAGMA table_info(users)").fetchall():
        if row["name"] in required and row["notnull"] and row["dflt_value"] is None:
            return True
    return False


def _rebuild_users(db: sqlite3.Connection) -> None:
    """Пересобирает users с канонической схемой, сохраняя данные.

    Значение по умолчанию для created_at — выражение, а ALTER TABLE ADD COLUMN
    его не принимает, поэтому правим таблицу целиком, а не по колонке.
    Внешние ключи на время пересборки выключаются: иначе DROP TABLE родителя
    конфликтует с дочерними строками. Ссылки детей хранятся по имени таблицы,
    поэтому после RENAME остаются рабочими."""
    db.execute("PRAGMA foreign_keys=OFF")
    try:
        db.execute("DROP TABLE IF EXISTS users_new")
        db.execute(_USERS_REBUILD_DDL)
        db.execute(
            """INSERT INTO users_new
                   (id, email, password_hash, name, first_name, last_name, middle_name,
                    age, sex, height_cm, role, branch_id, disabled, created_at)
               SELECT id, email, password_hash, name,
                      COALESCE(first_name, ''), COALESCE(last_name, ''), COALESCE(middle_name, ''),
                      age, sex, height_cm,
                      COALESCE(role, 'patient'), branch_id,
                      COALESCE(disabled, 0),
                      COALESCE(created_at, datetime('now'))
               FROM users"""
        )
        db.execute("DROP TABLE users")
        db.execute("ALTER TABLE users_new RENAME TO users")
        broken = db.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            raise RuntimeError(f"пересборка users нарушила внешние ключи: {broken[:3]}")
    finally:
        db.execute("PRAGMA foreign_keys=ON")


def _migrate(db: sqlite3.Connection) -> None:
    """Лёгкие миграции для БД, созданных до версии для клиники."""
    columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    if "role" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'patient'")
    if "branch_id" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id)")
    if "disabled" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0")
    # ФИО по частям: name остаётся отображаемым полем, пересобирается при записи
    if "first_name" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''")
    if "last_name" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''")
    if "middle_name" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN middle_name TEXT NOT NULL DEFAULT ''")
    if "phone" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
    if "notifications_seen_at" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN notifications_seen_at TEXT")
    if _users_need_rebuild(db):
        _rebuild_users(db)
    card_columns = {row["name"] for row in db.execute("PRAGMA table_info(patient_cards)").fetchall()}
    if card_columns and "survey" not in card_columns:
        db.execute("ALTER TABLE patient_cards ADD COLUMN survey TEXT")
    meas_columns = {row["name"] for row in db.execute("PRAGMA table_info(measurements)").fetchall()}
    if "period" not in meas_columns:
        db.execute("ALTER TABLE measurements ADD COLUMN period TEXT CHECK (period IN ('morning', 'evening'))")
    anal_columns = {row["name"] for row in db.execute("PRAGMA table_info(analyses)").fetchall()}
    if "doctor_seen_at" not in anal_columns:
        db.execute("ALTER TABLE analyses ADD COLUMN doctor_seen_at TEXT")
    doc_columns = {row["name"] for row in db.execute("PRAGMA table_info(documents)").fetchall()}
    if doc_columns and "ocr_status" not in doc_columns:
        for ddl in (
            "ALTER TABLE documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'pending'",
            "ALTER TABLE documents ADD COLUMN ocr_text TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_text_clean TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_error TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_engine TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_started_at TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_finished_at TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_attempts INTEGER NOT NULL DEFAULT 0",
        ):
            db.execute(ddl)
        doc_columns = {row["name"] for row in db.execute("PRAGMA table_info(documents)").fetchall()}
    if doc_columns and "ocr_text_clean" not in doc_columns:
        db.execute("ALTER TABLE documents ADD COLUMN ocr_text_clean TEXT")
    if doc_columns and "category" not in doc_columns:
        db.execute("ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT ''")
        db.execute("ALTER TABLE documents ADD COLUMN title_source TEXT NOT NULL DEFAULT 'auto'")
    if doc_columns and "doctor_viewed_at" not in doc_columns:
        db.execute("ALTER TABLE documents ADD COLUMN doctor_viewed_at TEXT")
    if doc_columns and "lab_values" not in doc_columns:
        db.execute("ALTER TABLE documents ADD COLUMN lab_values TEXT")
    invite_columns = {row["name"] for row in db.execute("PRAGMA table_info(invite_codes)").fetchall()}
    if invite_columns and "expires_at" not in invite_columns:
        db.execute("ALTER TABLE invite_codes ADD COLUMN expires_at TEXT")


def connect() -> sqlite3.Connection:
    # check_same_thread=False: FastAPI исполняет teardown yield-зависимости
    # (commit/close в db_session) в другом потоке threadpool — без этого флага
    # параллельные запросы дают sqlite3.ProgrammingError (см. uvicorn-логи).
    # Соединение живёт в пределах одного запроса, межзапросного шаринга нет.
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    # Медицинские данные не должны появляться в clear-text дампах ОС.
    conn.execute("PRAGMA secure_delete=ON")
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
    if config.ENV == "production" and os.name != "nt":
        os.chmod(config.DATABASE_PATH.parent, 0o700)
        if config.DATABASE_PATH.exists():
            os.chmod(config.DATABASE_PATH, 0o600)
    with db_session() as db:
        db.executescript(SCHEMA)
        db.executescript(GOALS_TABLE)
        db.executescript(DOCUMENTS_TABLE)
        _migrate(db)  # миграции до индексов: индексы ссылаются на колонки, добавляемые миграциями
        db.executescript(INDEXES_SQL)
        db.executemany(
            "INSERT OR IGNORE INTO branches (city, phone) VALUES (?, ?)",
            BRANCHES_SEED,
        )
        db.execute("DELETE FROM sessions WHERE expires_at <= ?",
                   (datetime.now(timezone.utc).isoformat(),))
