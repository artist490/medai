"""Ночная копия базы данных: sqlite3 .backup + ротация (Г4).

Копия через sqlite3.Connection.backup (API Online Backup): файл снимается
целиком и согласованно даже при работающем сервере (WAL не мешает) —
в отличие от копирования .db-файла по расписанию.

Запуск из корня репозитория:
    python tools/backup_db.py                    # копия в tools/backup/, хранить 14
    python tools/backup_db.py --keep 30          # хранить 30 копий
    python tools/backup_db.py --dir D:/backups   # свой каталог

Расписание (после запуска сервера или ночами, когда копия дешевле):
- Linux/cron:     30 3 * * *  cd /srv/medai && python tools/backup_db.py
- Windows/Task Scheduler:
    schtasks /Create /TN "MedAI backup" /SC DAILY /ST 03:30 ^
      /TR "python C:\\srv\\medai\\tools\\backup_db.py --dir D:\\backups"

Проверка: последняя копия открывается и содержит таблицы —
    python tools/backup_db.py --verify
"""
import argparse
import sqlite3
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import config  # noqa: E402

DEFAULT_KEEP = 14
TABLES = ("users", "documents", "measurements", "analyses", "visits")


def make_backup(target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = target_dir / f"medai-{stamp}.db"
    source = sqlite3.connect(config.DATABASE_PATH)
    try:
        # secure_delete копируемому источнику не нужен; главное — цельный снапшот
        backup = sqlite3.connect(dest)
        with backup:
            source.backup(backup)
        backup.close()
    finally:
        source.close()
    return dest


def rotate(target_dir: Path, keep: int) -> list[Path]:
    """Оставляет keep свежих копий, удаляет старшие. Возвращает удалённые."""
    copies = sorted(target_dir.glob("medai-*.db"))
    removed = []
    for stale in copies[:-keep] if keep > 0 else copies:
        stale.unlink(missing_ok=True)
        removed.append(stale)
    return removed


def verify(latest: Path) -> None:
    db = sqlite3.connect(f"file:{latest}?mode=ro", uri=True)
    try:
        for table in TABLES:
            count = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count} строк")
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Копия БД MedAI + ротация")
    parser.add_argument("--dir", default=str(Path(__file__).resolve().parent / "backup"),
                        help="каталог для копий (по умолчанию tools/backup)")
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP,
                        help=f"сколько копий хранить (по умолчанию {DEFAULT_KEEP})")
    parser.add_argument("--verify", action="store_true",
                        help="проверить последнюю копию вместо создания новой")
    args = parser.parse_args()

    target_dir = Path(args.dir)
    if args.verify:
        copies = sorted(target_dir.glob("medai-*.db"))
        if not copies:
            print(f"Копий в {target_dir} нет")
            return 1
        latest = copies[-1]
        print(f"Проверка {latest.name}:")
        verify(latest)
        return 0

    dest = make_backup(target_dir)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"Скопировано: {dest} ({size_mb:.1f} МБ)")
    removed = rotate(target_dir, max(0, args.keep))
    if removed:
        print(f"Удалено старых копий: {len(removed)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
