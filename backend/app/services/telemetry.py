"""Учёт обращений решения к компонентам — основа метрики «обращений на 1 DAU».

По Положению конкурса (прил. 2, п. 2.2) обращение — это вызов решением компонента:
фундаментальной модели, навыка (системного промпта над моделью), внешнего API или
инструмента, фоновой системы, голосовой модели. Каждый такой вызов записывается сюда
с результатом, кодом ошибки и задержкой — для расчёта метрик, антифрода и логов.

Кто инициировал вызов, берётся из контекста запроса (`set_actor`), чтобы не протаскивать
участника через все слои. Запись идёт отдельной сессией: откат бизнес-транзакции не
стирает лог обращения.
"""

import hashlib
import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import insert

from app.config import get_settings
from app.db import SessionLocal

logger = logging.getLogger(__name__)


class Kind:
    """Типы компонентов. Список расширяется по мере подключения каналов."""

    LLM = "llm"  # вызов фундаментальной модели
    SKILL = "skill"  # навык: системный промпт и инструменты над моделью
    STT = "stt"  # распознавание речи
    PUSH = "push"
    VK = "vk"
    TELEGRAM = "telegram"
    EMAIL = "email"
    PHONE_AUTH = "phone_auth"
    SMS = "sms"  # СМС-приглашение в семью
    REMINDER = "reminder"  # фоновая система напоминаний
    ESCALATION = "escalation"
    API = "api"  # API решения: действие пользователя в приложении (создать дело, «Сделано»…)
    RULES = "rules"  # инструмент: разбор фразы правилами (сроки, повтор, список)
    CATALOG = "catalog"  # инструмент: словарь отделов магазина для списка покупок
    STORAGE = "storage"  # хранилище файлов: фото и скриншоты в деле
    PREVIEW = "preview"  # карточка ссылки-приглашения для мессенджера


@dataclass
class Actor:
    member_id: str | None = None
    family_id: str | None = None


_actor: ContextVar[Actor | None] = ContextVar("telemetry_actor", default=None)


def set_actor(member_id: str | None, family_id: str | None) -> None:
    _actor.set(Actor(member_id=member_id, family_id=family_id))


def current_actor() -> Actor:
    return _actor.get() or Actor()


def anonymize(value: str | None) -> str | None:
    """Обезличенный стабильный идентификатор для выгрузок организаторам."""
    if not value:
        return None
    salt = get_settings().analytics_salt
    return hashlib.sha256(f"{salt}:{value}".encode()).hexdigest()[:16]


def record(
    kind: str,
    operation: str,
    *,
    status: str = "ok",
    error_code: str | None = None,
    latency_ms: int | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    model: str | None = None,
    cost_rub: float | None = None,
    actor: Actor | None = None,
) -> None:
    """Записать одно обращение. Ошибка записи не должна ломать пользовательский сценарий."""
    from app.models import ComponentCallRow

    who = actor or current_actor()
    session = SessionLocal()
    try:
        session.add(
            ComponentCallRow(
                kind=kind,
                operation=operation,
                status=status,
                error_code=error_code,
                latency_ms=latency_ms,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=model,
                cost_rub=cost_rub,
                member_id=who.member_id,
                family_id=who.family_id,
            )
        )
        session.commit()
    except Exception:
        logger.exception("Не удалось записать обращение %s/%s", kind, operation)
        session.rollback()
    finally:
        session.close()


@dataclass
class CallResult:
    """Что вызывающий код сообщает о вызове внутри `track_call`."""

    status: str = "ok"
    error_code: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    model: str | None = None
    cost_rub: float | None = None
    extra: dict = field(default_factory=dict)


@contextmanager
def track_call(kind: str, operation: str) -> Iterator[CallResult]:
    """Замерить вызов и записать его; исключение фиксируется как ошибка и пробрасывается."""
    result = CallResult()
    started = time.perf_counter()
    try:
        yield result
    except Exception as exc:
        result.status = "error"
        result.error_code = result.error_code or type(exc).__name__
        raise
    finally:
        record(
            kind,
            operation,
            status=result.status,
            error_code=result.error_code,
            latency_ms=int((time.perf_counter() - started) * 1000),
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            model=result.model,
            cost_rub=result.cost_rub,
        )


# ---------- Запросы приложения к API решения ----------
# Их много (десятки на пользователя в день), поэтому пишем не по одному, а пачкой раз
# в несколько секунд (main.py). Фоновые обновления экрана по таймеру не считаются —
# клиент помечает их заголовком X-Auto, это не действие человека.

_api_calls: list[dict] = []
_api_lock = threading.Lock()


def note_api(operation: str, status_code: int, latency_ms: int, actor: Actor) -> None:
    ok = status_code < 400
    with _api_lock:
        _api_calls.append(
            {
                "created_at": datetime.now(),
                "kind": Kind.API,
                "operation": operation[:60],
                "status": "ok" if ok else "error",
                "error_code": None if ok else f"http_{status_code}",
                "latency_ms": latency_ms,
                "member_id": actor.member_id,
                "family_id": actor.family_id,
            }
        )


def flush_api() -> int:
    """Записать накопленные запросы к API одной вставкой; вернуть их число."""
    from app.models import ComponentCallRow

    with _api_lock:
        rows = _api_calls[:]
        _api_calls.clear()
    if not rows:
        return 0
    session = SessionLocal()
    try:
        session.execute(insert(ComponentCallRow), rows)
        session.commit()
    except Exception:
        logger.exception("Не удалось записать %s запросов к API", len(rows))
        session.rollback()
        return 0
    finally:
        session.close()
    return len(rows)
