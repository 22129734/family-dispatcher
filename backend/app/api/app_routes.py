"""API мобильного веб-приложения: семья, участники, задачи, события."""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.auth import CurrentAccount, CurrentMember, CurrentToken, DbSession, member_of
from app.models import (
    AccountRow,
    EventRow,
    FamilyRow,
    MemberRow,
    PhoneInviteRow,
    PushSubscriptionRow,
    TaskCommentRow,
    TaskFileRow,
    TaskRow,
)
from app.schemas.api import (
    BatchCreateRequest,
    BatchItemOut,
    CommentOut,
    CommentRequest,
    CreateFamilyRequest,
    CreateTaskRequest,
    DeclineRequest,
    DispatchRequest,
    DraftOut,
    FamilyOut,
    FrequentOut,
    InviteInfo,
    ItemsRequest,
    JoinFamilyRequest,
    MemberOut,
    PhoneInviteOut,
    PhoneInviteRequest,
    ReferralInfo,
    ReferralSmsOut,
    ReferralSmsRequest,
    RejectRequest,
    SessionOut,
    TaskOut,
    TrackRequest,
    UpdateMemberRequest,
    UpdateTaskRequest,
    WeekOut,
)
from app.services import family_service as fs
from app.services import (
    files,
    metrics,
    multi_tasks,
    notifications,
    phone_auth,
    repeat,
    shopping,
    sms,
)
from app.services.family_service import TaskActionError
from app.services.llm_client import LLMClient
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


def _notify_participants(
    background: BackgroundTasks, task: TaskRow, author: MemberRow, ids: list[str]
) -> None:
    """Совместное дело: участникам — «вы участвуете», отвечать не нужно."""
    for member_id in ids:
        if member_id != author.id:
            background.add_task(
                notifications.deliver, member_id, notifications.participant_message(task, author)
            )


def _notify_edit(
    background: BackgroundTasks, task: TaskRow, editor: MemberRow, changes: list[str]
) -> None:
    """Дело поменяли — второму из пары «автор — исполнитель». Своё себе — без уведомлений."""
    if not changes or task.status == "done" or task.created_by_id == task.assignee_id:
        return
    message = notifications.edit_message(task, editor, changes)
    for member_id in {task.created_by_id, task.assignee_id} - {editor.id, None}:
        background.add_task(notifications.deliver, member_id, message)


def _describe_changes(task: TaskRow, changes: dict) -> list[str]:
    """Что поменялось — коротко, для текста уведомления."""
    parts: list[str] = []
    if "title" in changes and changes["title"]:
        parts.append("новое название")
    if "due_at" in changes or "ends_at" in changes:
        parts.append(notifications.describe_when(task.due_at))
    if "note" in changes:
        note = " ".join((task.note or "").split())
        parts.append(
            f"заметка: {note[:80]}{'…' if len(note) > 80 else ''}" if note else "заметка убрана"
        )
    if {"recurrence", "repeat_days", "repeat_until", "repeat_forever"} & changes.keys():
        parts.append("повтор изменён")
    if "participants" in changes:
        parts.append("участники изменены")
    if "priority" in changes:
        parts.append("срочно" if task.priority == "high" else "уже не срочно")
    return parts


def _group_later(background: BackgroundTasks, task: TaskRow) -> None:
    """Пункты, которые словарь не разложил по отделам, — модели, в фоне."""
    if shopping.needs_llm(task.items or []):
        background.add_task(shopping.fill_groups, task.id)


def _clean_participants(member: MemberRow, ids: list[str], assignee_id: str | None) -> list[str]:
    """Только члены этой семьи, без исполнителя и повторов."""
    family_ids = {m.id for m in member.family.members}
    clean: list[str] = []
    for member_id in ids:
        if member_id not in family_ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Участник не из вашей семьи")
        if member_id != assignee_id and member_id not in clean:
            clean.append(member_id)
    return clean


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
    return InviteInfo(
        family_id=family.id, family_name=family.name, members=[m.name for m in family.members]
    )


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
    _accept_phone_invites(db, account.phone, family.id)
    db.commit()
    return _session(member, token)


SMS_PER_FAMILY_DAY = 5
# Рекомендации по СМС платные для нас — не больше трёх в сутки с одного аккаунта
REFERRAL_SMS_PER_DAY = 3


@router.post("/referrals/sms", response_model=ReferralSmsOut, tags=["family"])
def recommend_by_sms(
    payload: ReferralSmsRequest, member: CurrentMember, db: DbSession
) -> ReferralSmsOut:
    """Посоветовать приложение знакомому: СМС со ссылкой-рекомендацией этой семьи."""
    try:
        phone = phone_auth.normalize_phone(payload.phone)
    except phone_auth.PhoneAuthError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    day_ago = datetime.now() - timedelta(days=1)
    sent = db.scalar(
        select(func.count()).where(
            EventRow.member_id == member.id,
            EventRow.name == "referral_sms",
            EventRow.created_at > day_ago,
        )
    )
    if sent >= REFERRAL_SMS_PER_DAY:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Можно отправить {REFERRAL_SMS_PER_DAY} СМС-рекомендации в сутки — попробуйте завтра "
            "или поделитесь ссылкой",
        )
    if db.scalar(select(AccountRow).where(AccountRow.phone == phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот человек уже пользуется приложением")
    try:
        sms.send(phone, sms.referral_text(member.name, member.family.ref_code))
    except sms.SmsError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    fs.track(db, member, "referral_sms")
    db.commit()
    return ReferralSmsOut(
        phone_masked=phone_auth.mask_phone(phone), left_today=REFERRAL_SMS_PER_DAY - sent - 1
    )


@router.post(
    "/family/phone-invites", response_model=PhoneInviteOut, status_code=201, tags=["family"]
)
def invite_by_phone(
    payload: PhoneInviteRequest, member: CurrentMember, db: DbSession
) -> PhoneInviteOut:
    """Пригласить по номеру: войдёт с ним — попадёт в семью. По желанию — СМС со ссылкой."""
    try:
        phone = phone_auth.normalize_phone(payload.phone)
    except phone_auth.PhoneAuthError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if any(m.account and m.account.phone == phone for m in member.family.members):
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот человек уже в вашей семье")
    invite = db.scalar(
        select(PhoneInviteRow).where(
            PhoneInviteRow.family_id == member.family_id,
            PhoneInviteRow.phone == phone,
            PhoneInviteRow.accepted_at.is_(None),
        )
    )
    if invite is None:
        invite = PhoneInviteRow(family_id=member.family_id, invited_by_id=member.id, phone=phone)
        db.add(invite)
    now = datetime.now()
    if payload.send_sms:
        day_ago = now - timedelta(days=1)
        if invite.sms_sent_at and invite.sms_sent_at > day_ago:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "СМС на этот номер уже отправлено сегодня"
            )
        sent_today = db.scalar(
            select(func.count()).where(
                PhoneInviteRow.family_id == member.family_id, PhoneInviteRow.sms_sent_at > day_ago
            )
        )
        if sent_today >= SMS_PER_FAMILY_DAY:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Сегодня отправлено много СМС — попробуйте завтра",
            )
        try:
            sms.send(phone, sms.invite_text(member.name, member.family.invite_code))
        except sms.SmsError as exc:
            db.commit()  # приглашение по номеру работает и без СМС
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
        invite.sms_sent_at = now
    fs.track(db, member, "invite_phone", sms=payload.send_sms)
    db.commit()
    return _phone_invite_out(invite)


@router.get("/family/phone-invites", response_model=list[PhoneInviteOut], tags=["family"])
def phone_invites(member: CurrentMember, db: DbSession) -> list[PhoneInviteOut]:
    rows = db.scalars(
        select(PhoneInviteRow)
        .where(PhoneInviteRow.family_id == member.family_id, PhoneInviteRow.accepted_at.is_(None))
        .order_by(PhoneInviteRow.created_at.desc())
    ).all()
    return [_phone_invite_out(row) for row in rows]


@router.delete("/family/phone-invites/{invite_id}", status_code=204, tags=["family"])
def cancel_phone_invite(invite_id: str, member: CurrentMember, db: DbSession) -> None:
    invite = db.get(PhoneInviteRow, invite_id)
    if invite is None or invite.family_id != member.family_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    db.delete(invite)
    db.commit()


def _phone_invite_out(invite: PhoneInviteRow) -> PhoneInviteOut:
    return PhoneInviteOut(
        id=invite.id,
        phone_masked=phone_auth.mask_phone(invite.phone),
        sms_sent=invite.sms_sent_at is not None,
        created_at=invite.created_at,
    )


def _accept_phone_invites(db: DbSession, account_phone: str, family_id: str) -> None:
    """Человек оказался в семье — приглашения этого номера в неё выполнены."""
    for invite in db.scalars(
        select(PhoneInviteRow).where(
            PhoneInviteRow.phone == account_phone, PhoneInviteRow.accepted_at.is_(None)
        )
    ).all():
        invite.accepted_at = datetime.now()


@router.post("/invites/{code}/move", response_model=SessionOut, tags=["family"])
def move_to_family(
    code: str, member: CurrentMember, token: CurrentToken, db: DbSession
) -> SessionOut:
    """Уже есть своя семья из одного человека — перейти в семью, куда позвали по ссылке."""
    family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
    if family is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приглашение не найдено")
    if family.id != member.family_id:
        try:
            fs.move_to_family(db, member, family)
        except TaskActionError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        db.refresh(member)
        fs.track(db, member, "family_joined", moved=True)
        if member.account:
            _accept_phone_invites(db, member.account.phone, family.id)
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
    passed = metrics.path_done(db, ids)
    return FamilyOut(
        id=family.id,
        name=family.name,
        invite_code=family.invite_code,
        ref_code=family.ref_code,
        members=[
            MemberOut.model_validate(m).model_copy(
                update={"notifications": m.id in with_push, "path_done": m.id in passed}
            )
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


@router.get("/tasks/frequent", response_model=list[FrequentOut], tags=["tasks"])
def frequent_tasks(member: CurrentMember, db: DbSession) -> list[FrequentOut]:
    """«Частые дела» над полем ввода: в одно касание — шторка с заполненными полями."""
    return [
        FrequentOut(title=title, count=count, task=TaskOut.model_validate(task))
        for title, count, task in fs.frequent(db, member)
    ]


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
    if member.allow_participants:
        task.participants = fs.resolve_participants(
            member.family, member, draft.participants, task.assignee_id
        )
    db.add(task)
    db.flush()
    fs.track(db, member, "task_dispatched", source=payload.source, assigned=bool(task.assignee_id))
    db.commit()
    _group_later(background, task)
    _notify_assignee(background, task, member)
    _notify_participants(background, task, member, task.participants)
    return task


def _valid_end(due: datetime | None, end: datetime | None) -> datetime | None:
    """Окончание имеет смысл только после начала и в пределах суток."""
    if due is None or end is None:
        return None
    if not (due < end <= due + timedelta(hours=16)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Окончание должно быть позже начала"
        )
    return end


@router.post("/tasks/parse", response_model=DraftOut, tags=["tasks"])
def parse_task(payload: DispatchRequest, member: CurrentMember) -> DraftOut:
    """Разобрать фразу, но не сохранять: шторка «Проверьте просьбу» перед отправкой."""
    batch = multi_tasks.split(payload.message, datetime.now())
    if batch:
        # Несколько дел — правилами, без модели; исполнитель — по общему правилу семьи
        assignee, why = fs.default_assignee(member.family, member, False)
        return DraftOut(
            title=batch[0].title,
            due_at=batch[0].due_at,
            ends_at=batch[0].ends_at,
            recurrence="none",
            priority="normal",
            items=[],
            requires_car=False,
            note=batch[0].note,
            assignee_id=assignee.id if assignee else None,
            rationale=why,
            clarifying_question=None,
            unclear=True,
            batch=[
                BatchItemOut(title=i.title, due_at=i.due_at, ends_at=i.ends_at, note=i.note)
                for i in batch
            ],
        )
    others = [m.name for m in member.family.members if m.id != member.id]
    draft = extractor.extract(payload.message, datetime.now(), member.name, others)
    assignee, why = fs.assignee_for(member.family, member, draft)
    return DraftOut(
        title=draft.title,
        due_at=draft.due_at,
        ends_at=draft.ends_at,
        recurrence=draft.recurrence.value,
        repeat_days=draft.repeat_days,
        repeat_until=draft.repeat_until
        or repeat.smart_until(draft.recurrence.value, draft.due_at or datetime.now()),
        priority=draft.priority.value,
        items=draft.items,
        requires_car=draft.requires_car,
        note=draft.note,
        assignee_id=assignee.id if assignee else None,
        participant_ids=(
            fs.resolve_participants(
                member.family, member, draft.participants, assignee.id if assignee else None
            )
            if member.allow_participants
            else []
        ),
        rationale=why,
        clarifying_question=draft.clarifying_question,
        unclear=draft.due_at is None or assignee is None or bool(draft.clarifying_question),
    )


ROLE_WORD = {"adult": "взрослый", "teen": "подросток", "child": "ребёнок"}


def _when_or_none(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value)).replace(tzinfo=None) if value else None
    except ValueError:
        return None


def pickup_due(now: datetime) -> datetime:
    """Срок «Забрать посылку»: в будни — сегодня в 18:00, в выходные — через час.

    В будни после 18:00 «сегодня в 18» уже прошло — тоже через час. Округляем до 5 минут.
    """
    evening = now.replace(hour=18, minute=0, second=0, microsecond=0)
    if now.weekday() < 5 and now < evening:
        return evening
    later = now.replace(second=0, microsecond=0) + timedelta(hours=1)
    return later + timedelta(minutes=(5 - later.minute % 5) % 5)


def _member_by_ref(member: MemberRow, ref: object) -> MemberRow | None:
    """«self» или имя из семьи → участник; иначе None."""
    wanted = str(ref or "").strip().lower()
    if wanted == "self":
        return member
    return next((m for m in member.family.members if m.name.strip().lower() == wanted), None)


@router.post("/tasks/parse-image", response_model=DraftOut, tags=["tasks"])
async def parse_image(upload: UploadFile, member: CurrentMember, db: DbSession) -> DraftOut:
    """Дела со скриншота другого приложения — в шторку проверки, как разобранная фраза."""
    data = await upload.read(files.MAX_BYTES + 1)
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    try:
        files.check(content_type, data, 0)
    except files.FileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if not content_type.startswith("image/"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Нужен скриншот или фото")
    client = LLMClient()
    if not client.vision_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Распознавание скриншотов сейчас недоступно"
        )
    others = [
        f"{m.name} ({ROLE_WORD.get(m.role, m.role)})"
        for m in member.family.members
        if m.id != member.id
    ]
    found = await run_in_threadpool(
        client.tasks_from_image,
        data,
        content_type,
        datetime.now().isoformat(timespec="minutes"),
        member.name,
        others,
    )
    fs.track(db, member, "task_parsed_image", count=len(found or []))
    db.commit()
    if not found:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Не нашли на скриншоте дел — попробуйте другой или напишите текстом",
        )
    tasks = []
    now = datetime.now()
    for raw in found:
        due = _when_or_none(raw.get("due_at"))
        if raw.get("pickup"):
            # Код получения действует только сегодня — срок со скриншота (хранение до…) не берём
            due = pickup_due(now)
            raw = {**raw, "ends_at": None}
        tasks.append(
            {
                "title": str(raw["title"]).strip()[:300],
                "due_at": due,
                "ends_at": _valid_end(due, _when_or_none(raw.get("ends_at"))),
                "note": str(raw.get("note") or "").strip()[:2000] or None,
                "items": [str(i).strip()[:120] for i in raw.get("items") or [] if str(i).strip()],
                "assignee": _member_by_ref(member, raw.get("assignee")),
                "pickup": bool(raw.get("pickup")),
            }
        )
    # Исполнитель: кого назвала модель, иначе — по общему правилу семьи
    assignee = next((t["assignee"] for t in tasks if t["assignee"]), None)
    why: str | None = "Со скриншота"
    if assignee is None:
        assignee, why = fs.default_assignee(member.family, member, False)
    first = tasks[0]
    return DraftOut(
        title=first["title"],
        due_at=first["due_at"],
        ends_at=first["ends_at"],
        recurrence="none",
        priority="normal",
        items=first["items"],
        requires_car=False,
        note=first["note"],
        assignee_id=assignee.id if assignee else None,
        rationale=why,
        clarifying_question=None,
        # Со скриншота — всегда показываем, что поняли: распознавание могло ошибиться
        unclear=True,
        attach_image=len(tasks) == 1 and first["pickup"],
        batch=[
            BatchItemOut(
                title=t["title"],
                due_at=t["due_at"],
                ends_at=t["ends_at"],
                note=t["note"],
                items=t["items"],
            )
            for t in tasks
        ]
        if len(tasks) >= 2
        else [],
    )


@router.post("/tasks/batch", response_model=list[TaskOut], status_code=201, tags=["tasks"])
def create_batch(
    payload: BatchCreateRequest, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> list[TaskRow]:
    """Несколько дел из одного сообщения: каждое — отдельная задача, уведомление одно."""
    _check_member(member, payload.assignee_id)
    assignee = next((m for m in member.family.members if m.id == payload.assignee_id), None)
    created = []
    for item in payload.tasks:
        task = TaskRow(
            family_id=member.family_id,
            created_by_id=member.id,
            title=item.title.strip(),
            source=payload.source,
            source_text=payload.source_text,
            due_at=item.due_at,
            ends_at=_valid_end(item.due_at, item.ends_at) if item.ends_at else None,
            note=(item.note or "").strip() or None,
            items=shopping.with_groups(
                [{"text": t.strip()[:120], "done": False} for t in item.items if t.strip()]
            ),
        )
        if assignee is not None:
            fs.assign(task, assignee, member, None)
        else:
            who, why = fs.default_assignee(member.family, member, False)
            fs.assign(task, who, member, why)
        db.add(task)
        created.append(task)
    db.flush()
    fs.track(db, member, "task_dispatched", source=payload.source, batch=len(created))
    db.commit()
    for task in created:
        _group_later(background, task)
    target = created[0].assignee_id
    if target and target != member.id and all(t.assignee_id == target for t in created):
        background.add_task(
            notifications.deliver,
            target,
            notifications.batch_message(member, [t.title for t in created]),
        )
    return created


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(
    payload: CreateTaskRequest, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
    """Просьба со всеми полями: из шторки проверки или вручную."""
    _check_member(member, payload.assignee_id)
    task = TaskRow(
        family_id=member.family_id,
        created_by_id=member.id,
        title=payload.title.strip(),
        source=payload.source,
        source_text=payload.source_text,
        due_at=payload.due_at,
        duration_minutes=payload.duration_minutes,
        ends_at=_valid_end(payload.due_at, payload.ends_at),
        requires_car=payload.requires_car,
        recurrence=payload.recurrence.value,
        priority=payload.priority,
        items=shopping.with_groups(
            [{"text": text.strip()[:120], "done": False} for text in payload.items if text.strip()]
        ),
        note=(payload.note or "").strip() or None,
        note_repeat=payload.note_repeat,
    )
    fs.set_repeat(
        task,
        payload.recurrence.value,
        payload.repeat_days,
        payload.repeat_until,
        payload.repeat_forever,
    )
    if payload.assignee_id:
        assignee = next(m for m in member.family.members if m.id == payload.assignee_id)
        fs.assign(task, assignee, member, None)
    else:
        assignee, why = fs.default_assignee(member.family, member, payload.requires_car)
        fs.assign(task, assignee, member, why)
    task.participants = _clean_participants(member, payload.participants, task.assignee_id)
    db.add(task)
    db.flush()
    if payload.source == "manual":
        fs.track(db, member, "task_created", source="manual")
    else:
        # Через шторку проверки — тот же главный сценарий, что и /tasks/dispatch
        fs.track(db, member, "task_dispatched", source=payload.source, confirmed=True)
    db.commit()
    _group_later(background, task)
    if not payload.defer_notify:
        _notify_assignee(background, task, member)
        _notify_participants(background, task, member, task.participants)
    return task


@router.post("/tasks/{task_id}/notify", status_code=204, tags=["tasks"])
def notify_task(
    task_id: str, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> None:
    """Отложенное уведомление исполнителю — после того, как к просьбе прикрепили файлы."""
    task = _family_task(db, member, task_id)
    if task.created_by_id != member.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Уведомить может только тот, кто просит")
    _notify_assignee(background, task, member)
    _notify_participants(background, task, member, task.participants or [])


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
    requested = dict(changes)
    before_assignee = task.assignee_id
    if "due_at" in changes or "ends_at" in changes:
        due = changes.get("due_at", task.due_at)
        if "ends_at" in changes:
            end = changes["ends_at"]
        elif task.ends_at and task.due_at and due:
            end = due + (task.ends_at - task.due_at)  # перенесли — окончание сдвигается следом
        else:
            end = None
        changes["ends_at"] = _valid_end(due, end)
    if "assignee_id" in changes:
        _check_member(member, changes["assignee_id"])
        new_id = changes.pop("assignee_id")
        assignee = next((m for m in member.family.members if m.id == new_id), None)
        # Новый исполнитель — поручение снова ждёт его ответа
        fs.assign(task, assignee, member, None)
    added: list[str] = []
    if "participants" in changes:
        before = set(task.participants or [])
        changes["participants"] = _clean_participants(
            member, changes["participants"] or [], task.assignee_id
        )
        added = [i for i in changes["participants"] if i not in before]
    elif task.participants and task.assignee_id in task.participants:
        # Новый исполнитель был участником — теперь он исполнитель
        task.participants = [i for i in task.participants if i != task.assignee_id]
    repeat_fields = {"recurrence", "repeat_days", "repeat_until", "repeat_forever"}
    if repeat_fields & changes.keys():
        recurrence = (
            str(changes["recurrence"] or "none") if "recurrence" in changes else task.recurrence
        )
        newly = recurrence != task.recurrence
        fs.set_repeat(
            task,
            recurrence,
            changes.get("repeat_days", task.repeat_days),
            changes.get("repeat_until", None if newly else task.repeat_until),
            bool(changes.get("repeat_forever"))
            or (not newly and "repeat_until" not in changes and task.repeat_until is None),
        )
        for name in repeat_fields:
            changes.pop(name, None)
    for field, value in changes.items():
        if field == "title" and value is None:
            continue
        if field == "recurrence":
            value = str(value or "none")
        if field == "note":
            value = (value or "").strip() or None
        if field == "note_repeat" and value is None:
            continue
        setattr(task, field, value)
    if "due_at" in changes or "assignee_id" in payload.model_dump(exclude_unset=True):
        # Новый срок или исполнитель — напоминание отправится заново
        task.reminded_at = None
        task.remembered_at = None
        task.nudged_at = None
        task.nudges = 0
    if "due_at" in changes and task.due_at is not None:
        task.clarifying_question = None
    fs.track(db, member, "task_edited", fields=fields)
    db.commit()
    if "assignee_id" in payload.model_dump(exclude_unset=True):
        _notify_assignee(background, task, member)
    if task.assignee_id == before_assignee:
        # Новому исполнителю и так придёт поручение целиком
        _notify_edit(background, task, member, _describe_changes(task, requested))
    _notify_participants(background, task, member, added)
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


@router.post("/tasks/{task_id}/reject", response_model=TaskOut, tags=["tasks"])
def reject_task(
    task_id: str,
    payload: RejectRequest,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
) -> TaskRow:
    """«Не выполнено»: автор возвращает сделанное исполнителю с обратной связью."""
    task = _family_task(db, member, task_id)
    try:
        fs.reject(db, task, member, payload.comment)
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    fs.track(db, member, "task_rejected", with_comment=bool(task.feedback))
    db.commit()
    background.add_task(
        notifications.deliver, task.assignee_id, notifications.rejected_message(task, member)
    )
    return task


@router.post("/tasks/{task_id}/thanks", response_model=TaskOut, tags=["tasks"])
def thank_task(
    task_id: str, member: CurrentMember, db: DbSession, background: BackgroundTasks
) -> TaskRow:
    """«Спасибо» за сделанное дело — исполнителю уведомление, в «Итогах недели» плюсик."""
    task = _family_task(db, member, task_id)
    try:
        first = fs.thank(task, member)
    except TaskActionError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if first:
        fs.track(db, member, "task_thanked")
        db.commit()
        background.add_task(
            notifications.deliver, task.assignee_id, notifications.thanks_message(task, member)
        )
    return task


@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut], tags=["tasks"])
def list_comments(task_id: str, member: CurrentMember, db: DbSession) -> list[TaskCommentRow]:
    return _family_task(db, member, task_id).comments


@router.post("/tasks/{task_id}/comments", response_model=list[CommentOut], tags=["tasks"])
def add_comment(
    task_id: str,
    payload: CommentRequest,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
) -> list[TaskCommentRow]:
    """Сообщение в переписке по делу — остальным участникам дела уведомление."""
    task = _family_task(db, member, task_id)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Пустое сообщение")
    task.comments.append(TaskCommentRow(member_id=member.id, text=text))
    fs.track(db, member, "task_commented", author=task.created_by_id == member.id)
    db.commit()
    message = notifications.comment_message(task, member, text)
    for member_id in {task.created_by_id, task.assignee_id, *task.participants} - {member.id, None}:
        background.add_task(notifications.deliver, member_id, message)
    return task.comments


@router.get("/family/week", response_model=WeekOut, tags=["family"])
def family_week(member: CurrentMember, db: DbSession) -> WeekOut:
    """«Итоги недели» для вкладки «Семья»."""
    return WeekOut(**fs.week_stats(db, member.family))


@router.put("/tasks/{task_id}/items", response_model=TaskOut, tags=["tasks"])
def set_items(
    task_id: str,
    payload: ItemsRequest,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
) -> TaskRow:
    """Список покупок: отметить купленное, добавить или убрать пункт. Доступен всей семье."""
    task = _family_task(db, member, task_id)
    before = {item["text"]: item.get("done", False) for item in task.items or []}
    task.items = shopping.with_groups([item.model_dump() for item in payload.items])
    checked = sum(1 for item in payload.items if item.done and not before.get(item.text, False))
    fs.track(db, member, "task_items_updated", count=len(payload.items), checked=checked)
    db.commit()
    _group_later(background, task)
    # Отметки «купил» — не правка; новые пункты — правка
    added = [item.text for item in payload.items if item.text not in before]
    if added:
        shown = ", ".join(added[:4]) + ("…" if len(added) > 4 else "")
        _notify_edit(background, task, member, [f"в списке: {shown}"])
    return task


@router.post("/tasks/{task_id}/files", response_model=TaskOut, status_code=201, tags=["tasks"])
async def attach_file(
    task_id: str,
    upload: UploadFile,
    member: CurrentMember,
    db: DbSession,
    background: BackgroundTasks,
) -> TaskRow:
    """Прикрепить фото, скриншот или PDF — например, QR-код получения с Ozon или WB."""
    task = _family_task(db, member, task_id)
    data = await upload.read(files.MAX_BYTES + 1)
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    try:
        files.check(content_type, data, len(task.files))
    except files.FileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    name = Path(upload.filename or "файл").name[:200] or "файл"
    row = TaskFileRow(
        task_id=task.id,
        uploaded_by_id=member.id,
        name=name,
        content_type=content_type,
        size=len(data),
    )
    db.add(row)
    db.flush()
    files.save(row, data)
    fs.track(db, member, "task_file_added", content_type=content_type)
    db.commit()
    db.refresh(task)
    _notify_edit(background, task, member, [f"прикреплён файл: {name}"])
    return task


@router.delete("/tasks/{task_id}/files/{file_id}", response_model=TaskOut, tags=["tasks"])
def detach_file(task_id: str, file_id: str, member: CurrentMember, db: DbSession) -> TaskRow:
    task = _family_task(db, member, task_id)
    row = db.get(TaskFileRow, file_id)
    if row is None or row.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    if member.id not in (row.uploaded_by_id, task.created_by_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Удалить может тот, кто прикрепил, или автор"
        )
    files.remove(row)
    db.delete(row)
    fs.track(db, member, "task_file_removed")
    db.commit()
    db.refresh(task)
    return task


@router.get("/files/{file_id}", tags=["tasks"], include_in_schema=False)
def get_file(file_id: str, db: DbSession, sig: str = "") -> FileResponse:
    """Файл по подписанной ссылке (её отдаёт API семьи в TaskOut.files[].url)."""
    row = db.get(TaskFileRow, file_id)
    if row is None or not files.valid(file_id, sig) or not files.path_of(row).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    return FileResponse(
        files.path_of(row),
        media_type=row.content_type,
        filename=row.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: str, member: CurrentMember, db: DbSession) -> None:
    task = _family_task(db, member, task_id)
    if task.created_by_id != member.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Удалить может только автор просьбы")
    for row in task.files:
        files.remove(row)
    db.delete(task)
    fs.track(db, member, "task_deleted")
    db.commit()


# ---------- Аналитика ----------


@router.post("/events", status_code=204, tags=["analytics"])
def track_event(payload: TrackRequest, member: CurrentMember, db: DbSession) -> None:
    fs.track(db, member, payload.name, **payload.props)
    db.commit()
