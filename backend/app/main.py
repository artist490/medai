"""Точка входа FastAPI: сборка приложения, CORS, раздача фронта."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .database import init_db
from .routers import analytics as analytics_router
from .routers import auth as auth_router
from .routers import chat as chat_router
from .routers import doctor as doctor_router
from .routers import documents as documents_router
from .routers import goals as goals_router
from .routers import measurements as measurements_router
from .routers import medcard as medcard_router
from .routers import stats as stats_router
from .routers import visits as visits_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="MedAI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(analytics_router.router)
app.include_router(chat_router.router)
app.include_router(documents_router.router)
app.include_router(goals_router.router)
app.include_router(doctor_router.router)
app.include_router(measurements_router.router)
app.include_router(medcard_router.router)
app.include_router(stats_router.router)
app.include_router(visits_router.router)


@app.get("/api/health")
def health():
    return {"ok": True, "llm_enabled": config.llm_enabled()}


# --- Прод-раздача: собранный фронтенд из frontend/dist ---
if config.FRONTEND_DIST.is_dir():
    assets = config.FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """SPA-fallback: всё, что не /api, отдаёт index.html."""
        if full_path.startswith("api"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        # Защита от path traversal (/..%2f..%2fbackend%2f.env): отдаём только
        # файлы, реально лежащие внутри dist; всё остальное — index.html.
        candidate = (config.FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(config.FRONTEND_DIST):
            return FileResponse(candidate)
        return FileResponse(config.FRONTEND_DIST / "index.html")
