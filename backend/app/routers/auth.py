"""Роутер авторизации и профиля."""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth
from ..database import get_db
from ..schemas import LoginIn, ProfileIn, RegisterIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_payload(user: sqlite3.Row) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "age": user["age"],
        "sex": user["sex"],
        "height_cm": user["height_cm"],
    }


@router.post("/register", status_code=201)
def register(data: RegisterIn, db: sqlite3.Connection = Depends(get_db)):
    exists = db.execute("SELECT id FROM users WHERE email = ?", (data.email.lower(),)).fetchone()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким email уже есть")
    cursor = db.execute(
        "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
        (data.email.lower(), auth.hash_password(data.password), data.name.strip()),
    )
    user_id = cursor.lastrowid
    token = auth.create_session(db, user_id)
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"token": token, "user": user_payload(user)}


@router.post("/login")
def login(data: LoginIn, db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM users WHERE email = ?", (data.email.lower(),)).fetchone()
    if user is None or not auth.verify_password(data.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    token = auth.create_session(db, user["id"])
    return {"token": token, "user": user_payload(user)}


@router.post("/logout")
def logout(credentials=Depends(auth.bearer_scheme)):
    if credentials:
        auth.delete_session(credentials.credentials)
    return {"ok": True}


@router.get("/me")
def me(user: sqlite3.Row = Depends(auth.get_current_user)):
    return user_payload(user)


@router.put("/me")
def update_me(
    data: ProfileIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return user_payload(user)
    sets = ", ".join(f"{k} = ?" for k in updates)
    db.execute(f"UPDATE users SET {sets} WHERE id = ?", (*updates.values(), user["id"]))
    fresh = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return user_payload(fresh)
