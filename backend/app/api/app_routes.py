"""API мобильного веб-приложения: семья, участники, задачи, события."""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.auth import CurrentAccount, CurrentMember, DbSession, member_of
from app.models import FamilyRow, MemberRow, TaskRow
from app.schemas.api import (
    CreateFamilyRequest,
    CreateTaskRequest,
    DeclineRequest,
    DispatchRequest,
    FamilyOut,
    InviteInfo,
    JoinFamilyRequest,
    MemberOut,
    SessionOut,
    TaskOut,
    TrackRequest,
    UpdateMemberRequest,
    UpdateTaskRequest,
)
from app.services import family_service as fs
from app.services.task_extractor import TaskExtractor

router = APIRouter(prefix="/api/v1")

extractor = TaskExtractor()

_RECURRENCE_STEP = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1)}


def _require_no_family(db: DbSession, account: CurrentAccount) -> None:
    if member_of(db, account) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Вы уже состоите в семье")


def _session(member: MemberRow, token: str) -> SessionOut:
    return SessionOut(
        token=token, member=MemberOut.model_validate(member), family_id=member.family_id
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
def create_family(
    payload: CreateFamilyRequest, account: CurrentAccount, db: DbSession
) -> SessionOut:
    _require_no_family(db, account)
    family = FamilyRow(name=payload.family_name.strip())
    member = MemberRow(
        name=payload.member_name.strip(),
        has_car=payload.has_car,
        dislikes=[],
        account_id=account.id,
    )
    family.members.append(member)
    db.add(family)
    db.flush()
    fs.track(db, member, "family_created")
    db.commit()
    return _session(member, account.token)


@router.get("/invites/{code}", response_model=InviteInfo, tags=["family"])
def invite_info(code: str, db: DbSession) -> InviteInfo:
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    return InviteInfo(family_name=family.name, members=[m.name for m in family.members])


@router.post("/invites/{code}/join", response_model=SessionOut, status_code=201, tags=["family"])
def join_family(
    code: str, payload: JoinFamilyRequest, account: CurrentAccount, db: DbSession
) -> SessionOut:
    _require_no_family(db, account)
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    member = MemberRow(
        name=payload.member_name.strip(),
        role=payload.role,
        has_car=payload.has_car,
        capacity_minutes=300 if payload.role == "child" else 600,
        dislikes=[],
        account_id=account.id,
    )
    family.members.append(member)
    db.flush()
    fs.track(db, member, "family_joined")
    db.commit()
    return _session(member, account.token)


@router.get("/me", response_model=SessionOut, tags=["family"])
def me(member: CurrentMember, account: CurrentAccount) -> SessionOut:
    return _session(member, account.token)


@router.patch("/me", response_model=MemberOut, tags=["family"])
def update_me(payload: UpdateMemberRequest, member: CurrentMember, db: DbSession) -> MemberOut:
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(member, field, value)
    fs.track(db, member, "profile_updated")
    db.commit()
    return MemberOut.model_validate(member)


@router.get("/family", response_model=FamilyOut, tags=["family"])
def get_family(member: CurrentMember) -> FamilyOut:
    family = member.family
    return FamilyOut(
        id=family.id,
        name=family.name,
        invite_code=family.invite_code,
        members=[MemberOut.model_validate(m) for m in family.members],
    )


# ---------- Задачи: «поручила — сделано» ----------


@router.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
def list_tasks(
    member: CurrentMember,
    db: DbSession,
    include_done_days: Annotated[int, Query(ge=0, le=31)] = 1,
) -> list[TaskRow]:
    """Незакрытые задачи семьи плюс выполненные за последние N дней."""
    since = datetime.now() - timedelta(days=include_done_days)
    tasks = db.scalars(select(TaskRow).where(TaskRow.family_id == member.family_id)).all()
    visible = [t for t in tasks if t.status != "done" or (t.completed_at or since) >= since]
    return sorted(visible, key=lambda t: (t.status == "done", t.due_at or datetime.max))


@router.post("/tasks/dispatch", response_model=TaskOut, status_code=201, tags=["tasks"])
def dispatch(payload: DispatchRequest, member: CurrentMember, db: DbSession) -> TaskRow:
    """Главный сценарий: сообщение → задача с исполнителем и сроком → ждёт ответа."""
    draft = extractor.extract(payload.message, datetime.now())
    task = fs.task_from_draft(draft, member.family, member)
    task.source = payload.source
    assignee, why = fs.default_assignee(member.family, member, draft.requires_car)
    fs.assign(task, assignee, member, why)
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
    )
    if payload.assignee_id:
        assignee = next(m for m in member.family.members if m.id == payload.assignee_id)
        fs.assign(task, assignee, member, None)
    else:
        assignee, why = fs.default_assignee(member.family, member, payload.requires_car)
        fs.assign(task, assignee, member, why)
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
    fields = ",".join(sorted(changes))
    if "assignee_id" in changes:
        _check_member(member, changes["assignee_id"])
        new_id = changes.pop("assignee_id")
        assignee = next((m for m in member.family.members if m.id == new_id), None)
        # Новый исполнитель — поручение снова ждёт его ответа
        fs.assign(task, assignee, member, None)
    for field, value in changes.items():
        if field == "title" and value is None:
            continue
        setattr(task, field, value)
    if "due_at" in changes and task.due_at is not None:
        task.clarifying_question = None
    fs.track(db, member, "task_edited", fields=fields)
    db.commit()
    return task


def _require_assignee(task: TaskRow, member: MemberRow) -> None:
    if task.assignee_id != member.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Это поручение другому человеку")


@router.post("/tasks/{task_id}/accept", response_model=TaskOut, tags=["tasks"])
def accept_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    """Исполнитель отвечает «Взял» — автор видит, что задача принята."""
    task = _family_task(db, member, task_id)
    _require_assignee(task, member)
    if task.status == "new":
        task.status = "accepted"
        task.accepted_at = datetime.now()
        fs.track(db, member, "task_accepted")
        db.commit()
    return task


@router.post("/tasks/{task_id}/decline", response_model=TaskOut, tags=["tasks"])
def decline_task(
    task_id: str, payload: DeclineRequest, member: CurrentMember, db: DbSession
) -> TaskRow:
    """«Не могу»: задача возвращается автору без исполнителя, с причиной."""
    task = _family_task(db, member, task_id)
    _require_assignee(task, member)
    if task.status == "done":
        raise HTTPException(status.HTTP_409_CONFLICT, "Задача уже сделана")
    reason = (payload.reason or "").strip()
    task.assignee_id = None
    task.status = "new"
    task.accepted_at = None
    task.rationale = None
    task.decline_reason = f"{member.name} не может" + (f": {reason}" if reason else "")
    fs.track(db, member, "task_declined", with_reason=bool(reason))
    db.commit()
    return task


@router.post("/tasks/{task_id}/done", response_model=TaskOut, tags=["tasks"])
def complete_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    if task.status == "done":
        return task
    if task.assignee_id not in (None, member.id) and task.created_by_id != member.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Отметить может исполнитель или автор")
    now = datetime.now()
    if task.assignee_id is None:
        task.assignee_id = member.id
    task.status = "done"
    task.completed_at = now
    task.accepted_at = task.accepted_at or now

    step = _RECURRENCE_STEP.get(task.recurrence)
    if step and task.due_at:
        # Повторяющаяся задача: следующая — тому же исполнителю, снова ждёт ответа
        members = {m.id: m for m in member.family.members}
        next_task = TaskRow(
            family_id=task.family_id,
            created_by_id=task.created_by_id,
            title=task.title,
            source=task.source,
            beneficiary=task.beneficiary,
            due_at=task.due_at + step,
            duration_minutes=task.duration_minutes,
            priority=task.priority,
            recurrence=task.recurrence,
            requires_car=task.requires_car,
            location=task.location,
        )
        fs.assign(
            next_task,
            members.get(task.assignee_id),
            members[task.created_by_id],
            task.rationale,
        )
        db.add(next_task)

    fs.track(db, member, "task_done", own=task.assignee_id == member.id)
    db.commit()
    return task


@router.post("/tasks/{task_id}/reopen", response_model=TaskOut, tags=["tasks"])
def reopen_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    task.status = "accepted" if task.accepted_at else "new"
    task.completed_at = None
    fs.track(db, member, "task_reopened")
    db.commit()
    return task


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: str, member: CurrentMember, db: DbSession) -> None:
    task = _family_task(db, member, task_id)
    if task.created_by_id != member.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Удалить может только автор поручения")
    db.delete(task)
    fs.track(db, member, "task_deleted")
    db.commit()


# ---------- Аналитика ----------


@router.post("/events", status_code=204, tags=["analytics"])
def track_event(payload: TrackRequest, member: CurrentMember, db: DbSession) -> None:
    fs.track(db, member, payload.name, **payload.props)
    db.commit()
