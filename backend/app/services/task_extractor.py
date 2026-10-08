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
# Порядок важен: «по будням» проверяем раньше «каждый день»
_RECURRENCE_MARKERS = {
    Recurrence.WEEKDAYS: ("по будням", "в будни", "каждый будний", "по рабочим дням"),
    Recurrence.DAILY: ("каждый день", "ежедневно", "каждое утро", "каждый вечер", "каждую ночь"),
    Recurrence.WEEKLY: (
        "каждую неделю",
        "еженедельно",
        "по понедельникам",
        "по вторникам",
        "по средам",
        "по четвергам",
        "по пятницам",
        "по субботам",
        "по воскресеньям",
        "каждый понедельник",
        "каждый вторник",
        "каждую среду",
        "каждый четверг",
        "каждую пятницу",
        "каждую субботу",
        "каждое воскресенье",
        "по выходным",
    ),
    Recurrence.MONTHLY: ("каждый месяц", "ежемесячно", "раз в месяц"),
}
_RELATIVE_DAYS = {"сегодня": 0, "завтра": 1, "послезавтра": 2}
# «Купи молоко, хлеб и яйца» → список покупок (правила — подстраховка, основное — LLM)
_BUY_RE = re.compile(
    r"^\s*(?:надо\s+|нужно\s+)?(?:купи(?:ть)?|докупи(?:ть)?)\s+(.+)$", re.IGNORECASE
)
_NOISE_RE = re.compile(
    r"\b(сегодня|завтра|послезавтра|срочно|по дороге( домой)?|после работы|вечером|утром"
    r"|в\s+\d{1,2}(:\d{2})?)\b",
    re.IGNORECASE,
)
MAX_ITEMS = 60

# Автор берёт дело на себя: «напомни мне», «себе», «я заберу», «сама схожу»
_SELF_RE = re.compile(
    r"\b(напомни(ть)?\s+мне|мне\s+напомни(ть)?|себе|я\s+сам[аи]?|сам[аи]?\s+\w+[ую]\b"
    r"|я\s+\w+[ую]\b|мо[её]\s+дело|для\s+себя)",
    re.IGNORECASE,
)


class TaskExtractor:
    def __init__(self, client: LLMClient | None = None) -> None:
        self._client = client or LLMClient()

    def extract(
        self,
        message: str,
        now: datetime | None = None,
        author: str | None = None,
        members: list[str] | None = None,
    ) -> TaskDraft:
        """members — имена остальных членов семьи: по ним понимаем, кому адресовано дело."""
        now = now or datetime.now()

        rules = self._from_rules(message, now, members or [])
        payload = self._client.extract_task(message, now.isoformat(), author, members)
        if payload:
            return self._merge(self._from_payload(payload, now), rules)
        return rules

    @staticmethod
    def _merge(llm: TaskDraft, rules: TaskDraft) -> TaskDraft:
        """Подстраховка модели правилами: явные маркеры в тексте не должны теряться.

        Модель лучше понимает формулировку и даты, правила — надёжнее ловят «срочно»,
        «каждую субботу» и «завтра». Берём от правил только то, что модель пропустила.
        """
        updates: dict = {}
        if llm.priority == Priority.NORMAL and rules.priority == Priority.HIGH:
            updates["priority"] = Priority.HIGH
        if llm.recurrence == Recurrence.NONE and rules.recurrence != Recurrence.NONE:
            updates["recurrence"] = rules.recurrence
        if llm.due_at is None and rules.due_at is not None:
            updates["due_at"] = rules.due_at
            updates["clarifying_question"] = None
        if rules.requires_car and not llm.requires_car:
            updates["requires_car"] = True
        if llm.assignee is None and rules.assignee is not None:
            updates["assignee"] = rules.assignee
        if not llm.items and rules.items:
            updates["items"] = rules.items
        return llm.model_copy(update=updates) if updates else llm

    def _from_payload(self, payload: dict, now: datetime) -> TaskDraft:
        due_raw = payload.get("due_at")
        due_at = None
        if due_raw:
            try:
                # Модель иногда дописывает «Z» или смещение к местному времени — считаем время
                # местным временем семьи, как и в подсказке.
                due_at = date_parser.isoparse(due_raw).replace(tzinfo=None)
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
            assignee=(payload.get("assignee") or "").strip() or None,
            items=_clean_items(payload.get("items")),
        )

    def _from_rules(self, message: str, now: datetime, members: list[str]) -> TaskDraft:
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
            assignee=self._assignee_from_text(lowered, members),
            items=self._items_from_text(message),
        )

    @staticmethod
    def _items_from_text(message: str) -> list[str]:
        """Покупки через запятую или «и»; одна вещь — не список, а просто задача."""
        match = _BUY_RE.match(message.strip().rstrip("."))
        if not match:
            return []
        rest = _NOISE_RE.sub(" ", match.group(1))
        parts = re.split(r",|;|\s+и\s+", rest)
        items = _clean_items(parts)
        return items if len(items) >= 2 else []

    @staticmethod
    def _assignee_from_text(lowered: str, members: list[str]) -> str | None:
        """Явно названный член семьи («Олегу забрать», «папа, купи») или сам автор."""
        words = re.findall(r"[а-яёa-z]+", lowered)
        for name in members:
            base = name.strip().lower()
            if not base:
                continue
            # Имя в любом падеже: «Олег» → «Олегу», «Папа» → «папе»; короткие — только целиком
            stem = base[:-1] if len(base) > 3 else base
            if any(w == base or (len(base) > 3 and w.startswith(stem)) for w in words):
                return name
        if _SELF_RE.search(lowered):
            return "self"
        return None

    @staticmethod
    def _extract_hour(text: str) -> int | None:
        match = re.search(r"\bв (\d{1,2})(?::\d{2})?\b", text)
        if not match:
            return None
        hour = int(match.group(1))
        return hour if 0 <= hour <= 23 else None


def _clean_items(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    items = []
    for value in raw:
        text = " ".join(str(value).split()).strip(" .,-")
        if text and text.lower() not in {item.lower() for item in items}:
            items.append(text[:120])
    return items[:MAX_ITEMS]
