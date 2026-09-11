from fastapi import FastAPI

from app.api.routes import router
from app.config import get_settings

app = FastAPI(
    title="Семейный диспетчер",
    description="ИИ, который занимается домашними делами",
    version="0.1.0",
)
app.include_router(router)


@app.get("/health", tags=["service"])
def health() -> dict[str, object]:
    settings = get_settings()
    return {"status": "ok", "env": settings.app_env, "gigachat": settings.gigachat_enabled}
