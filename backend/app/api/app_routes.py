"""API мобильного веб-приложения: семья, участники, задачи, события."""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.auth import CurrentMember, DbSession
from app.models import FamilyRow, MemberRow, TaskRow
from app.schemas.api import (
    CreateFamilyRequest,
    CreateTaskRequest,
    DispatchRequest,
    FamilyOut,
    InviteInfo,
    JoinFamilyRequest,
    LabourShare,
    MemberOut,
    SessionOut,
    TaskOut,
    TrackRequest,
    UpdateMemberRequest,
    UpdateTaskRequest,
)
from app.services import family_service as fs
from app.services.allocator import Allocator
from app.services.task_extractor import TaskExtractor

router = APIRouter(prefix="/api/v1")

extractor = TaskExtractor()
allocator = Allocator()

_RECURRENCE_STEP = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1)}


def _session(member: MemberRow) -> SessionOut:
    return SessionOut(
        token=member.token, member=MemberOut.model_validate(member), family_id=member.family_id
    )


def _family_task(db: DbSession, member: MemberRow, task_id: str) -> TaskRow:
    task = db.get(TaskRow, task_id)
    if task is None or task.family_id != member.family_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задача не найдена")
    return task


def _check_member(member: MemberRow, member_id: str | None) -> None:
    if member_id is not None and member_id not in {m.id for m in member.family.members}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Такого участника нет в семье")


# ---------- Семья и участники ----------


@router.post("/families", response_model=SessionOut, status_code=201, tags=["family"])
def create_family(payload: CreateFamilyRequest, db: DbSession) -> SessionOut:
    family = FamilyRow(name=payload.family_name.strip())
    member = MemberRow(name=payload.member_name.strip(), has_car=payload.has_car, dislikes=[])
    family.members.append(member)
    db.add(family)
    db.flush()
    fs.track(db, member, "family_created")
    db.commit()
    return _session(member)


@router.get("/invites/{code}", response_model=InviteInfo, tags=["family"])
def invite_info(code: str, db: DbSession) -> InviteInfo:
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    return InviteInfo(family_name=family.name, members=[m.name for m in family.members])


@router.post("/invites/{code}/join", response_model=SessionOut, status_code=201, tags=["family"])
def join_family(code: str, payload: JoinFamilyRequest, db: DbSession) -> SessionOut:
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    member = MemberRow(
        name=payload.member_name.strip(),
        role=payload.role,
        has_car=payload.has_car,
        capacity_minutes=300 if payload.role == "child" else 600,
        dislikes=[],
    )
    family.members.append(member)
    db.flush()
    fs.track(db, member, "family_joined")
    db.commit()
    return _session(member)


@router.get("/me", response_model=SessionOut, tags=["family"])
def me(member: CurrentMember) -> SessionOut:
    return _session(member)


@router.patch("/me", response_model=MemberOut, tags=["family"])
def update_me(payload: UpdateMemberRequest, member: CurrentMember, db: DbSession) -> MemberOut:
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(member, field, value)
    fs.track(db, member, "profile_updated")
    db.commit()
    return MemberOut.model_validate(member)


@router.get("/family", response_model=FamilyOut, tags=["family"])
def get_family(member: CurrentMember, db: DbSession) -> FamilyOut:
    family = member.family
    now = datetime.now()
    tasks = fs.weekly_tasks(db, family.id, now)
    minutes: dict[str, int] = defaultdict(int)
    open_count: dict[str, int] = defaultdict(int)
    done_count: dict[str, int] = defaultdict(int)
    for task in tasks:
        if task.assignee_id is None:
            continue
        minutes[task.assignee_id] += task.duration_minutes
        if task.status == "done":
            done_count[task.assignee_id] += 1
        else:
            open_count[task.assignee_id] += 1
    total = sum(minutes.values())
    return FamilyOut(
        id=family.id,
        name=family.name,
        invite_code=family.invite_code,
        members=[MemberOut.model_validate(m) for m in family.members],
        labour=[
            LabourShare(
                member_id=m.id,
                name=m.name,
                minutes=minutes[m.id],
                share=round(minutes[m.id] / total, 3) if total else 0.0,
                open_tasks=open_count[m.id],
                done_tasks=done_count[m.id],
            )
            for m in family.members
        ],
    )


# ---------- Задачи ----------


@router.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
def list_tasks(
    member: CurrentMember,
    db: DbSession,
    include_done_days: Annotated[int, Query(ge=0, le=31)] = 1,
) -> list[TaskRow]:
    """Открытые задачи семьи плюс выполненные за последние N дней."""
    since = datetime.now() - timedelta(days=include_done_days)
    tasks = db.scalars(select(TaskRow).where(TaskRow.family_id == member.family_id)).all()
    visible = [t for t in tasks if t.status == "open" or (t.completed_at or since) >= since]
    return sorted(visible, key=lambda t: (t.status == "done", t.due_at or datetime.max))


@router.post("/tasks/dispatch", response_model=TaskOut, status_code=201, tags=["tasks"])
def dispatch(payload: DispatchRequest, member: CurrentMember, db: DbSession) -> TaskRow:
    """Главный сценарий: сообщение → задача → исполнитель."""
    now = datetime.now()
    draft = extractor.extract(payload.message, now)
    task = fs.task_from_draft(draft, member.family, member)
    task.source = payload.source
    fs.apply_assignment(task, fs.allocate(db, allocator, member.family, draft, now))
    db.add(task)
    db.flush()
    fs.track(db, member, "task_dispatched", source=payload.source, assigned=bool(task.assignee_id))
    db.commit()
    return task


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(payload: CreateTaskRequest, member: CurrentMember, db: DbSession) -> TaskRow:
    _check_member(member, payload.assignee_id)
    task = TaskRow(
        family_id=member.family_id,
        created_by_id=member.id,
        title=payload.title.strip(),
        source="manual",
        due_at=payload.due_at,
        duration_minutes=payload.duration_minutes,
        requires_car=payload.requires_car,
        vetoed_by=[],
    )
    if payload.assignee_id:
        task.assignee_id = payload.assignee_id
        task.rationale = "Назначено вручную"
    else:
        draft = fs.draft_from_task(task)
        fs.apply_assignment(task, fs.allocate(db, allocator, member.family, draft, datetime.now()))
    db.add(task)
    db.flush()
    fs.track(db, member, "task_created", source="manual")
    db.commit()
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def update_task(
    task_id: str, payload: UpdateTaskRequest, member: CurrentMember, db: DbSession
) -> TaskRow:
    task = _family_task(db, member, task_id)
    changes = payload.model_dump(exclude_unset=True)
    if "assignee_id" in changes:
        _check_member(member, changes["assignee_id"])
        task.rationale = "Назначено вручную"
    for field, value in changes.items():
        if field == "title" and value is None:
            continue
        setattr(task, field, value)
    if "due_at" in changes and task.due_at is not None:
        task.clarifying_question = None
    fs.track(db, member, "task_edited", fields=",".join(sorted(changes)))
    db.commit()
    return task


@router.post("/tasks/{task_id}/done", response_model=TaskOut, tags=["tasks"])
def complete_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    if task.status == "done":
        return task
    now = datetime.now()
    task.status = "done"
    task.completed_at = now
    if task.assignee_id is None:
        task.assignee_id = member.id

    step = _RECURRENCE_STEP.get(task.recurrence)
    if step and task.due_at:
        # Повторяющаяся задача: сразу ставим следующую и распределяем заново.
        draft = fs.draft_from_task(task)
        draft.due_at = task.due_at + step
        next_task = fs.task_from_draft(draft, member.family, member)
        next_task.source = task.source
        db.flush()
        fs.apply_assignment(next_task, fs.allocate(db, allocator, member.family, draft, now))
        db.add(next_task)

    fs.track(db, member, "task_done", own=task.assignee_id == member.id)
    db.commit()
    return task


@router.post("/tasks/{task_id}/reopen", response_model=TaskOut, tags=["tasks"])
def reopen_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    task.status = "open"
    task.completed_at = None
    fs.track(db, member, "task_reopened")
    db.commit()
    return task


@router.post("/tasks/{task_id}/reassign", response_model=TaskOut, tags=["tasks"])
def reassign_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    """Вето в один тап: система сама ищет следующего подходящего исполнителя."""
    task = _family_task(db, member, task_id)
    vetoed = set(task.vetoed_by or [])
    if task.assignee_id:
        vetoed.add(task.assignee_id)
    task.vetoed_by = sorted(vetoed)
    assignment = fs.allocate(
        db, allocator, member.family, fs.draft_from_task(task), datetime.now(), exclude=vetoed
    )
    fs.apply_assignment(task, assignment)
    if assignment is not None:
        # Причину решения движка здесь не показываем: реальная причина — отказ предыдущего.
        new_assignee = next(m for m in member.family.members if m.id == assignment.assignee_id)
        task.rationale = f"Передано: {new_assignee.name} свободнее тех, кто не смог взять задачу"
    fs.track(db, member, "task_reassigned", found=assignment is not None)
    db.commit()
    return task


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: str, member: CurrentMember, db: DbSession) -> None:
    task = _family_task(db, member, task_id)
    db.delete(task)
    fs.track(db, member, "task_deleted")
    db.commit()


# ---------- Аналитика ----------


@router.post("/events", status_code=204, tags=["analytics"])
def track_event(payload: TrackRequest, member: CurrentMember, db: DbSession) -> None:
    fs.track(db, member, payload.name, **payload.props)
    db.commit()
