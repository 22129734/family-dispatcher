"""Повторяющиеся дела: дни недели, «до какого числа» и умный срок по умолчанию.

Повтор без срока растягивался в календаре на годы, а расписание секции меняется каждую
неделю. Поэтому у повтора всегда есть дата окончания: если её не назвали — подбираем сами
по частоте (каждый день — на 2 недели, каждую неделю — на месяц, каждый месяц — на полгода).
«Всегда» — осознанный выбор человека.
"""

import re
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta

# «по вторникам», «по четвергам» — дни повтора; 0 — понедельник
_DAYS_PLURAL = (
    (r"понедельникам", 0),
    (r"вторникам", 1),
    (r"средам", 2),
    (r"четвергам", 3),
    (r"пятницам", 4),
    (r"субботам", 5),
    (r"воскресеньям", 6),
)
_MONTHS = {
    "январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6,
    "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12,
}  # fmt: skip
_MONTH_RE = (
    r"(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?"
    r"|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])"
)


def smart_until(recurrence: str, start: datetime | date) -> date | None:
    """Срок по умолчанию: ежедневно — 2 недели, еженедельно — месяц, ежемесячно — полгода."""
    day = start.date() if isinstance(start, datetime) else start
    if recurrence in ("daily", "weekdays"):
        return day + timedelta(days=14)
    if recurrence in ("weekly", "weekends", "days"):
        return day + relativedelta(months=1)
    if recurrence == "monthly":
        return day + relativedelta(months=6)
    return None


def days_from_text(lowered: str) -> list[int]:
    """«по вторникам и четвергам» → [1, 3]."""
    return sorted({n for stem, n in _DAYS_PLURAL if re.search(stem, lowered)})


def _month_number(word: str) -> int:
    for stem, n in sorted(_MONTHS.items(), key=lambda kv: -len(kv[0])):
        if word.startswith(stem):
            return n
    return 0


def _last_day(year: int, month: int) -> date:
    return (date(year, month, 1) + relativedelta(months=1)) - timedelta(days=1)


def until_from_text(lowered: str, now: datetime) -> date | None:
    """«до конца ноября», «до 30 ноября», «до 30.11», «до конца месяца» → дата окончания."""
    if re.search(r"до конца (этого )?месяца", lowered):
        return _last_day(now.year, now.month)
    if re.search(r"до конца года", lowered):
        return date(now.year, 12, 31)
    match = re.search(r"до конца " + _MONTH_RE, lowered)
    if match:
        month = _month_number(match.group(1))
        year = now.year + (1 if month < now.month else 0)
        return _last_day(year, month)
    match = re.search(r"до (\d{1,2}) " + _MONTH_RE, lowered) or re.search(
        r"до (\d{1,2})[./](\d{1,2})(?![./]\d)", lowered
    )
    if match:
        day = int(match.group(1))
        month = int(match.group(2)) if match.group(2).isdigit() else _month_number(match.group(2))
        year = now.year + (1 if (month, day) < (now.month, now.day) else 0)
        try:
            return date(year, month, day)
        except ValueError:
            return None
    return None


def fits(day: datetime, recurrence: str, days: list[int] | None, first: datetime | None) -> bool:
    """Подходит ли день под повтор (для будней, выходных и выбранных дней недели)."""
    if recurrence == "weekdays":
        return day.weekday() < 5
    if recurrence == "weekends":
        return day.weekday() >= 5
    if recurrence == "days":
        allowed = days or ([first.weekday()] if first else [])
        return day.weekday() in allowed
    return True


def align(due: datetime, recurrence: str, days: list[int] | None) -> datetime:
    """Первый раз — в подходящий день: «по вт и чт в 18», сказанное в понедельник, — это вторник."""
    if recurrence not in ("days", "weekends", "weekdays") or (recurrence == "days" and not days):
        return due
    for ahead in range(8):
        day = due + timedelta(days=ahead)
        if fits(day, recurrence, days, due):
            return day
    return due


def step(recurrence: str) -> relativedelta | None:
    return {
        "daily": relativedelta(days=1),
        "weekdays": relativedelta(days=1),
        "weekends": relativedelta(days=1),
        "days": relativedelta(days=1),
        "weekly": relativedelta(weeks=1),
        "monthly": relativedelta(months=1),
    }.get(recurrence)


def first_due(
    recurrence: str, days: list[int], at: tuple[int, int], now: datetime
) -> datetime | None:
    """Первый раз для «по вторникам и четвергам» без названной даты — ближайший такой день."""
    if recurrence not in ("days", "weekends", "weekly") or (recurrence != "weekends" and not days):
        return None
    allowed = [5, 6] if recurrence == "weekends" else days
    for ahead in range(8):
        day = (now + timedelta(days=ahead)).replace(
            hour=at[0], minute=at[1], second=0, microsecond=0
        )
        if day.weekday() in allowed and day > now:
            return day
    return None
