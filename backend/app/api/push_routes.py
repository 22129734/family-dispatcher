"""Push-подписки и действия по ссылке из уведомления (без входа)."""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sqlalchemy import func, select

from app.auth import CurrentMember, DbSession
from app.config import get_settings
from app.models import MemberRow, PushSubscriptionRow, TaskRow
from app.schemas.api import (
    ActInfoOut,
    ActRequest,
    PushStatusOut,
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    TaskOut,
)
from app.services import family_service as fs
from app.services import notifications, telemetry
from app.services.family_service import TaskActionError

router = APIRouter(prefix="/api/v1", tags=["push"])


@router.get("/push/status", response_model=PushStatusOut)
def push_status(member: CurrentMember, db: DbSession) -> PushStatusOut:
    devices = db.scalar(select(func.count()).where(PushSubscriptionRow.member_id == member.id))
    return PushStatusOut(
        enabled=notifications.push_enabled(),
        public_key=get_settings().vapid_public_key or None,
        devices=devices or 0,
    )


@router.post("/push/subscribe", status_code=204)
def subscribe(
    payload: PushSubscribeRequest, request: Request, member: CurrentMember, db: DbSession
) -> None:
    sub = db.scalar(
        select(PushSubscriptionRow).where(PushSubscriptionRow.endpoint == payload.endpoint)
    )
    if sub is None:
        sub = PushSubscriptionRow(endpoint=payload.endpoint)
        db.add(sub)
    # Устройство могло перейти к другому человеку — подписка принадлежит тому, кто вошёл
    sub.member_id = member.id
    sub.p256dh = payload.keys.p256dh
    sub.auth = payload.keys.auth
    sub.user_agent = (request.headers.get("user-agent") or "")[:300]
    sub.failures = 0
    fs.track(db, member, "push_subscribed")
    db.commit()


@router.post("/push/unsubscribe", status_code=204)
def unsubscribe(payload: PushUnsubscribeRequest, member: CurrentMember, db: DbSession) -> None:
    sub = db.scalar(
        select(PushSubscriptionRow).where(
            PushSubscriptionRow.endpoint == payload.endpoint,
            PushSubscriptionRow.member_id == member.id,
        )
    )
    if sub is not None:
        db.delete(sub)
        fs.track(db, member, "push_unsubscribed")
        db.commit()


# ---------- Действия по ссылке из уведомления ----------


def _resolve(db: DbSession, token: str) -> tuple[TaskRow, MemberRow]:
    parsed = notifications.read_action_token(token) if notifications.push_enabled() else None
    if parsed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ссылка устарела — откройте приложение")
    task = db.get(TaskRow, parsed[0])
    member = db.get(MemberRow, parsed[1])
    if task is None or member is None or task.family_id != member.family_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задача не найдена")
    telemetry.set_actor(member.id, member.family_id)
    return task, member


def _info(task: TaskRow, member: MemberRow) -> ActInfoOut:
    people = {m.id: m.name for m in member.family.members}
    mine = task.assignee_id == member.id
    return ActInfoOut(
        task=TaskOut.model_validate(task),
        member_name=member.name,
        author_name=people.get(task.created_by_id, ""),
        assignee_name=people.get(task.assignee_id) if task.assignee_id else None,
        can_accept=mine and task.status == "new",
        can_decline=mine and task.status != "done",
        can_done=task.status != "done"
        and (mine or task.created_by_id == member.id or task.assignee_id is None),
    )


@router.get("/act/{token}", response_model=ActInfoOut)
def act_info(token: str, db: DbSession) -> ActInfoOut:
    task, member = _resolve(db, token)
    fs.track(db, member, "push_opened")
    db.commit()
    return _info(task, member)


@router.post("/act/{token}/{action}", response_model=ActInfoOut)
def act(
    token: str,
    action: Literal["accept", "decline", "done"],
    background: BackgroundTasks,
    db: DbSession,
    payload: ActRequest | None = None,
) -> ActInfoOut:
    """Кнопки «Беру» / «Не могу» / «Сделано» из уведомления или со страницы задачи."""
    task, member = _resolve(db, token)
    author_id = task.created_by_id
    try:
        if action == "accept":
            changed = fs.accept(task, member)
            kind = "accepted"
        elif action == "decline":
            fs.decline(task, member, payload.reason if payload else None)
            changed, kind = True, "declined"
        else:
            changed = fs.complete(db, task, member)
            kind = "done"
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if changed:
        fs.track(db, member, f"task_{'accepted' if kind == 'accepted' else kind}", via="push")
        if author_id != member.id:
            background.add_task(
                notifications.deliver, author_id, notifications.answer_message(task, member, kind)
            )
    db.commit()
    return _info(task, member)
