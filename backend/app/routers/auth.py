"""Роутер авторизации и профиля."""
import sqlite3
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from datetime import datetime, timezone

from .. import auth
from ..database import db_session, get_db
from ..schemas import LoginIn, ProfileIn, RegisterIn

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Защита от брутфорса: не более LOGIN_MAX_FAILS неудачных входов
# на пару «email + IP» за окно LOGIN_WINDOW секунд (in-memory, для локального
# деплоя достаточно; при масштабировании — Redis).
LOGIN_MAX_FAILS = 5
LOGIN_WINDOW = 15 * 60
_LOGIN_FAILS: dict[str, list[float]] = {}


def _login_key(email: str, request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{email.lower()}|{ip}"


def _login_blocked(key: str) -> bool:
    now = time.time()
    fresh = [t for t in _LOGIN_FAILS.get(key, []) if now - t < LOGIN_WINDOW]
    _LOGIN_FAILS[key] = fresh
    return len(fresh) >= LOGIN_MAX_FAILS


def _branch_of(db: sqlite3.Connection, branch_id: Optional[int]) -> Optional[sqlite3.Row]:
    if branch_id is None:
        return None
    return db.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()


def branch_payload(branch: Optional[sqlite3.Row]) -> Optional[dict]:
    if branch is None:
        return None
    return {"id": branch["id"], "city": branch["city"], "phone": branch["phone"]}


def user_payload(user: sqlite3.Row, branch: Optional[sqlite3.Row] = None) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "age": user["age"],
        "sex": user["sex"],
        "height_cm": user["height_cm"],
        "role": user["role"],
        "branch": branch_payload(branch),
    }


@router.get("/branches")
def list_branches():
    """Публичный список филиалов сети — для формы регистрации."""
    with db_session() as db:
        rows = db.execute("SELECT id, city, phone FROM branches ORDER BY city").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/register", status_code=201)
def register(data: RegisterIn, db: sqlite3.Connection = Depends(get_db)):
    exists = db.execute("SELECT id FROM users WHERE email = ?", (data.email.lower(),)).fetchone()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким email уже есть")

    # Врачом можно стать только по одноразовому коду приглашения клиники
    role = "patient"
    invite = None
    if data.invite_code:
        code = data.invite_code.strip()
        invite = db.execute("SELECT * FROM invite_codes WHERE code = ?", (code,)).fetchone()
        if invite is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Код приглашения не найден")
        if invite["used_by"] is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Код приглашения уже использован")
        role = "doctor"

    branch = _branch_of(db, data.branch_id)
    if data.branch_id is not None and branch is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Филиал не найден")

    cursor = db.execute(
        "INSERT INTO users (email, password_hash, name, role, branch_id) VALUES (?, ?, ?, ?, ?)",
        (data.email.lower(), auth.hash_password(data.password), data.name.strip(), role, data.branch_id),
    )
    user_id = cursor.lastrowid

    if invite is not None:
        db.execute(
            "UPDATE invite_codes SET used_by = ?, used_at = datetime('now', 'localtime') WHERE code = ?",
            (user_id, invite["code"]),
        )

    token = auth.create_session(db, user_id)
    # Коммит до отправки ответа: teardown-коммит yield-зависимости выполняется
    # после ответа, и клиент успевает сделать следующий запрос без этих данных
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"token": token, "user": user_payload(user, branch)}


@router.post("/login")
def login(data: LoginIn, request: Request, db: sqlite3.Connection = Depends(get_db)):
    key = _login_key(data.email, request)
    if _login_blocked(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Слишком много попыток входа — подождите 15 минут")
    user = db.execute("SELECT * FROM users WHERE email = ?", (data.email.lower(),)).fetchone()
    if user is None or not auth.verify_password(data.password, user["password_hash"]):
        _LOGIN_FAILS.setdefault(key, []).append(time.time())
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    _LOGIN_FAILS.pop(key, None)
    # попутно убираем истёкшие сессии пользователя
    db.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
               (user["id"], datetime.now(timezone.utc).isoformat()))
    token = auth.create_session(db, user["id"])
    db.commit()  # см. комментарий в register
    return {"token": token, "user": user_payload(user, _branch_of(db, user["branch_id"]))}


@router.post("/logout")
def logout(credentials=Depends(auth.bearer_scheme)):
    if credentials:
        auth.delete_session(credentials.credentials)
    return {"ok": True}


@router.get("/me")
def me(user: sqlite3.Row = Depends(auth.get_current_user), db: sqlite3.Connection = Depends(get_db)):
    return user_payload(user, _branch_of(db, user["branch_id"]))


@router.put("/me")
def update_me(
    data: ProfileIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    if data.branch_id is not None and _branch_of(db, data.branch_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Филиал не найден")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return user_payload(user, _branch_of(db, user["branch_id"]))
    sets = ", ".join(f"{k} = ?" for k in updates)
    db.execute(f"UPDATE users SET {sets} WHERE id = ?", (*updates.values(), user["id"]))
    db.commit()  # см. комментарий в register
    fresh = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return user_payload(fresh, _branch_of(db, fresh["branch_id"]))
