"""Задачи семьи: кому поручить по умолчанию, перевод разбора в задачу, события.

Исходная гипотеза о несправедливом распределении дел интервью не подтвердили
(0 из 20), поэтому движка «справедливого» распределения больше нет. Поручение
по умолчанию уходит второму взрослому — так задачи передают организаторы из
интервью; исполнителя можно сменить одним нажатием.
"""

from app.models import EventRow, FamilyRow, MemberRow, TaskRow
from app.schemas.task import TaskDraft

# Кто может брать поручения: взрослые и подростки
_DOERS = {"adult", "teen"}


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


def track(db, member: MemberRow, name: str, **props: object) -> None:
    db.add(EventRow(member_id=member.id, family_id=member.family_id, name=name, props=props))
