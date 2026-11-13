"""Генерация одноразовых кодов приглашения для регистрации врачей клиники.

Запуск из корня репозитория:
    python tools/make_invite.py          # 1 код
    python tools/make_invite.py 5        # 5 кодов

Коды сохраняются в таблицу invite_codes и печатаются в консоль.
Каждый код даёт право один раз зарегистрироваться как врач (роль doctor).
"""
import secrets
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import config            # noqa: E402
from app.database import init_db  # noqa: E402


def main(count: int = 1) -> None:
    init_db()
    db = sqlite3.connect(config.DATABASE_PATH)
    try:
        codes = []
        for _ in range(count):
            code = secrets.token_urlsafe(8)
            db.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
            codes.append(code)
        db.commit()
    finally:
        db.close()

    print(f"Сгенерировано кодов: {count}")
    for code in codes:
        print(code)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    main(n)
