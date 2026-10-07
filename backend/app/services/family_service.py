"""Задачи семьи: кому поручить по умолчанию, ответы исполнителя, события.

Исходная гипотеза о несправедливом распределении дел интервью не подтвердили
(0 из 20), поэтому движка «справедливого» распределения больше нет. Поручение
по умолчанию уходит второму взрослому — так задачи передают организаторы из
интервью; исполнителя можно сменить одним нажатием.

Ответы исполнителя («Беру», «Не могу», «Сделано») вызываются и из приложения,
и из кнопок push-уведомления, поэтому живут здесь, а не в роутерах.
"""

from datetime import datetime

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from app.models import EventRow, FamilyRow, MemberRow, TaskRow
from app.schemas.task import TaskDraft

# Кто может брать поручения: взрослые и подростки
_DOERS = {"adult", "teen"}
_RECURRENCE_STEP = {
    "daily": relativedelta(days=1),
    "weekdays": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
}
# Повтор без срока: следующий раз — в 18:00
_DEFAULT_HOUR = 18


def next_due(due_at: datetime | None, recurrence: str, now: datetime) -> datetime | None:
    """Срок следующего повтора: шагаем от прежнего срока, пока не окажемся в будущем."""
    step = _RECURRENCE_STEP.get(recurrence)
    if step is None:
        return None
    due = due_at or now.replace(hour=_DEFAULT_HOUR, minute=0, second=0, microsecond=0)
    due += step
    while due <= now or (recurrence == "weekdays" and due.weekday() >= 5):
        due += step if recurrence != "weekdays" else relativedelta(days=1)
    return due


class TaskActionError(Exception):
    """Действие недоступно: (код HTTP, сообщение)."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


def default_assignee(
    family: FamilyRow, author: MemberRow, requires_car: bool = False
) -> tuple[MemberRow | None, str | None]:
    """Исполнитель по умолчанию и короткое пояснение; (None, None) — пусть выберет автор."""
    others = [m for m in family.members if m.id != author.id and m.role in _DOERS]
    if not others:
        return author, "Пока в семье только вы — пригласите близких во вкладке «Семья»"
    if requires_car:
        drivers = [m for m in others if m.has_car]
        if len(drivers) == 1:
            return drivers[0], "Есть машина"
    adults = [m for m in others if m.role == "adult"]
    if len(adults) == 1:
        return adults[0], None
    return None, None


def assignee_for(
    family: FamilyRow, author: MemberRow, draft: TaskDraft
) -> tuple[MemberRow | None, str | None]:
    """Кому поручить: явно сказанное в сообщении важнее правила «второму взрослому»."""
    if draft.assignee == "self":
        return author, None
    if draft.assignee:
        wanted = draft.assignee.strip().lower()
        for member in family.members:
            if member.name.strip().lower() == wanted:
                return member, None
    return default_assignee(family, author, draft.requires_car)


def task_from_draft(draft: TaskDraft, family: FamilyRow, author: MemberRow) -> TaskRow:
    return TaskRow(
        family_id=family.id,
        created_by_id=author.id,
        title=draft.title,
        beneficiary=draft.beneficiary,
        due_at=draft.due_at,
        duration_minutes=draft.duration_minutes,
        priority=draft.priority.value,
        recurrence=draft.recurrence.value,
        requires_car=draft.requires_car,
        location=draft.location,
        clarifying_question=draft.clarifying_question,
    )


def assign(task: TaskRow, assignee: MemberRow | None, author: MemberRow, why: str | None) -> None:
    """Назначить исполнителя: поручение себе сразу «взято», остальным — ждёт ответа."""
    task.assignee_id = assignee.id if assignee else None
    task.rationale = why
    task.decline_reason = None
    if assignee is not None and assignee.id == author.id:
        task.status = "accepted"
    else:
        task.status = "new"
        task.accepted_at = None


def accept(task: TaskRow, member: MemberRow) -> bool:
    """«Беру». True — статус изменился (нужно уведомить автора)."""
    if task.assignee_id != member.id:
        raise TaskActionError(403, "Это поручение другому человеку")
    if task.status != "new":
        return False
    task.status = "accepted"
    task.accepted_at = datetime.now()
    return True


def decline(task: TaskRow, member: MemberRow, reason: str | None) -> None:
    """«Не могу»: задача возвращается автору без исполнителя, с причиной."""
    if task.assignee_id != member.id:
        raise TaskActionError(403, "Это поручение другому человеку")
    if task.status == "done":
        raise TaskActionError(409, "Задача уже сделана")
    reason = (reason or "").strip()
    task.assignee_id = None
    task.status = "new"
    task.accepted_at = None
    task.rationale = None
    task.decline_reason = f"{member.name} не может" + (f": {reason}" if reason else "")


def complete(db: Session, task: TaskRow, member: MemberRow) -> bool:
    """«Сделано». True — статус изменился. Повторяющаяся задача порождает следующую."""
    if task.status == "done":
        return False
    if task.assignee_id not in (None, member.id) and task.created_by_id != member.id:
        raise TaskActionError(403, "Отметить может исполнитель или автор")
    now = datetime.now()
    if task.assignee_id is None:
        task.assignee_id = member.id
    task.status = "done"
    task.completed_at = now
    task.accepted_at = task.accepted_at or now

    due = next_due(task.due_at, task.recurrence, now)
    if due is not None:
        # Следующая — тому же исполнителю, снова ждёт ответа
        members = {m.id: m for m in member.family.members}
        next_task = TaskRow(
            family_id=task.family_id,
            created_by_id=task.created_by_id,
            title=task.title,
            source=task.source,
            beneficiary=task.beneficiary,
            due_at=due,
            duration_minutes=task.duration_minutes,
            priority=task.priority,
            recurrence=task.recurrence,
            requires_car=task.requires_car,
            location=task.location,
        )
        assign(
            next_task, members.get(task.assignee_id), members[task.created_by_id], task.rationale
        )
        db.add(next_task)
    return True


def track(db: Session, member: MemberRow, name: str, **props: object) -> None:
    db.add(EventRow(member_id=member.id, family_id=member.family_id, name=name, props=props))
