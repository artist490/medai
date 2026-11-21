"""Отключение/включение врача и отзыв его сессий (контур доступа, С.3 ROADMAP).

Запуск из корня репозитория:
    python tools/disable_user.py doctor@clinic.ru            # отключить + отозвать сессии
    python tools/disable_user.py doctor@clinic.ru --enable   # вернуть доступ

Отключённый врач теряет доступ сразу: активные сессии удаляются, а любой его
токен отклоняется на сервере (auth.get_current_user проверяет users.disabled).
Новый вход отключённому запрещён (routers/auth.py:login → 403).
Отключать скрипт может только врачей (role='doctor') — пациенты не персонал клиники.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import config            # noqa: E402
from app.database import init_db  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Отключение/включение врача и отзыв его сессий")
    parser.add_argument("email", help="email врача")
    parser.add_argument("--enable", action="store_true", help="вернуть доступ (вместо отключения)")
    args = parser.parse_args(argv)

    init_db()
    db = sqlite3.connect(config.DATABASE_PATH)
    db.row_factory = sqlite3.Row
    try:
        user = db.execute(
            "SELECT id, email, role FROM users WHERE email = ?", (args.email.lower().strip(),)
        ).fetchone()
        if user is None:
            print(f"Пользователь {args.email} не найден")
            return 1
        if user["role"] != "doctor":
            print(f"{user['email']} — не врач (role={user['role']}): скрипт отключает только врачей")
            return 1
        if args.enable:
            db.execute("UPDATE users SET disabled = 0 WHERE id = ?", (user["id"],))
            db.commit()
            print(f"Доступ возвращён: {user['email']}")
        else:
            db.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user["id"],))
            revoked = db.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],)).rowcount
            db.commit()
            print(f"Врач {user['email']} отключён, сессий отозвано: {revoked}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
