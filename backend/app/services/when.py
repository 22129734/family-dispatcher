"""Срок задачи по разговорной фразе — подстраховка модели правилами.

Понимает день («сегодня», «завтра», «послезавтра», «в субботу») и время («в 19», «в 7:30»,
«утром», «вечером», «после работы», «перед сном»). Время суток без дня — сегодня,
а если это время уже прошло — завтра. День без времени — 18:00.
"""

import re
from datetime import datetime, timedelta

DEFAULT_HOUR = 18

# Длинные слова раньше коротких: «послезавтра» содержит «завтра»
_RELATIVE_DAYS = (("послезавтра", 2), ("сегодня", 0), ("завтра", 1))

_WEEKDAYS = (
    (r"понедельник", 0),
    (r"вторник", 1),
    (r"сред[ау]", 2),
    (r"четверг", 3),
    (r"пятниц[ау]", 4),
    (r"суббот[ау]", 5),
    (r"воскресень[ея]", 6),
)
_WEEKDAY_RE = re.compile(r"\b(?:в|во|на)\s+(" + "|".join(p for p, _ in _WEEKDAYS) + r")\b")

# Время суток → час. Порядок: сначала более конкретное
_DAYPARTS = (
    (r"после работы|с работы|после смены", 19, 0),
    (r"после школы|из школы", 15, 0),
    (r"после садика|из садика|из сада", 18, 0),
    (r"перед сном", 21, 0),
    (r"в обед|днём|днем", 13, 0),
    (r"утром|с утра", 9, 0),
    (r"вечером|вечерком", 19, 0),
    (r"ночью", 22, 0),
)

_TIME_RE = re.compile(r"\b(?:в|к|до)\s+(\d{1,2})(?:[:.](\d{2}))?\b")
_EVENING_RE = re.compile(r"вечер|после работы|ночью")

# Промежуток: «с 9 до 10», «с 9:30 по 11», «с 9-10», «10–12»
_T = r"(\d{1,2})(?:[:.](\d{2}))?"
_RANGES = (
    re.compile(r"\bс\s+" + _T + r"\s*(?:до|по|-|–|—)\s*" + _T + r"\b"),
    re.compile(r"(?<![\d:.\-+])" + _T + r"\s*[-–—]\s*" + _T + r"(?![\d\-])"),
)
# Длительность: «на час», «на полчаса», «на полтора часа», «на 2 часа», «на 40 минут»
_DURATION_RE = re.compile(
    r"\bна\s+(?:(полчаса)|(полтора\s+часа)|(час)\b|(\d+(?:[.,]5)?)\s*(час|ч\b|мин))"
)
_MAX_SPAN = timedelta(hours=16)


def _range_of(text: str) -> tuple[tuple[int, int], tuple[int, int]] | None:
    for regex in _RANGES:
        for match in regex.finditer(text):
            h1, m1 = int(match.group(1)), int(match.group(2) or 0)
            h2, m2 = int(match.group(3)), int(match.group(4) or 0)
            if h1 <= 23 and h2 <= 24 and m1 <= 59 and m2 <= 59 and (h1, m1) != (h2, m2):
                if h1 < 12 and _EVENING_RE.search(text):
                    h1 += 12
                return (h1, m1), (h2 % 24, m2)
    return None


def _duration_of(text: str) -> timedelta | None:
    match = _DURATION_RE.search(text)
    if not match:
        return None
    if match.group(1):
        return timedelta(minutes=30)
    if match.group(2):
        return timedelta(minutes=90)
    if match.group(3):
        return timedelta(hours=1)
    amount = float(match.group(4).replace(",", "."))
    minutes = amount * 60 if match.group(5) != "мин" else amount
    return timedelta(minutes=minutes) if 5 <= minutes <= 16 * 60 else None


def end_from_text(text: str, due: datetime | None) -> datetime | None:
    """Окончание дела, только если его назвали: «с 9 до 10», «на полтора часа»."""
    if due is None:
        return None
    lowered = text.lower()
    span = _range_of(lowered)
    if span:
        hour, minute = span[1]
        end = due.replace(hour=hour, minute=minute)
        while end <= due:  # «с 11 до 1» — до часу дня
            end += timedelta(hours=12)
        return end if end - due <= _MAX_SPAN else None
    duration = _duration_of(lowered)
    return due + duration if duration else None


def _time_of(text: str) -> tuple[int, int] | None:
    span = _range_of(text)
    if span:
        return span[0]
    match = _TIME_RE.search(text)
    if match:
        hour, minute = int(match.group(1)), int(match.group(2) or 0)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            # «в 7 вечером», «в 8 после работы» — вечер
            if hour < 12 and _EVENING_RE.search(text):
                hour += 12
            return hour, minute
    for pattern, hour, minute in _DAYPARTS:
        if re.search(pattern, text):
            return hour, minute
    return None


def due_from_text(text: str, now: datetime) -> datetime | None:
    """Срок из фразы или None, если ни дня, ни времени не сказано."""
    lowered = text.lower()
    time = _time_of(lowered)
    day: datetime | None = None

    for word, offset in _RELATIVE_DAYS:
        if word in lowered:
            day = now + timedelta(days=offset)
            break
    if day is None:
        match = _WEEKDAY_RE.search(lowered)
        if match:
            target = next(n for p, n in _WEEKDAYS if re.fullmatch(p, match.group(1)))
            ahead = (target - now.weekday()) % 7
            day = now + timedelta(days=ahead)

    if day is None and time is None:
        return None

    hour, minute = time or (DEFAULT_HOUR, 0)
    due = (day or now).replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due <= now:
        # Время уже прошло: без дня — завтра, для дня недели — через неделю
        if day is None:
            due += timedelta(days=1)
        elif _WEEKDAY_RE.search(lowered) and (day.date() == now.date()):
            due += timedelta(days=7)
    return due
