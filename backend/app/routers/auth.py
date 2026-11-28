"""Роутер авторизации и профиля."""
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .. import auth
from ..database import db_session, get_db
from ..schemas import BranchChangeIn, LoginIn, ProfileIn, RegisterIn
from ..security import SESSION_COOKIE, SlidingRateLimiter, clear_auth_cookies, csrf_cookie, session_cookie
from ..services.audit import record
from ..services.payloads import compose_full_name

router = APIRouter(prefix="/api/auth", tags=["auth"])

# In-memory для одной реплики; при горизонтальном масштабировании — Redis.
_login_limiter = SlidingRateLimiter(5, 15 * 60)
_login_ip_limiter = SlidingRateLimiter(60, 15 * 60)
_register_limiter = SlidingRateLimiter(5, 60 * 60)
_branch_change_limiter = SlidingRateLimiter(5, 15 * 60)
_DUMMY_PASSWORD_HASH = auth.hash_password(secrets.token_urlsafe(32))

# Телефон храним как введённый, но не принимаем произвольный текст (A3).
_PHONE_RE = re.compile(r"^[0-9+()\-\s]{5,32}$")


def _clean_phone(value: Optional[str]) -> str:
    phone = (value or "").strip()
    if phone and not _PHONE_RE.fullmatch(phone):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Телефон: только цифры, пробелы и символы + ( ) -")
    return phone


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _login_key(email: str, request: Request) -> str:
    return f"{email.lower()}|{_ip(request)}"


def _login_blocked(key: str) -> bool:
    # Исторический тестовый интерфейс: проверка без регистрации новой попытки.
    return not _login_limiter.allow(key)


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
        "first_name": user["first_name"],
        "last_name": user["last_name"],
        "middle_name": user["middle_name"],
        "age": user["age"],
        "sex": user["sex"],
        "height_cm": user["height_cm"],
        "role": user["role"],
        "phone": user["phone"] if "phone" in user.keys() else "",
        "branch": branch_payload(branch),
    }


@router.get("/branches")
def list_branches():
    """Публичный список филиалов сети — для формы регистрации."""
    with db_session() as db:
        rows = db.execute("SELECT id, city, phone FROM branches ORDER BY city").fetchall()
    return {"items": [dict(r) for r in rows]}


def _auth_response(user: sqlite3.Row, branch: Optional[sqlite3.Row], token: str,
                   request: Request, response: Response) -> dict:
    """Bearer для машинных клиентов; cookie для браузера."""
    if request.headers.get("x-client-type") == "api":
        return {"token": token, "user": user_payload(user, branch)}
    csrf = secrets.token_urlsafe(32)
    response.headers.append("set-cookie", session_cookie(token))
    response.headers.append("set-cookie", csrf_cookie(csrf))
    return {"user": user_payload(user, branch)}


@router.post("/register", status_code=201)
def register(data: RegisterIn, request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)):
    if not _register_limiter.allow(_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много регистраций — повторите позже")
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
        # У всех новых кодов обязателен срок действия. NULL допускается только
        # для записей, созданных до миграции expires_at (см. test_access_contour).
        if invite["expires_at"] and invite["expires_at"] <= datetime.now(timezone.utc).isoformat():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Срок действия кода приглашения истёк")
        role = "doctor"

    # branch_id обязателен для любой роли (schema.RegisterIn): без него 422,
    # иначе register молча создавал «невидимых» пользователей branch_id IS NULL
    branch = _branch_of(db, data.branch_id)
    if branch is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Филиал не найден")

    cursor = db.execute(
        """INSERT INTO users (email, password_hash, name, first_name, last_name, middle_name,
                              phone, role, branch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.email.lower(), auth.hash_password(data.password),
         compose_full_name(data.first_name, data.last_name, data.middle_name) or data.name.strip(),
         data.first_name.strip(), data.last_name.strip(), data.middle_name.strip(),
         _clean_phone(data.phone), role, data.branch_id),
    )
    user_id = cursor.lastrowid

    if invite is not None:
        db.execute(
            "UPDATE invite_codes SET used_by = ?, used_at = datetime('now', 'localtime') WHERE code = ?",
            (user_id, invite["code"]),
        )

    token = auth.create_session(db, int(cursor.lastrowid or 0))
    # Коммит до отправки ответа: teardown-коммит yield-зависимости выполняется
    # после ответа, и клиент успевает сделать следующий запрос без этих данных
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    record(db, "auth.register", user_id=user_id, entity="user", entity_id=user_id,
           ip=_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    return _auth_response(user, branch, token, request, response)


@router.post("/login")
def login(data: LoginIn, request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)):
    if not _login_ip_limiter.allow(_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток входа с этого адреса")
    key = _login_key(data.email, request)
    if _login_blocked(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Слишком много попыток входа — подождите 15 минут")
    user = db.execute("SELECT * FROM users WHERE email = ?", (data.email.lower(),)).fetchone()
    password_hash = user["password_hash"] if user else _DUMMY_PASSWORD_HASH
    password_ok = auth.verify_password(data.password, password_hash)
    if user is None or not password_ok:
        # Общий ответ и одинаковый PBKDF2 для несуществующего email.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    # С.3: отключённому пользователю (tools/disable_user.py) новых сессий не выдаём —
    # проверка после пароля, чтобы статус аккаунта не раскрывался до аутентификации
    if user["disabled"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт отключён — обратитесь к администратору клиники")
    # попутно убираем истёкшие сессии пользователя
    db.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
               (user["id"], datetime.now(timezone.utc).isoformat()))
    token = auth.create_session(db, user["id"])
    record(db, "auth.login", user_id=user["id"], entity="user", entity_id=user["id"],
           ip=_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    return _auth_response(user, _branch_of(db, user["branch_id"]), token, request, response)


@router.post("/logout")
def logout(request: Request, response: Response, credentials=Depends(auth.bearer_scheme)):
    token = credentials.credentials if credentials else request.cookies.get(SESSION_COOKIE)
    if token:
        auth.delete_session(token)
    for cookie in clear_auth_cookies():
        response.headers.append("set-cookie", cookie)
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
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "phone" in updates:
        updates["phone"] = _clean_phone(updates["phone"])
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        db.execute(f"UPDATE users SET {sets} WHERE id = ?", (*updates.values(), user["id"]))
        # name — кэш отображаемого ФИО: пересобираем из частей при любой правке
        # профиля. Пустой результат (аккаунт без ФИО) оставляет прежнее name —
        # у аккаунтов, созданных до разделения, оно заполнено разовым именем.
        if any(k in updates for k in ("first_name", "last_name", "middle_name")):
            fresh = db.execute(
                "SELECT first_name, last_name, middle_name, name FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            full = compose_full_name(fresh["first_name"], fresh["last_name"], fresh["middle_name"])
            if full != fresh["name"]:
                db.execute("UPDATE users SET name = ? WHERE id = ?", (full, user["id"]))
    db.commit()  # см. комментарий в register
    fresh = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return user_payload(fresh, _branch_of(db, fresh["branch_id"]))


@router.post("/me/branch")
def change_branch(
    data: BranchChangeIn,
    request: Request,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Осознанный перенос пациента; филиал врача меняет только администратор БД."""
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Смена филиала врача выполняется администратором клиники")
    if not _branch_change_limiter.allow(f"branch|{user['id']}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток — повторите позже")
    if not auth.verify_password(data.current_password, user["password_hash"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Неверный пароль")
    branch = _branch_of(db, data.branch_id)
    if branch is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Филиал не найден")
    if user["branch_id"] == data.branch_id:
        return user_payload(user, branch)
    # Переносим незавершённые записи вместе с пациентом: иначе после смены филиала
    # пациент видит запись, которую не сможет открыть ни один врач нового филиала.
    db.execute("UPDATE visits SET branch_id = ? WHERE patient_id = ? AND status = 'planned'",
               (data.branch_id, user["id"]))
    db.execute("UPDATE users SET branch_id = ? WHERE id = ?", (data.branch_id, user["id"]))
    record(db, "patient.branch_change", user_id=user["id"], entity="user", entity_id=user["id"],
           details={"from_branch_id": user["branch_id"], "to_branch_id": data.branch_id},
           ip=_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    fresh = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return user_payload(fresh, branch)
