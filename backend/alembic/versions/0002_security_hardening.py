"""Безопасный переход со случайной схемы черновика 0001 на рабочую."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'analyses' in tables and 'doctor_seen_at' not in {c['name'] for c in inspector.get_columns('analyses')}:
        op.add_column('analyses', sa.Column('doctor_seen_at', sa.Text(), nullable=True))

    # Переименовываем несовместимые таблицы, не уничтожая исходные записи.
    if 'goals' in tables and 'metric' in {c['name'] for c in inspector.get_columns('goals')}:
        op.rename_table('goals', 'legacy_goals_0001')
    if 'documents' in tables and 'stored_path' in {c['name'] for c in inspector.get_columns('documents')}:
        op.rename_table('documents', 'legacy_documents_0001')
    if 'visits' in tables and 'starts_at' in {c['name'] for c in inspector.get_columns('visits')}:
        op.rename_table('visits', 'legacy_visits_0001')

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if 'goals' not in tables:
        op.execute("""CREATE TABLE goals (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            steps INTEGER, sleep REAL, water INTEGER, weight REAL)""")
        # Переносим только однозначно совместимые значения целей.
        # Если canonical goals уже есть, ручная миграция требуется только
        # при наличии legacy-таблицы; ничего не перезаписываем молча.
        if 'legacy_goals_0001' in tables:
            for row in bind.execute(sa.text(
                "SELECT user_id, metric, target_value FROM legacy_goals_0001 "
                "WHERE metric IN ('steps','sleep','water','weight')"
            )).mappings():
                metric = row["metric"]
                if metric not in {"steps", "sleep", "water", "weight"}:
                    continue
                # Allowlist имён, значения только bind-параметры.
                bind.execute(sa.text(
                    f"INSERT INTO goals (user_id, {metric}) VALUES (:user_id, :value) "
                    f"ON CONFLICT(user_id) DO UPDATE SET {metric}=excluded.{metric}"
                ), {"user_id": row["user_id"], "value": row["target_value"]})
    if 'documents' not in tables:
        # legacy stored_path не содержит сам файл: нельзя незаметно потерять
        # содержимое, поэтому сохраняем таблицу для ручного восстановления.
        op.execute("""CREATE TABLE documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL,
            mime TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0,
            data BLOB NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')))""")
    if 'visits' not in tables:
        op.execute("""CREATE TABLE visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
            visit_date TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
            complaints TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
            conclusion TEXT NOT NULL DEFAULT '', recommendations TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), updated_at TEXT)""")

    for ddl in (
        "CREATE INDEX IF NOT EXISTS idx_measurements_user_time ON measurements (user_id, recorded_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_documents_user ON documents (user_id, uploaded_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages (user_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits (patient_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_doctor_notes_analysis ON doctor_notes (analysis_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log (user_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id)",
    ):
        op.execute(ddl)


def downgrade() -> None:
    # Не удаляем медицинские записи при откате. Схема legacy сохранена отдельно.
    pass
