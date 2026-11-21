"""Авторизация: pbkdf2-хэши паролей и bearer-токены сессий."""
import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .database import db_session

PBKDF2_ITERATIONS = 200_000
SESSION_TTL_DAYS = 30

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations)
        ).hex()
        return secrets.compare_digest(candidate, digest)
    except (ValueError, AttributeError):
        return False


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    db.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires.isoformat()),
    )
    return token


def delete_session(token: str) -> None:
    with db_session() as db:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> sqlite3.Row:
    """Зависимость FastAPI: возвращает пользователя по Bearer-токену."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    token = credentials.credentials
    with db_session() as db:
        row = db.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0
            """,
            (token, datetime.now(timezone.utc).isoformat()),
        ).fetchone()
    if row is None:
        # Сюда попадает и отключённый пользователь (u.disabled = 1) даже с
        # формально живой сессией: отзыв доступа не зависит от отзыва токенов
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия недействительна")
    return row


def get_current_doctor(
    user: sqlite3.Row = Depends(get_current_user),
) -> sqlite3.Row:
    """Зависимость FastAPI: только пользователь с ролью doctor."""
    if user["role"] != "doctor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для врачей")
    return user
