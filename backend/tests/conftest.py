"""Окружение тестов: задаётся до первого импорта приложения.

SQLite в памяти, без LLM, без SMS.RU и без сети. Модуль app.db создаёт движок при
импорте, поэтому переменные должны быть выставлены раньше любого `import app...`.
Переменные окружения перекрывают значения из локального backend/.env с реальными ключами.
"""

import os
import tempfile

import httpx
import pytest

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["LLM_API_KEY"] = ""
os.environ["LLM_MODEL"] = ""
os.environ["SMSRU_API_ID"] = ""
os.environ["ADMIN_TOKEN"] = "admin"
os.environ["APP_ENV"] = "test"
os.environ["UPLOADS_DIR"] = tempfile.mkdtemp(
    prefix="fd-uploads-"
)  # файлы тестов — во временной папке


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Реальные HTTP-запросы из тестов запрещены — только httpx.MockTransport."""
    original = httpx.Client.send

    def guarded_send(self: httpx.Client, request: httpx.Request, *args, **kwargs):
        if not isinstance(self._transport, httpx.MockTransport) and request.url.host not in (
            "testserver",
        ):
            raise RuntimeError(f"Тест пытается выйти в сеть: {request.url.host}")
        return original(self, request, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "send", guarded_send)
