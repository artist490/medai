"""Локальный OCR документов на сервере (LiteParse/OCRia)."""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c['name'] for c in inspector.get_columns('documents')}
    additions = (
        ('ocr_status', "TEXT NOT NULL DEFAULT 'pending'"),
        ('ocr_text', 'TEXT'),
        ('ocr_error', 'TEXT'),
        ('ocr_engine', 'TEXT'),
        ('ocr_started_at', 'TEXT'),
        ('ocr_finished_at', 'TEXT'),
        ('ocr_attempts', 'INTEGER NOT NULL DEFAULT 0'),
    )
    for name, ddl in additions:
        if name not in columns:
            op.execute(f'ALTER TABLE documents ADD COLUMN {name} {ddl}')
    op.execute('CREATE INDEX IF NOT EXISTS idx_documents_ocr_queue ON documents (ocr_status, id)')


def downgrade() -> None:
    # Не удаляем распознанные медицинские документы/текст при откате.
    pass
