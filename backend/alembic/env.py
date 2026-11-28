"""Alembic environment configuration for MedAI."""
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text as sa_text

from alembic import context

# --- Ensure backend/ is on sys.path for `import app` ---
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.config import DATABASE_PATH  # noqa: E402
from app.database import BRANCHES_SEED  # noqa: E402

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate
target_metadata = None  # схема версионируется явно, без опасного autogenerate

# Override sqlalchemy.url with actual DATABASE_PATH (supports env override)
config.set_main_option("sqlalchemy.url", f"sqlite:///{DATABASE_PATH}")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite batch mode for ALTER TABLE
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # Существующая legacy-база создавалась init_db() до появления Alembic.
        # Помечаем только совместимую схему; несовпадение останавливает запуск.
        existing = set(sa_inspect(connection).get_table_names())
        revisions = connection.execute(sa_text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"
        )).fetchone()
        if 'users' in existing and not revisions:
            required = {
                'goals': {'user_id', 'steps', 'sleep', 'water', 'weight'},
                'documents': {'title', 'filename', 'mime', 'size', 'data'},
                'visits': {'branch_id', 'visit_date', 'complaints'},
            }
            for table, needed in required.items():
                columns = {c['name'] for c in sa_inspect(connection).get_columns(table)}
                if table not in existing or not needed.issubset(columns):
                    raise RuntimeError(
                        f"Несовместимая база {table}: сначала выполните резервное копирование "
                        "и ручной перенос; автоматическое удаление таблиц запрещено"
                    )
            connection.execute(sa_text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
            connection.execute(sa_text("INSERT INTO alembic_version (version_num) VALUES ('0001')"))
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite batch mode
        )

        with context.begin_transaction():
            context.run_migrations()
        # Alembic управляет своей транзакцией; seed фиксируем отдельно.
        connection.commit()
        with connection.begin():
            connection.execute(sa_text(
                "INSERT OR IGNORE INTO branches (city, phone) VALUES (:city, :phone)"
            ), [{"city": city, "phone": phone} for city, phone in BRANCHES_SEED])


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
