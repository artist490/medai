"""Каноническая схема MedAI. Текст времени совместим с sqlite3.Row API."""
from alembic import op

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None

# Не импортировать runtime SCHEMA: миграция должна оставаться воспроизводимой.
TABLES = (
    """CREATE TABLE branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, city TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '')""",
    """CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', age INTEGER,
        sex TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL), height_cm REAL,
        role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor')),
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
    """CREATE TABLE invite_codes (
        code TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        expires_at TEXT, used_by INTEGER REFERENCES users(id) ON DELETE SET NULL, used_at TEXT)""",
    """CREATE TABLE sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)""",
    """CREATE TABLE measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        systolic REAL, diastolic REAL, pulse REAL, temperature REAL, spo2 REAL,
        sleep_hours REAL, steps INTEGER, water_ml INTEGER, weight_kg REAL,
        period TEXT CHECK (period IN ('morning', 'evening') OR period IS NULL),
        CHECK (systolic IS NOT NULL OR diastolic IS NOT NULL OR pulse IS NOT NULL
            OR temperature IS NOT NULL OR spo2 IS NOT NULL OR sleep_hours IS NOT NULL
            OR steps IS NOT NULL OR water_ml IS NOT NULL OR weight_kg IS NOT NULL))""",
    """CREATE TABLE analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        measurement_id INTEGER NOT NULL UNIQUE REFERENCES measurements(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        risk_level TEXT NOT NULL CHECK (risk_level IN ('green', 'yellow', 'red')),
        source TEXT NOT NULL DEFAULT 'rules', findings TEXT NOT NULL DEFAULT '[]',
        recommendations TEXT NOT NULL DEFAULT '[]', llm_text TEXT, bmi REAL, doctor_seen_at TEXT)""",
    """CREATE TABLE doctor_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')))""",
    """CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')))""",
    """CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT NOT NULL DEFAULT '{}',
        ip TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
    """CREATE TABLE patient_cards (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        blood_type TEXT NOT NULL DEFAULT '', allergies TEXT NOT NULL DEFAULT '',
        chronic TEXT NOT NULL DEFAULT '', medications TEXT NOT NULL DEFAULT '',
        surgeries TEXT NOT NULL DEFAULT '', smoking TEXT NOT NULL DEFAULT '',
        alcohol TEXT NOT NULL DEFAULT '', activity TEXT NOT NULL DEFAULT '', survey TEXT,
        updated_by TEXT NOT NULL DEFAULT 'patient', updated_at TEXT)""",
    """CREATE TABLE goals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        steps INTEGER, sleep REAL, water INTEGER, weight REAL)""",
    """CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0,
        data BLOB NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('disabled', 'pending', 'processing', 'ready', 'failed')),
        ocr_text TEXT, ocr_error TEXT, ocr_engine TEXT, ocr_started_at TEXT, ocr_finished_at TEXT,
        ocr_attempts INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        visit_date TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
        complaints TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
        conclusion TEXT NOT NULL DEFAULT '', recommendations TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), updated_at TEXT)""",
)
INDEXES = (
    "CREATE INDEX idx_measurements_user_time ON measurements (user_id, recorded_at DESC, id DESC)",
    "CREATE INDEX idx_analyses_user ON analyses (user_id)",
    "CREATE INDEX idx_sessions_expires ON sessions (expires_at)",
    "CREATE INDEX idx_documents_user ON documents (user_id, uploaded_at DESC)",
    "CREATE INDEX idx_documents_ocr_queue ON documents (ocr_status, id)",
    "CREATE INDEX idx_chat_user ON chat_messages (user_id, id)",
    "CREATE INDEX idx_visits_patient ON visits (patient_id, status)",
    "CREATE INDEX idx_doctor_notes_analysis ON doctor_notes (analysis_id)",
    "CREATE INDEX idx_audit_user_time ON audit_log (user_id, created_at DESC)",
    "CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id)",
)


def upgrade() -> None:
    for ddl in TABLES:
        op.execute(ddl)
    for ddl in INDEXES:
        op.execute(ddl)


def downgrade() -> None:
    for table in ('visits', 'documents', 'goals', 'patient_cards', 'audit_log',
                  'chat_messages', 'doctor_notes', 'analyses', 'measurements',
                  'sessions', 'invite_codes', 'users', 'branches'):
        op.drop_table(table)
