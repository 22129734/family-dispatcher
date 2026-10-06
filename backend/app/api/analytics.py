"""Аналитика для организаторов Sber500: DAU, обращения к компонентам, выгрузки.

Все эндпоинты требуют заголовок `X-Admin-Token`. В выгрузках идентификаторы
участников и семей обезличены (стабильный хэш с солью), чтобы данные можно было
передать организаторам для проверки метрик и антифрода.
"""

import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.auth import DbSession
from app.config import get_settings
from app.models import ComponentCallRow, EventRow
from app.schemas.api import AnalyticsOut, DailyStat
from app.services.telemetry import anonymize

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

# События, которые не считаются действием пользователя: это просмотры, а не действия.
PASSIVE_EVENTS = {"app_open", "screen_view"}


def _require_admin(token: str | None) -> None:
    admin_token = get_settings().admin_token
    if not admin_token or token != admin_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужен токен администратора")


def _period(days: int, until: date | None = None) -> tuple[datetime, datetime]:
    last_day = until or datetime.now().date()
    first_day = last_day - timedelta(days=days - 1)
    return (
        datetime.combine(first_day, datetime.min.time()),
        datetime.combine(last_day + timedelta(days=1), datetime.min.time()),
    )


@router.get("/daily", response_model=AnalyticsOut)
def daily(
    db: DbSession,
    x_admin_token: Annotated[str | None, Header()] = None,
    days: Annotated[int, Query(ge=1, le=90)] = 14,
) -> AnalyticsOut:
    """DAU и обращения на DAU по дням.

    DAU — уникальные участники с любым событием за сутки. Обращения — вызовы
    компонентов (LLM, навыки, голос, уведомления, фоновые системы), инициированные
    этими участниками.
    """
    _require_admin(x_admin_token)
    since, until = _period(days)

    active: dict[str, set[str]] = defaultdict(set)
    actions: dict[str, int] = defaultdict(int)
    for event in db.scalars(
        select(EventRow).where(EventRow.created_at >= since, EventRow.created_at < until)
    ):
        day = event.created_at.date().isoformat()
        active[day].add(event.member_id)
        if event.name not in PASSIVE_EVENTS:
            actions[day] += 1

    calls: dict[str, int] = defaultdict(int)
    errors: dict[str, int] = defaultdict(int)
    by_kind: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for call in db.scalars(
        select(ComponentCallRow).where(
            ComponentCallRow.created_at >= since, ComponentCallRow.created_at < until
        )
    ):
        day = call.created_at.date().isoformat()
        calls[day] += 1
        by_kind[day][call.kind] += 1
        if call.status != "ok":
            errors[day] += 1

    stats = []
    for offset in range(days):
        day = (since + timedelta(days=offset)).date().isoformat()
        dau = len(active[day])
        stats.append(
            DailyStat(
                day=day,
                dau=dau,
                actions=actions[day],
                actions_per_dau=round(actions[day] / dau, 2) if dau else 0.0,
                component_calls=calls[day],
                component_calls_per_dau=round(calls[day] / dau, 2) if dau else 0.0,
                component_errors=errors[day],
                calls_by_kind=dict(by_kind[day]),
            )
        )
    return AnalyticsOut(days=stats)


def _csv(rows: list[list[object]], header: list[str], filename: str) -> StreamingResponse:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(rows)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/component-calls.csv")
def component_calls_csv(
    db: DbSession,
    x_admin_token: Annotated[str | None, Header()] = None,
    days: Annotated[int, Query(ge=1, le=90)] = 28,
) -> StreamingResponse:
    """Полный лог обращений к компонентам за период — для проверки метрик организаторами."""
    _require_admin(x_admin_token)
    since, until = _period(days)
    rows = [
        [
            c.created_at.isoformat(timespec="seconds"),
            c.kind,
            c.operation,
            c.status,
            c.error_code or "",
            c.latency_ms if c.latency_ms is not None else "",
            c.tokens_in if c.tokens_in is not None else "",
            c.tokens_out if c.tokens_out is not None else "",
            c.model or "",
            anonymize(c.member_id) or "",
            anonymize(c.family_id) or "",
        ]
        for c in db.scalars(
            select(ComponentCallRow)
            .where(ComponentCallRow.created_at >= since, ComponentCallRow.created_at < until)
            .order_by(ComponentCallRow.id)
        )
    ]
    header = [
        "created_at", "kind", "operation", "status", "error_code", "latency_ms",
        "tokens_in", "tokens_out", "model", "user_id", "family_id",
    ]  # fmt: skip
    return _csv(rows, header, "component_calls.csv")


@router.get("/events.csv")
def events_csv(
    db: DbSession,
    x_admin_token: Annotated[str | None, Header()] = None,
    days: Annotated[int, Query(ge=1, le=90)] = 28,
) -> StreamingResponse:
    """Лог пользовательских событий — основа расчёта DAU."""
    _require_admin(x_admin_token)
    since, until = _period(days)
    rows = [
        [
            e.created_at.isoformat(timespec="seconds"),
            e.name,
            anonymize(e.member_id) or "",
            anonymize(e.family_id) or "",
        ]
        for e in db.scalars(
            select(EventRow)
            .where(EventRow.created_at >= since, EventRow.created_at < until)
            .order_by(EventRow.id)
        )
    ]
    return _csv(rows, ["created_at", "event", "user_id", "family_id"], "events.csv")
