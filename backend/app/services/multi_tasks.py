"""Несколько дел в одном сообщении: расписание по дням недели или список.

Пример — расписание секции, которое родители пересылают в чат:

    ВТОРНИК
    Зал в 17:45-18:45 (2 группа + 2022)
    (База на Тутаевском шоссе)

Каждая строка со временем — отдельное дело: название до времени, промежуток — срок
и окончание, скобки и строки ниже — заметка. День берём из заголовка; если указана
неделя «(12.10-18.10)» — даты из неё, иначе ближайший такой день.

Разбор правилами: быстро, без обращения к модели, и расписания пишут однотипно.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.services.when import due_from_text

_WEEKDAYS = {
    "понедельник": 0,
    "вторник": 1,
    "среда": 2,
    "среду": 2,
    "четверг": 3,
    "пятница": 4,
    "пятницу": 4,
    "суббота": 5,
    "субботу": 5,
    "воскресенье": 6,
    "пн": 0,
    "вт": 1,
    "ср": 2,
    "чт": 3,
    "пт": 4,
    "сб": 5,
    "вс": 6,
}
_DAY_RE = re.compile(
    r"^\W*("
    + "|".join(sorted(_WEEKDAYS, key=len, reverse=True))
    + r")\b[\s,.:–—-]*(\d{1,2}[./]\d{1,2})?\W*$",
    re.IGNORECASE,
)
_WEEK_RE = re.compile(r"(\d{1,2})[./](\d{1,2})\s*[-–—]\s*(\d{1,2})[./](\d{1,2})")
_T = r"(\d{1,2})[:.](\d{2})"
_SPAN_RE = re.compile(_T + r"(?:\s*[-–—]\s*" + _T + r")?")
_LIST_RE = re.compile(r"^\s*(?:[-–—•*·]|\d{1,2}[.)])\s+(.+)$")
_REST_RE = re.compile(r"^\W*(выходной|нет тренировки|отдых|нет занятий)\W*$", re.IGNORECASE)
MAX_TASKS = 20


@dataclass
class Item:
    title: str
    due_at: datetime | None
    ends_at: datetime | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def note(self) -> str | None:
        text = "; ".join(n for n in self.notes if n)
        return text[:2000] or None


def _clean(text: str) -> str:
    return " ".join(text.replace("(", " ").replace(")", " ").split()).strip(" ,.;:–—-")


def _week_start(message: str, now: datetime) -> date | None:
    match = _WEEK_RE.search(message)
    if not match:
        return None
    day, month = int(match.group(1)), int(match.group(2))
    try:
        start = date(now.year, month, day)
    except ValueError:
        return None
    # Расписание на январь, присланное в декабре
    if (now.date() - start).days > 180:
        start = date(now.year + 1, month, day)
    return start - timedelta(days=start.weekday())


def _day_date(weekday: int, week: date | None, explicit: str | None, now: datetime) -> date:
    if explicit:
        d, m = (int(x) for x in re.split(r"[./]", explicit))
        try:
            return date(now.year, m, d)
        except ValueError:
            pass
    if week:
        return week + timedelta(days=weekday)
    ahead = (weekday - now.weekday()) % 7
    return now.date() + timedelta(days=ahead)


def _item_from_line(line: str, day: date) -> Item | None:
    span = _SPAN_RE.search(line)
    if not span:
        return None
    h1, m1 = int(span.group(1)), int(span.group(2))
    if h1 > 23 or m1 > 59:
        return None
    start = datetime(day.year, day.month, day.day, h1, m1)
    end = None
    if span.group(3):
        h2, m2 = int(span.group(3)), int(span.group(4))
        if h2 <= 23 and m2 <= 59:
            end = datetime(day.year, day.month, day.day, h2, m2)
            if end <= start:
                end += timedelta(days=1)
    before = re.sub(r"\s+(?:в|с|к)\s*$", "", line[: span.start()], flags=re.IGNORECASE)
    after = line[span.end() :]
    title = _clean(before) or _clean(after) or "Дело"
    item = Item(title=title[:300], due_at=start, ends_at=end)
    if _clean(before) and _clean(after):
        item.notes.append(_clean(after))
    return item


_DAY_WORDS = r"понедельник|вторник|среда|четверг|пятница|суббота|воскресенье"
_DAY_SPLIT_RE = re.compile(r"\s*\b(" + _DAY_WORDS + r")\b\s*", re.IGNORECASE)
# Следующее дело в той же строке: «… (1 группа) Лёд в 9:30-11:00»
_NEXT_ITEM_RE = re.compile(r"(?<=\S)\s+(?=[А-ЯЁA-Z][а-яёa-z]+\s+(?:в|с)\s+\d{1,2}[:.]\d{2})")


def _normalize(message: str) -> str:
    """Расписание, вставленное одной строкой (поле ввода съело переносы): разбиваем обратно."""
    if message.count("\n") >= 2:
        return message
    text = _DAY_SPLIT_RE.sub(lambda m: f"\n{m.group(1)}\n", message)
    return "\n".join(part for line in text.splitlines() for part in _NEXT_ITEM_RE.split(line))


def _schedule(message: str, now: datetime) -> list[Item]:
    message = _normalize(message)
    week = _week_start(message, now)
    items: list[Item] = []
    day: date | None = None
    current: Item | None = None
    for raw in message.splitlines():
        line = raw.strip()
        if not line:
            continue
        header = _DAY_RE.match(line)
        if header:
            day = _day_date(_WEEKDAYS[header.group(1).lower()], week, header.group(2), now)
            current = None
            continue
        if day is None or _REST_RE.match(line):
            continue
        item = _item_from_line(line, day)
        if item:
            items.append(item)
            current = item
        elif current is not None:
            current.notes.append(_clean(line))
    return items


def _bullets(message: str, now: datetime) -> list[Item]:
    """Список «- купить хлеб / - забрать Машу в 19»: каждая строка — дело."""
    lines = [m.group(1).strip() for m in map(_LIST_RE.match, message.splitlines()) if m]
    return [Item(title=line[:300], due_at=due_from_text(line, now)) for line in lines if line]


def split(message: str, now: datetime | None = None) -> list[Item]:
    """Отдельные дела из сообщения; меньше двух — значит, это одно дело."""
    now = now or datetime.now()
    items = _schedule(message, now)
    if len(items) < 2:
        items = _bullets(message, now)
    return items[:MAX_TASKS] if len(items) >= 2 else []
