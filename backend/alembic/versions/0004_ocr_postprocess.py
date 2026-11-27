"""Постобработка текста OCR: сохранённый очищенный текст документа."""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c['name'] for c in inspector.get_columns('documents')}
    if 'ocr_text_clean' not in columns:
        # Исходный ocr_text остаётся как есть: постобработка ничего не затирает.
        op.execute('ALTER TABLE documents ADD COLUMN ocr_text_clean TEXT')


def downgrade() -> None:
    # Распознанный и очищенный текст медицинских документов не удаляем.
    pass
