"""Генерация одноразовых кодов приглашения для регистрации врачей клиники.

Запуск из корня репозитория:
    python tools/make_invite.py              # 1 код, срок 14 дней
    python tools/make_invite.py 5            # 5 кодов
    python tools/make_invite.py 5 --days 30  # свой срок действия в днях

Коды сохраняются в таблицу invite_codes и печатаются в консоль.
Каждый код даёт право один раз зарегистрироваться как врач (роль doctor)
в течение срока действия: просроченный код отклоняется при регистрации
(routers/auth.py). expires_at хранится в UTC ISO — как сессии (app/auth.py).
"""
import argparse
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import config            # noqa: E402
from app.database import init_db  # noqa: E402

DEFAULT_DAYS = 14


def main(count: int = 1, days: int = DEFAULT_DAYS) -> None:
    init_db()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    db = sqlite3.connect(config.DATABASE_PATH)
    try:
        codes = []
        for _ in range(count):
            code = secrets.token_urlsafe(8)
            db.execute(
                "INSERT INTO invite_codes (code, expires_at) VALUES (?, ?)",
                (code, expires_at),
            )
            codes.append(code)
        db.commit()
    finally:
        db.close()

    print(f"Сгенерировано кодов: {count} (действуют {days} дн., до {expires_at})")
    for code in codes:
        print(code)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Одноразовые коды приглашения для врачей")
    parser.add_argument("count", nargs="?", type=int, default=1, help="сколько кодов (по умолчанию 1)")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS,
                        help=f"срок действия в днях (по умолчанию {DEFAULT_DAYS})")
    args = parser.parse_args()
    main(args.count, args.days)
