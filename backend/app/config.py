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

# --- Приложение ---
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


def llm_enabled() -> bool:
    """LLM-рекомендации доступны, только если вписан ключ."""
    return bool(LLM_API_KEY)
