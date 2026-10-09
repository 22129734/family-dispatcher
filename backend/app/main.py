from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import analytics, app_routes, auth_routes, push_routes
from app.config import get_settings
from app.db import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


settings = get_settings()

app = FastAPI(
    title="Семейный диспетчер",
    description="ИИ, который занимается домашними делами",
    version="0.2.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def cache_headers(request: Request, call_next) -> Response:
    """Сборка с хэшами в именах кэшируется навсегда, всё остальное — с проверкой.

    Без этого браузер держал старый index.html и показывал прошлую версию приложения.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


app.include_router(auth_routes.router)
app.include_router(app_routes.router)
app.include_router(push_routes.router)
app.include_router(analytics.router)


@app.get("/health", tags=["service"])
def health() -> dict[str, object]:
    return {"status": "ok", "env": settings.app_env, "llm": settings.llm_enabled}


# Собранный веб-клиент (web/dist) отдаётся тем же сервером: один процесс на деплой.
_dist = Path(settings.web_dist_dir).resolve()
if (_dist / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        candidate = (_dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(_dist):
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
