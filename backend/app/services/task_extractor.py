"""Превращение свободной речи в структурированную задачу.

Основной путь — LLM с function calling (OpenAI-совместимый API). Резервный — детерминированные
правила: они же используются в тестах и при недоступности LLM.
"""

import re
from datetime import datetime, timedelta

from dateutil import parser as date_parser

from app.schemas.task import Priority, Recurrence, TaskDraft
from app.services.llm_client import LLMClient

_URGENT_MARKERS = ("срочно", "сегодня", "как можно скорее", "горит")
_CAR_MARKERS = ("отвезти", "забрать", "привезти", "заехать", "довезти")
_RECURRENCE_MARKERS = {
    Recurrence.DAILY: ("каждый день", "ежедневно"),
    Recurrence.WEEKLY: ("каждую неделю", "еженедельно", "по понедельникам", "по субботам"),
    Recurrence.MONTHLY: ("каждый месяц", "ежемесячно"),
}
_RELATIVE_DAYS = {"сегодня": 0, "завтра": 1, "послезавтра": 2}


class TaskExtractor:
    def __init__(self, client: LLMClient | None = None) -> None:
        self._client = client or LLMClient()

    def extract(self, message: str, now: datetime | None = None) -> TaskDraft:
        now = now or datetime.now()

        payload = self._client.extract_task(message, now.isoformat())
        if payload:
            return self._from_payload(payload, now)

        return self._from_rules(message, now)

    def _from_payload(self, payload: dict, now: datetime) -> TaskDraft:
        due_raw = payload.get("due_at")
        due_at = None
        if due_raw:
            try:
                due_at = date_parser.isoparse(due_raw)
            except (ValueError, TypeError):
                due_at = None

        return TaskDraft(
            title=payload["title"],
            beneficiary=payload.get("beneficiary"),
            due_at=due_at,
            duration_minutes=payload.get("duration_minutes") or 30,
            priority=Priority(payload.get("priority", Priority.NORMAL)),
            recurrence=Recurrence(payload.get("recurrence", Recurrence.NONE)),
            requires_car=bool(payload.get("requires_car", False)),
            location=payload.get("location"),
            confidence=0.95 if not payload.get("clarifying_question") else 0.6,
            clarifying_question=payload.get("clarifying_question"),
        )

    def _from_rules(self, message: str, now: datetime) -> TaskDraft:
        lowered = message.lower()

        recurrence = Recurrence.NONE
        for value, markers in _RECURRENCE_MARKERS.items():
            if any(marker in lowered for marker in markers):
                recurrence = value
                break

        due_at = None
        for word, offset in _RELATIVE_DAYS.items():
            if word in lowered:
                due_at = (now + timedelta(days=offset)).replace(
                    hour=self._extract_hour(lowered) or 18, minute=0, second=0, microsecond=0
                )
                break

        priority = Priority.HIGH if any(m in lowered for m in _URGENT_MARKERS) else Priority.NORMAL

        return TaskDraft(
            title=message.strip().rstrip("."),
            due_at=due_at,
            priority=priority,
            recurrence=recurrence,
            requires_car=any(marker in lowered for marker in _CAR_MARKERS),
            confidence=0.5,
            clarifying_question=None if due_at else "На какой день поставить эту задачу?",
        )

    @staticmethod
    def _extract_hour(text: str) -> int | None:
        match = re.search(r"\bв (\d{1,2})(?::\d{2})?\b", text)
        if not match:
            return None
        hour = int(match.group(1))
        return hour if 0 <= hour <= 23 else None
