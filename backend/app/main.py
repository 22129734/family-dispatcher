import asyncio
import contextlib
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import analytics, app_routes, auth_routes, push_routes, support_routes
from app.config import get_settings
from app.db import API_CONCURRENCY, SessionLocal, init_db
from app.services import telemetry
from app.services.link_preview import personalize


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    flusher = asyncio.create_task(_flush_api_calls())
    yield
    flusher.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await flusher
    await asyncio.to_thread(telemetry.flush_api)


async def _flush_api_calls() -> None:
    while True:
        await asyncio.sleep(5)
        await asyncio.to_thread(telemetry.flush_api)


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


_api_slots = asyncio.Semaphore(API_CONCURRENCY)

# Служебные запросы — не действие в сценарии: свои события аналитики и выгрузки
_NOT_COUNTED = ("/api/v1/events", "/api/v1/analytics")


@app.middleware("http")
async def count_api(request: Request, call_next) -> Response:
    """Запрос приложения к API решения — обращение к компоненту (см. telemetry.note_api)."""
    started = time.perf_counter()
    response = await call_next(request)
    actor = getattr(request.state, "actor", None)
    if (
        actor is not None
        and request.headers.get("x-auto") != "1"
        and not request.url.path.startswith(_NOT_COUNTED)
    ):
        route = request.scope.get("route")
        operation = f"{request.method} {getattr(route, 'path', request.url.path)}"
        ms = int((time.perf_counter() - started) * 1000)
        telemetry.note_api(operation, response.status_code, ms, actor)
    return response


@app.middleware("http")
async def limit_api(request: Request, call_next) -> Response:
    """Не больше API_CONCURRENCY запросов к API одновременно, остальные ждут на входе.

    Без этого всплеск запросов занимал все потоки ожиданием соединения с базой, а запросы,
    уже державшие соединения, стояли в очереди за потоком следующего шага (зависимости
    и обработчик выполняются в потоках по очереди) — сервис висел, пока не разберёт хвост
    (14.10.2026, нагрузочный тест на 100 RPS). Ждём слот не дольше 10 с, потом — 503.
    """
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    try:
        await asyncio.wait_for(_api_slots.acquire(), timeout=10)
    except TimeoutError:
        return JSONResponse(
            {"detail": "Сервер перегружен, повторите через минуту"},
            status_code=503,
            headers={"Retry-After": "30"},
        )
    try:
        return await call_next(request)
    finally:
        _api_slots.release()


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
app.include_router(support_routes.router)
app.include_router(analytics.router)


@app.get("/health", tags=["service"])
def health() -> dict[str, object]:
    return {"status": "ok", "env": settings.app_env, "llm": settings.llm_enabled}


# Собранный веб-клиент (web/dist) отдаётся тем же сервером: один процесс на деплой.
_dist = Path(settings.web_dist_dir).resolve()
# Расширения настоящих файлов: их нет — отвечаем 404. Ссылки /t/<токен.подпись> сюда не попадают
_FILE_SUFFIXES = {
    ".ico",
    ".png",
    ".svg",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".txt",
    ".xml",
    ".json",
    ".js",
    ".css",
    ".map",
    ".html",
    ".webmanifest",
    ".woff",
    ".woff2",
}

if (_dist / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str, request: Request) -> Response:
        candidate = (_dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(_dist):
            return FileResponse(candidate)
        if Path(path).suffix.lower() in _FILE_SUFFIXES:
            # Нет такого файла — честный 404, а не главная страница: иначе поисковик
            # получает HTML вместо /favicon.ico или /robots.txt
            return Response(status_code=404)
        ref = request.query_params.get("from")
        if path.startswith("join/") or ref:
            # Ссылка-приглашение: имя пригласившего — в карточку ссылки в мессенджере
            html = (_dist / "index.html").read_text(encoding="utf-8")
            with SessionLocal() as db, telemetry.track_call(telemetry.Kind.PREVIEW, "invite_card"):
                return HTMLResponse(personalize(html, path, ref, db))
        return FileResponse(_dist / "index.html")
