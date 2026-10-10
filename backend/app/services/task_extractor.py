"""Превращение свободной речи в структурированную задачу.

Основной путь — LLM с function calling (OpenAI-совместимый API). Резервный — детерминированные
правила: они же используются в тестах и при недоступности LLM.
"""

import re
from datetime import datetime, timedelta

from dateutil import parser as date_parser

from app.schemas.task import Priority, Recurrence, TaskDraft
from app.services.llm_client import LLMClient
from app.services.when import due_from_text, end_from_text

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
# «спросить про давление и продлить рецепт» → вопросы врачу пунктами
_ASK_RE = re.compile(
    r"(?:спросить|узнать|уточнить)(?:\s+(?:про|о|об|насчёт|насчет))?\s+(.+)$", re.IGNORECASE
)
# Подробности для заметки
_NOTE_RE = re.compile(
    r"(?:(?:[а-яё]+|\d+-?[а-яё]*)\s+(?:подъезд|этаж)\b[^,;]*"  # «второй подъезд», «3 этаж»
    r"|(?:кабинет|каб\.|кабинете|подъезд|этаж|квартира|кв\.|адрес|заказ №|номер заказа)"
    r"\s*[^,;]+)",
    re.IGNORECASE,
)
# Совместное дело: «мы с мужем», «вместе», «муж с сыном идут»
_TOGETHER_RE = re.compile(
    r"\bмы\s+с\b|\bвместе\b|\bя\s+и\b|\bи\s+я\b|\bс\s+мной\b"
    r"|\b(?:идут|пойдут|поедут|едут|сходят|идём|идем|пойдём|пойдем|поедем|едем)\b.*\bс\s+\w+"
    r"|\b\w+\s+с\s+\w+\s+(?:идут|пойдут|поедут|едут|сходят)\b"
)
MAX_ITEMS = 60

# Автор берёт дело на себя: «напомни мне», «себе», «я заберу», «сама схожу»
_SELF_RE = re.compile(
    r"\b(напомни(ть)?\s+мне|мне\s+напомни(ть)?|себе|я\s+сам[аи]?|сам[аи]?\s+\w+[ую]\b"
    r"|я\s+\w+[ую]\b|мо[её]\s+дело|для\s+себя|мне\s+(?:нужно|надо)|(?:нужно|надо)\s+мне)",
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
        elif llm.due_at is None and not llm.clarifying_question and rules.clarifying_question:
            # Срок не понял никто, а модель не спросила — спросим сами, а не тихо «без срока»
            updates["clarifying_question"] = rules.clarifying_question
        if rules.requires_car and not llm.requires_car:
            updates["requires_car"] = True
        if llm.assignee is None and rules.assignee is not None:
            updates["assignee"] = rules.assignee
        if not llm.items and rules.items:
            updates["items"] = rules.items
        if not llm.note and rules.note:
            updates["note"] = rules.note
        if not llm.participants and rules.participants:
            updates["participants"] = rules.participants
        if rules.ends_at and rules.due_at and not llm.ends_at:
            # «с 9 до 10»: модель могла принять «до 10» за срок — начало берём у правил
            due = updates.get("due_at") or llm.due_at
            if due is not None and due.time() == rules.ends_at.time():
                due = rules.due_at
                updates["due_at"] = due
            if due is not None:
                updates["ends_at"] = due + (rules.ends_at - rules.due_at)
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

        ends_at = None
        if due_at and payload.get("ends_at"):
            try:
                ends_at = date_parser.isoparse(payload["ends_at"]).replace(tzinfo=None)
            except (ValueError, TypeError):
                ends_at = None
            if ends_at is not None and not (due_at < ends_at <= due_at + timedelta(hours=16)):
                ends_at = None

        items = _clean_items(payload.get("items"))
        title = payload["title"]
        if len(items) == 1:
            # Одна вещь — не список: «купить хлеб», а не «Купить продукты» с пунктом «хлеб»
            if re.fullmatch(r"купить (продукты|покупки|всё нужное)", title.strip().lower()):
                title = f"Купить {items[0]}"
            items = []
        return TaskDraft(
            title=title,
            beneficiary=payload.get("beneficiary"),
            due_at=due_at,
            ends_at=ends_at,
            duration_minutes=payload.get("duration_minutes") or 30,
            priority=Priority(payload.get("priority", Priority.NORMAL)),
            recurrence=Recurrence(payload.get("recurrence", Recurrence.NONE)),
            requires_car=bool(payload.get("requires_car", False)),
            location=payload.get("location"),
            confidence=0.95 if not payload.get("clarifying_question") else 0.6,
            clarifying_question=payload.get("clarifying_question"),
            assignee=(payload.get("assignee") or "").strip() or None,
            items=items,
            note=(str(payload.get("note") or "").strip() or None),
            participants=[
                str(p).strip() for p in payload.get("participants") or [] if str(p).strip()
            ][:10],
        )

    def _from_rules(self, message: str, now: datetime, members: list[str]) -> TaskDraft:
        lowered = message.lower()

        recurrence = Recurrence.NONE
        for value, markers in _RECURRENCE_MARKERS.items():
            if any(marker in lowered for marker in markers):
                recurrence = value
                break

        due_at = due_from_text(lowered, now)

        priority = Priority.HIGH if any(m in lowered for m in _URGENT_MARKERS) else Priority.NORMAL

        return TaskDraft(
            title=message.strip().rstrip("."),
            due_at=due_at,
            ends_at=end_from_text(message, due_at),
            priority=priority,
            recurrence=recurrence,
            requires_car=any(marker in lowered for marker in _CAR_MARKERS),
            confidence=0.5,
            clarifying_question=None if due_at else "На какой день поставить эту задачу?",
            assignee=self._assignee_from_text(lowered, members),
            items=self._items_from_text(message),
            note=self._note_from_text(message),
            participants=self._participants_from_text(lowered, members),
        )

    @staticmethod
    def _items_from_text(message: str) -> list[str]:
        """Пункты: покупки («купи хлеб, молоко», «продукты: курица, рис») и вопросы
        («спросить про давление и рецепт»). Одна вещь — не список, а просто задача."""
        text = message.strip().rstrip(".")
        ask = _ASK_RE.search(text)
        if ask:
            rest = _NOTE_RE.sub(" ", ask.group(1))
            items = _clean_items(re.split(r",|;|\s+и\s+", rest))
            return items
        match = _BUY_RE.match(text)
        if not match:
            return []
        rest = match.group(1)
        if ":" in rest:  # «продукты на выходные: курица, рис» — список после двоеточия
            rest = rest.split(":", 1)[1]
        rest = _NOISE_RE.sub(" ", rest)
        items = _clean_items(re.split(r",|;|\s+и\s+", rest))
        return items if len(items) >= 2 else []

    @staticmethod
    def _note_from_text(message: str) -> str | None:
        """Подробности для заметки: «кабинет 214», «подъезд 3», «адрес …»."""
        found = [m.group(0).strip(" ,.") for m in _NOTE_RE.finditer(message)]
        return "; ".join(found) or None

    @staticmethod
    def _participants_from_text(lowered: str, members: list[str]) -> list[str]:
        """«Мы с мужем идём в кино» → ["self", "муж"]; без слов «вместе» — пусто."""
        if not _TOGETHER_RE.search(lowered):
            return []
        words = re.findall(r"[а-яёa-z]+", lowered)
        found: list[str] = []
        if re.search(r"\bмы\b|\bя\s+и\b|\bи\s+я\b|\bс\s+мной\b", lowered):
            found.append("self")
        for name in members:
            base = name.strip().lower()
            stem = base[:-1] if len(base) > 3 else base
            if base and any(w == base or (len(base) > 3 and w.startswith(stem)) for w in words):
                found.append(name)
        for w in words:
            if re.fullmatch(r"(муж|жен|супруг|сын|доч|дочк)[а-яё]*", w) and not w.startswith(
                "женщин"
            ):
                root = re.match(r"муж|жен|супруг|сын|дочк|доч", w).group(0)
                ref = {"жен": "жена", "доч": "дочь", "дочк": "дочь"}.get(root, root)
                if ref not in found:
                    found.append(ref)
        # Совместное — это минимум двое
        return found if len(found) >= 2 else []

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


def _clean_items(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    items = []
    for value in raw:
        text = " ".join(str(value).split()).strip(" .,-")
        if text and text.lower() not in {item.lower() for item in items}:
            items.append(text[:120])
    return items[:MAX_ITEMS]
