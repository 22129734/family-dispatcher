"""Повторяющееся дело: изменения «только в этот раз» и «этот и все следующие».

Серия хранится одной записью: когда дело выполнено, создаётся следующий повтор — копия
текущего (family_service.spawn_next). Если человек поменял что-то только в этот раз,
в `series_base` запоминается, каким поле было в серии, — следующий повтор возьмёт
прежнее значение. Изменение «для всех» делает текущее значение новым для серии.
"""

from dataclasses import dataclass
from datetime import datetime

from app.models import TaskRow

# Поля, которые могут отличаться у одного раза; заметка — со своим переключателем
# (note_repeat), повтор и файлы — всегда про всю серию или только про этот раз
FIELDS = ("title", "due_at", "ends_at", "duration_minutes", "assignee_id", "participants", "items")
_DATES = {"due_at", "ends_at"}
# Срок и окончание связаны: перенесли срок — окончание сдвигается следом
_LINKED = {"due_at": ("ends_at",), "ends_at": ("due_at",)}


@dataclass
class Base:
    title: str
    due_at: datetime | None
    ends_at: datetime | None
    duration_minutes: int | None
    assignee_id: str | None
    participants: list[str]
    items: list[dict]


def _dump(field: str, value):
    if field in _DATES:
        return value.isoformat() if value else None
    return list(value) if isinstance(value, list) else value


def _load(field: str, value):
    if field in _DATES:
        return datetime.fromisoformat(value) if value else None
    return value


def remember(task: TaskRow, changes: dict, *, only_this: bool) -> None:
    """Вызвать до изменения дела. changes — какие поля меняются (значения не важны)."""
    if task.recurrence == "none":
        task.series_base = None
        return
    if {"recurrence", "repeat_days", "repeat_until", "repeat_forever"} & changes.keys():
        # Повтор настроили заново — серия начинается с дела как оно есть
        task.series_base = None
        return
    touched = {f for f in changes if f in FIELDS}
    for field in list(touched):
        touched.update(_LINKED.get(field, ()))
    if not touched:
        return
    base = dict(task.series_base or {})
    for field in touched:
        if only_this:
            # Первое отличие запоминаем: значение серии — до самой первой разовой правки
            base.setdefault(field, _dump(field, getattr(task, field)))
        else:
            base.pop(field, None)
    task.series_base = base or None


def base(task: TaskRow) -> Base:
    """Значения серии: из series_base, где их меняли только в этот раз, иначе — текущие."""
    saved = task.series_base or {}

    def get(field: str):
        return _load(field, saved[field]) if field in saved else getattr(task, field)

    return Base(
        title=get("title"),
        due_at=get("due_at"),
        ends_at=get("ends_at"),
        duration_minutes=get("duration_minutes"),
        assignee_id=get("assignee_id"),
        participants=list(get("participants") or []),
        items=list(get("items") or []),
    )
