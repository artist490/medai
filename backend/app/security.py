"""Безопасность HTTP: заголовки, HTTPS, cookie-аутентификация, CSRF и лимиты."""
import hmac
import time
from collections import defaultdict
from threading import Lock
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import config

SESSION_COOKIE = "medai_session"
CSRF_COOKIE = "medai_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
# Даже при явно включённом insecure-режиме нельзя оставить чужой origin пустым.
_TRUSTED_DEFAULTS = ("http://localhost:5173", "http://127.0.0.1:5173")


def public_origin(scope: Scope) -> str:
    """Origin приложения; proxy доверен только в production/явной HTTPS-настройке."""
    headers = Headers(scope=scope)
    proto = "https" if config.ENFORCE_HTTPS else scope.get("scheme", "http")
    if config.ENV != "production" and not config.ENFORCE_HTTPS:
        proto = headers.get("x-forwarded-proto", proto)
    host = headers.get("host", "localhost")
    return f"{proto}://{host}"


def trusted_origins(scope: Scope) -> set[str]:
    origins = {public_origin(scope), *config.CORS_ORIGINS}
    if config.ENV != "production":
        origins.update(_TRUSTED_DEFAULTS)
    if config.ENV != "production":
        origins.update(("http://localhost:3000", "http://127.0.0.1:3000"))
    return origins


def cors_headers(scope: Scope) -> dict[str, str]:
    headers = Headers(scope=scope)
    origin = headers.get("origin")
    if not origin or origin not in trusted_origins(scope):
        return {}
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "vary": "Origin",
    }


def _same_origin(scope: Scope) -> bool:
    """Fetch Metadata + сравнение Origin: защита cookie от CSRF и CORS-обхода."""
    headers = Headers(scope=scope)
    site = headers.get("sec-fetch-site")
    if site == "cross-site":
        return False
    origin = headers.get("origin")
    if origin and origin not in trusted_origins(scope):
        return False
    referer = headers.get("referer")
    if referer:
        parsed = urlsplit(referer)
        if f"{parsed.scheme}://{parsed.netloc}" not in trusted_origins(scope):
            return False
    return True


class SecurityMiddleware:
    """ASGI-middleware без зависимости от порядка встроенных middleware Starlette."""
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        path = scope.get("path", "")
        if path == "/api/health":
            await self.app(scope, receive, _send_with_security(scope, send))
            return
        forwarded_proto = headers.get("x-forwarded-proto", scope.get("scheme"))
        # Backend не должен быть доступен напрямую: Uvicorn запускается с
        # --proxy-headers и доверенным proxy только из закрытой docker-сети.
        if config.ENFORCE_HTTPS and forwarded_proto != "https":
            location = "https://" + headers.get("host", "localhost") + path
            if scope.get("query_string"):
                location += "?" + scope["query_string"].decode("latin-1")
            response = Response(status_code=308, headers={"location": location})
            await response(scope, receive, send)
            return
        if scope["method"] == "OPTIONS" and path.startswith("/api"):
            allowed = cors_headers(scope)
            if not allowed:
                response = Response(status_code=403)
            else:
                response = Response(status_code=204, headers={
                    **allowed,
                    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    "access-control-allow-headers": "Authorization, Content-Type, X-CSRF-Token",
                    "access-control-max-age": "600",
                })
            await response(scope, receive, send)
            return
        if not _same_origin(scope):
            response = JSONResponse({"detail": "Недоверенный источник запроса"}, status_code=403)
            await response(scope, receive, send)
            return
        if (path.startswith("/api") and scope["method"] not in SAFE_METHODS
                and path not in {"/api/auth/login", "/api/auth/register", "/api/auth/logout"}):
            # Bearer — не ambient authority, CSRF ему не нужен. Cookie требует
            # неугадываемый токен, который JS сайта читает из не-HttpOnly cookie.
            if "authorization" not in headers and SESSION_COOKIE in headers.get("cookie", ""):
                cookies = _parse_cookies(headers.get("cookie", ""))
                expected = cookies.get(CSRF_COOKIE, "")
                actual = headers.get(CSRF_HEADER, "")
                if not expected or len(expected) < 32 or not hmac.compare_digest(expected, actual):
                    response = JSONResponse({"detail": "Недействительный CSRF-токен"}, status_code=403)
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, _send_with_security(scope, send))


def _send_with_security(scope: Scope, send: Send) -> Send:
    async def wrapped(message: Message) -> None:
        if message["type"] == "http.response.start":
            raw_headers = list(message.get("headers", []))
            headers = Headers(raw=raw_headers)

            def set_header(key: str, value: str, *, replace: bool = False) -> None:
                encoded = key.encode("latin-1")
                if replace:
                    raw_headers[:] = [(k, v) for k, v in raw_headers if k.lower() != encoded]
                raw_headers.append((encoded, value.encode("latin-1")))

            for key, value in {
                "x-content-type-options": "nosniff",
                "x-frame-options": "DENY",
                "referrer-policy": "no-referrer",
                "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-resource-policy": "same-origin",
                "content-security-policy": config.CONTENT_SECURITY_POLICY,
            }.items():
                if key not in headers:
                    set_header(key, value)
            if config.ENFORCE_HTTPS:
                set_header("strict-transport-security", "max-age=63072000; includeSubDomains")
            for key, value in cors_headers(scope).items():
                if key not in headers:
                    set_header(key, value)
            if scope.get("path", "").startswith(("/api/auth/", "/api/documents/")):
                set_header("cache-control", "no-store", replace=True)
            message = {**message, "headers": raw_headers}
        await send(message)
    return wrapped


def _parse_cookies(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in raw.split(";"):
        key, sep, value = part.strip().partition("=")
        if sep:
            result[key] = value
    return result


def session_cookie(token: str) -> str:
    secure = "; Secure" if config.SECURE_COOKIES else ""
    return (f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={config.SESSION_TTL_DAYS * 86400}{secure}")


def csrf_cookie(token: str) -> str:
    secure = "; Secure" if config.SECURE_COOKIES else ""
    return (f"{CSRF_COOKIE}={token}; Path=/; SameSite=Strict; "
            f"Max-Age={config.SESSION_TTL_DAYS * 86400}{secure}")


def clear_auth_cookies() -> list[str]:
    secure = "; Secure" if config.SECURE_COOKIES else ""
    return [
        f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
        f"{CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0{secure}",
    ]


class SlidingRateLimiter:
    """Потокобезопасный локальный лимитер; для нескольких реплик нужен Redis."""
    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._events: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            fresh = [t for t in self._events[key] if now - t < self.window]
            if len(fresh) >= self.limit:
                self._events[key] = fresh
                return False
            fresh.append(now)
            self._events[key] = fresh
            # Предотвращаем DoS памятью через уникальные IP/email/user_id.
            if len(self._events) > 20_000:
                cutoff = now - self.window
                self._events = defaultdict(list, {
                    k: v for k, v in self._events.items() if v and v[-1] > cutoff
                })
            return True


