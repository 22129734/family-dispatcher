"""API мобильного веб-приложения: семья, участники, задачи, события."""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import select

from app.auth import CurrentAccount, CurrentMember, CurrentToken, DbSession, member_of
from app.models import FamilyRow, MemberRow, PushSubscriptionRow, TaskRow
from app.schemas.api import (
    CreateFamilyRequest,
    CreateTaskRequest,
    DeclineRequest,
    DispatchRequest,
    FamilyOut,
    InviteInfo,
    ItemsRequest,
    JoinFamilyRequest,
    MemberOut,
    ReferralInfo,
    SessionOut,
    TaskOut,
    TrackRequest,
    UpdateMemberRequest,
    UpdateTaskRequest,
)
from app.services import family_service as fs
from app.services import notifications
from app.services.family_service import TaskActionError
from app.services.task_extractor import TaskExtractor

router = APIRouter(prefix="/api/v1")

extractor = TaskExtractor()


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


def _notify_assignee(background: BackgroundTasks, task: TaskRow, author: MemberRow) -> None:
    """Новое поручение другому человеку — push исполнителю."""
    if task.assignee_id and task.assignee_id != author.id and task.status == "new":
        background.add_task(
            notifications.deliver, task.assignee_id, notifications.new_task_message(task, author)
        )


def _notify_author(background: BackgroundTasks, task: TaskRow, who: MemberRow, kind: str) -> None:
    if task.created_by_id != who.id:
        background.add_task(
            notifications.deliver,
            task.created_by_id,
            notifications.answer_message(task, who, kind),
        )


# ---------- Семья и участники ----------


@router.post("/families", response_model=SessionOut, status_code=201, tags=["family"])
def create_family(
    payload: CreateFamilyRequest, account: CurrentAccount, token: CurrentToken, db: DbSession
) -> SessionOut:
    _require_no_family(db, account)
    # Название семьи не спрашиваем — семья у человека одна
    family = FamilyRow(name=(payload.family_name or "").strip() or "Моя семья")
    referrer = (
        db.scalar(select(FamilyRow).where(FamilyRow.ref_code == payload.ref))
        if payload.ref
        else None
    )
    family.referred_by_id = referrer.id if referrer else None
    member = MemberRow(
        name=payload.member_name.strip(),
        has_car=payload.has_car,
        dislikes=[],
        account_id=account.id,
    )
    family.members.append(member)
    db.add(family)
    db.flush()
    fs.track(db, member, "family_created", from_ref=bool(referrer))
    db.commit()
    return _session(member, token)


@router.get("/referrals/{code}", response_model=ReferralInfo, tags=["family"])
def referral_info(code: str, db: DbSession) -> ReferralInfo:
    """Публично: кто рекомендует приложение — для строки «Вам рекомендует Аня»."""
    family = db.scalar(select(FamilyRow).where(FamilyRow.ref_code == code))
    if family is None or not family.members:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ссылка не найдена")
    return ReferralInfo(from_name=family.members[0].name)


@router.get("/invites/{code}", response_model=InviteInfo, tags=["family"])
def invite_info(code: str, db: DbSession) -> InviteInfo:
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    return InviteInfo(family_name=family.name, members=[m.name for m in family.members])


@router.post("/invites/{code}/join", response_model=SessionOut, status_code=201, tags=["family"])
def join_family(
    code: str,
    payload: JoinFamilyRequest,
    account: CurrentAccount,
    token: CurrentToken,
    db: DbSession,
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
    return _session(member, token)


@router.get("/me", response_model=SessionOut, tags=["family"])
def me(member: CurrentMember, token: CurrentToken) -> SessionOut:
    return _session(member, token)


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
    ids = [m.id for m in family.members]
    with_push = set(
        db.scalars(
            select(PushSubscriptionRow.member_id).where(PushSubscriptionRow.member_id.in_(ids))
        )
    )
    return FamilyOut(
        id=family.id,
        name=family.name,
        invite_code=family.invite_code,
        ref_code=family.ref_code,
        members=[
            MemberOut.model_validate(m).model_copy(update={"notifications": m.id in with_push})
            for m in family.members
        ],
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
def dispatch(
    payload: DispatchRequest, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
    """Главный сценарий: сообщение → задача с исполнителем и сроком → ждёт ответа."""
    others = [m.name for m in member.family.members if m.id != member.id]
    draft = extractor.extract(payload.message, datetime.now(), member.name, others)
    task = fs.task_from_draft(draft, member.family, member)
    task.source = payload.source
    assignee, why = fs.assignee_for(member.family, member, draft)
    fs.assign(task, assignee, member, why)
    db.add(task)
    db.flush()
    fs.track(db, member, "task_dispatched", source=payload.source, assigned=bool(task.assignee_id))
    db.commit()
    _notify_assignee(background, task, member)
    return task


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(
    payload: CreateTaskRequest, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
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
    _notify_assignee(background, task, member)
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def update_task(
    task_id: str,
    payload: UpdateTaskRequest,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
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
        if field == "recurrence":
            value = str(value or "none")
        setattr(task, field, value)
    if "due_at" in changes or "assignee_id" in payload.model_dump(exclude_unset=True):
        # Новый срок или исполнитель — напоминание отправится заново
        task.reminded_at = None
        task.remembered_at = None
    if "due_at" in changes and task.due_at is not None:
        task.clarifying_question = None
    fs.track(db, member, "task_edited", fields=fields)
    db.commit()
    if "assignee_id" in payload.model_dump(exclude_unset=True):
        _notify_assignee(background, task, member)
    return task


@router.post("/tasks/{task_id}/accept", response_model=TaskOut, tags=["tasks"])
def accept_task(
    task_id: str, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
    """Исполнитель отвечает «Беру» — автор видит, что задача принята."""
    task = _family_task(db, member, task_id)
    try:
        changed = fs.accept(task, member)
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if changed:
        fs.track(db, member, "task_accepted")
        db.commit()
        _notify_author(background, task, member, "accepted")
    return task


@router.post("/tasks/{task_id}/decline", response_model=TaskOut, tags=["tasks"])
def decline_task(
    task_id: str,
    payload: DeclineRequest,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
) -> TaskRow:
    """«Не могу»: задача возвращается автору без исполнителя, с причиной."""
    task = _family_task(db, member, task_id)
    try:
        fs.decline(task, member, payload.reason)
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    fs.track(db, member, "task_declined", with_reason=bool((payload.reason or "").strip()))
    db.commit()
    _notify_author(background, task, member, "declined")
    return task


@router.post("/tasks/{task_id}/done", response_model=TaskOut, tags=["tasks"])
def complete_task(
    task_id: str, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
    task = _family_task(db, member, task_id)
    try:
        changed = fs.complete(db, task, member)
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if changed:
        fs.track(db, member, "task_done", own=task.assignee_id == member.id)
        db.commit()
        _notify_author(background, task, member, "done")
    return task


@router.post("/tasks/{task_id}/reopen", response_model=TaskOut, tags=["tasks"])
def reopen_task(task_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    task.status = "accepted" if task.accepted_at else "new"
    task.completed_at = None
    fs.track(db, member, "task_reopened")
    db.commit()
    return task


@router.put("/tasks/{task_id}/items", response_model=TaskOut, tags=["tasks"])
def set_items(task_id: str, payload: ItemsRequest, member: CurrentMember, db: DbSession) -> TaskRow:
    """Список покупок: отметить купленное, добавить или убрать пункт. Доступен всей семье."""
    task = _family_task(db, member, task_id)
    before = {item["text"]: item.get("done", False) for item in task.items or []}
    task.items = [item.model_dump() for item in payload.items]
    checked = sum(1 for item in payload.items if item.done and not before.get(item.text, False))
    fs.track(db, member, "task_items_updated", count=len(payload.items), checked=checked)
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
