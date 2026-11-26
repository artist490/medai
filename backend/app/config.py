"""Настройки приложения — читаются из .env и переменных окружения."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

# --- LLM (PlusVibe API, OpenAI-совместимый: https://plusvibeapi.ru/v1) ---
# Дефолты синхронизированы с backend/.env.example — не расходятся с ним.
LLM_API_KEY: str = os.getenv("LLM_API_KEY", "").strip()
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://plusvibeapi.ru/v1").strip().rstrip("/")
LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek-v4.1-flash-1017").strip()
CHAT_MODEL: str = os.getenv("CHAT_MODEL", "deepseek-v4.1-flash-1017").strip()
LLM_TIMEOUT: float = float(os.getenv("LLM_TIMEOUT", "20"))

# --- Локальный OCR: файлы не покидают сервер. Веса скачиваются отдельно. ---
OCR_MODEL: str = os.getenv("OCR_MODEL", "ocria-nano")
if OCR_MODEL not in {"ocria-nano", "tesseract"}:
    raise RuntimeError("OCR_MODEL должен быть ocria-nano или tesseract")


def _ocr_model_roots() -> list[Path]:
    roots = [Path(os.environ["LITEPARSE_MODEL_DIR"])] if os.getenv("LITEPARSE_MODEL_DIR") else []
    # Веса в репозитории (backend/models) — проект работает сразу после клонирования.
    roots.append(BACKEND_DIR / "models")
    if os.name == "nt" and os.getenv("LOCALAPPDATA"):
        roots.append(Path(os.environ["LOCALAPPDATA"]) / "liteparse" / "models")
    roots.append(Path.home() / ".cache" / "liteparse" / "models")
    return roots


def ocr_model_root() -> Path | None:
    """Корень весов: первый, где лежит <OCR_MODEL>/det.onnx. None — весов нет."""
    if OCR_MODEL == "tesseract":
        return None
    for root in _ocr_model_roots():
        if (root / OCR_MODEL / "det.onnx").is_file():
            return root
    return None


def _ocr_model_installed() -> bool:
    return OCR_MODEL == "tesseract" or ocr_model_root() is not None


OCR_ENABLED: bool = (
    _ocr_model_installed() if os.getenv("OCR_ENABLED") is None
    else os.getenv("OCR_ENABLED", "").lower() == "true"
)
OCR_MAX_PAGES: int = min(30, max(1, int(os.getenv("OCR_MAX_PAGES", "10"))))
OCR_WORKERS: int = min(2, max(1, int(os.getenv("OCR_WORKERS", "1"))))
OCR_TIMEOUT: int = min(600, max(30, int(os.getenv("OCR_TIMEOUT", "180"))))
OCR_MAX_TEXT: int = min(500_000, max(1_000, int(os.getenv("OCR_MAX_TEXT", "200000"))))

# --- Приложение и production-безопасность ---
ENV: str = os.getenv("APP_ENV", "development").strip().lower()
ENFORCE_HTTPS: bool = os.getenv("ENFORCE_HTTPS", "true" if ENV == "production" else "false").lower() == "true"
SECURE_COOKIES: bool = os.getenv("SECURE_COOKIES", "true" if ENFORCE_HTTPS else "false").lower() == "true"
SESSION_TTL_DAYS: int = min(30, max(1, int(os.getenv("SESSION_TTL_DAYS", "7"))))
CORS_ORIGINS: tuple[str, ...] = tuple(
    origin.strip().rstrip("/") for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()
)
# Локальная LLM (например, защищённый Ollama/vLLM) разрешается только явным флагом.
LLM_ALLOW_INSECURE_HTTP: bool = os.getenv("LLM_ALLOW_INSECURE_HTTP", "false").lower() == "true"
CONTENT_SECURITY_POLICY: str = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
    "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:5173 http://127.0.0.1:5173; "
    "worker-src 'self' blob:; manifest-src 'self'"
)
if ENV == "production" and LLM_BASE_URL.startswith("http://") and not LLM_ALLOW_INSECURE_HTTP:
    raise RuntimeError("LLM_BASE_URL должен использовать HTTPS в production")

DATABASE_PATH: Path = Path(os.getenv("DATABASE_PATH", "medai.db"))
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = BACKEND_DIR / DATABASE_PATH

# Конвенция времени (осознанная, см. TECH_DEBT_AUDIT.md F012):
# - сессии и всё серверное — UTC (timezone.utc, auth.py);
# - recorded_at/created_at замеров, визитов, документов — НАИВНОЕ ЛОКАЛЬНОЕ
#   время (дневник пациента живёт в местном времени клиники).
# Не смешивать: парсинг даты замера не должен прилетать с таймзоной UTC.

# Папка со сборкой фронтенда (frontend/dist) — для прод-запуска одним процессом
FRONTEND_DIST: Path = BACKEND_DIR.parent / "frontend" / "dist"


def ocr_enabled() -> bool:
    """Нельзя включить отсутствующую модель простой сменой переменной."""
    return OCR_ENABLED and _ocr_model_installed()


def llm_enabled() -> bool:
    """LLM-рекомендации доступны, только если вписан ключ."""
    return bool(LLM_API_KEY)
