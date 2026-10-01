"""Связка хранилища с доменным ядром.

Движок распределения работает со схемой `Family`, в которой у каждого участника
есть `weekly_load_minutes`. Здесь эта нагрузка считается из реальных задач недели,
поэтому индекс невидимого труда и справедливость назначений опираются на факты.
"""

from datetime import datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EventRow, FamilyRow, MemberRow, TaskRow
from app.schemas.family import Family, Member
from app.schemas.task import Assignment, TaskDraft
from app.services.allocator import Allocator, NoEligibleMemberError


def week_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = datetime.combine((now - timedelta(days=now.weekday())).date(), time.min)
    return start, start + timedelta(days=7)


def _task_moment(task: TaskRow) -> datetime:
    return task.due_at or task.completed_at or task.created_at


def weekly_tasks(db: Session, family_id: str, now: datetime) -> list[TaskRow]:
    start, end = week_bounds(now)
    tasks = db.scalars(select(TaskRow).where(TaskRow.family_id == family_id)).all()
    return [t for t in tasks if start <= _task_moment(t) < end]


def weekly_load(db: Session, family: FamilyRow, now: datetime) -> dict[str, int]:
    load = {m.id: 0 for m in family.members}
    for task in weekly_tasks(db, family.id, now):
        if task.assignee_id in load:
            load[task.assignee_id] += task.duration_minutes
    return load


def to_domain(db: Session, family: FamilyRow, now: datetime) -> Family:
    load = weekly_load(db, family, now)
    return Family(
        id=family.id,
        members=[
            Member(
                id=m.id,
                name=m.name,
                weekly_load_minutes=load[m.id],
                capacity_minutes=m.capacity_minutes,
                has_car=m.has_car,
                dislikes=m.dislikes or [],
            )
            for m in family.members
        ],
    )


def allocate(
    db: Session,
    allocator: Allocator,
    family: FamilyRow,
    draft: TaskDraft,
    now: datetime,
    exclude: set[str] | None = None,
) -> Assignment | None:
    """Назначить исполнителя; None — если свободных нет и задача остаётся без исполнителя."""
    domain = to_domain(db, family, now)
    if exclude:
        domain.members = [m for m in domain.members if m.id not in exclude]
    if not domain.members:
        return None
    try:
        return allocator.allocate(domain, draft)
    except NoEligibleMemberError:
        return None


def apply_assignment(task: TaskRow, assignment: Assignment | None) -> None:
    if assignment is None:
        task.assignee_id = None
        task.fairness_score = None
        task.rationale = "Сейчас никто не свободен — выберите исполнителя вручную или перенесите"
        return
    task.assignee_id = assignment.assignee_id
    task.fairness_score = assignment.fairness_score
    task.rationale = assignment.rationale


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
        vetoed_by=[],
    )


def draft_from_task(task: TaskRow) -> TaskDraft:
    return TaskDraft(
        title=task.title,
        beneficiary=task.beneficiary,
        due_at=task.due_at,
        duration_minutes=task.duration_minutes or 30,
        priority=task.priority or "normal",
        recurrence=task.recurrence or "none",
        requires_car=bool(task.requires_car),
        location=task.location,
    )


def track(db: Session, member: MemberRow, name: str, **props: object) -> None:
    db.add(EventRow(member_id=member.id, family_id=member.family_id, name=name, props=props))
