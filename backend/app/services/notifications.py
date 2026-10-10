"""Уведомления: push PWA (Web Push) и подписанные ссылки действий.

Содержимое push шифруется между сервером и браузером (RFC 8291): серверы Apple и
Google видят только шифротекст, поэтому в уведомлении можно показать название задачи.

Кнопки уведомления и страница задачи работают без входа — по подписанной ссылке,
привязанной к одной задаче и одному человеку (HMAC, срок 7 дней).

Отправка идёт в фоне после ответа (BackgroundTasks), со своей сессией БД. Каждая
отправка — обращение к компоненту (Kind.PUSH). Подписки, на которые push-сервис
ответил 404/410, удаляются.
"""

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import MemberRow, PushSubscriptionRow, TaskRow
from app.services import telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

ACTION_TTL_S = 7 * 24 * 3600


# ---------- Подписанные ссылки действий ----------


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def action_token(task_id: str, member_id: str, now: float | None = None) -> str:
    expires = int((now or time.time()) + ACTION_TTL_S)
    body = _b64(f"{task_id}:{member_id}:{expires}".encode())
    sign = hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(sign[:16])}"


def read_action_token(token: str, now: float | None = None) -> tuple[str, str] | None:
    """(task_id, member_id) или None, если подпись неверна или срок вышел."""
    try:
        body, sign = token.split(".", 1)
        expected = hmac.new(
            get_settings().secret_key.encode(), body.encode(), hashlib.sha256
        ).digest()[:16]
        if not hmac.compare_digest(_unb64(sign), expected):
            return None
        task_id, member_id, expires = _unb64(body).decode().split(":")
    except (ValueError, UnicodeDecodeError):
        return None
    if int(expires) < (now or time.time()):
        return None
    return task_id, member_id


# ---------- Сообщения ----------


@dataclass
class PushMessage:
    title: str
    body: str
    url: str  # куда вести по нажатию
    tag: str  # одно уведомление на задачу: новое заменяет старое
    actions: list[dict] = field(default_factory=list)
    act_url: str | None = None  # POST {act_url}/{action} — кнопки без входа

    def payload(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


def _act(task: TaskRow, member_id: str) -> tuple[str, str]:
    token = action_token(task.id, member_id)
    return f"/t/{token}", f"/api/v1/act/{token}"


def _with_details(task: TaskRow) -> str:
    """Название, а под ним — начало заметки или пунктов списка: видно, не открывая приложение."""
    extra = task.note or ", ".join(i["text"] for i in (task.items or []))
    if not extra:
        return task.title
    extra = " ".join(extra.split())
    return f"{task.title}\n{extra[:90]}{'…' if len(extra) > 90 else ''}"


def new_task_message(task: TaskRow, author: MemberRow) -> PushMessage:
    url, act = _act(task, task.assignee_id)
    return PushMessage(
        title=f"{author.name} просит",
        body=_with_details(task),
        url=url,
        tag=f"task-{task.id}",
        actions=[{"action": "accept", "title": "Беру"}, {"action": "decline", "title": "Не могу"}],
        act_url=act,
    )


def participant_message(task: TaskRow, author: MemberRow) -> PushMessage:
    """Участнику совместного дела: отвечать не нужно — просто знать, что вы заняты."""
    when = _when(task.due_at, datetime.now()) if task.due_at else "без срока"
    return PushMessage(
        title=f"{author.name}: вы участвуете",
        body=f"{task.title} · {when}",
        url="/",
        tag=f"task-{task.id}-with",
    )


def _when(due: datetime, now: datetime) -> str:
    minutes = max(0, round((due - now).total_seconds() / 60))
    if minutes < 60:
        return f"через {minutes} мин" if minutes else "сейчас"
    day = (
        "сегодня"
        if due.date() == now.date()
        else "завтра"
        if (due.date() - now.date()).days == 1
        else due.strftime("%d.%m")
    )
    return f"{day} в {due:%H:%M}"


def reminder_message(task: TaskRow, now: datetime) -> PushMessage:
    """Исполнителю перед сроком.

    Ещё не ответил — «Беру» / «Не могу»; уже взял — «Я помню» / «Сделано».
    """
    url, act = _act(task, task.assignee_id)
    if task.status == "new":
        actions = [{"action": "accept", "title": "Беру"}, {"action": "decline", "title": "Не могу"}]
        title = f"Ждёт ответа, {_when(task.due_at, now)}"
    else:
        actions = [
            {"action": "remember", "title": "Я помню"},
            {"action": "done", "title": "Сделано"},
        ]
        title = f"Напоминание: {_when(task.due_at, now)}"
    return PushMessage(
        title=title, body=task.title, url=url, tag=f"task-{task.id}", actions=actions, act_url=act
    )


def rejected_message(task: TaskRow, author: MemberRow) -> PushMessage:
    """Исполнителю: автор отметил «Не выполнено» — с комментарием и кнопкой «Сделано»."""
    url, act = _act(task, task.assignee_id)
    body = f"{task.title} — {task.feedback}" if task.feedback else task.title
    return PushMessage(
        title=f"{author.name}: не выполнено",
        body=body,
        url=url,
        tag=f"task-{task.id}",
        actions=[{"action": "done", "title": "Сделано"}],
        act_url=act,
    )


def answer_message(task: TaskRow, who: MemberRow, kind: str) -> PushMessage:
    """Автору: исполнитель ответил «Беру» / «Не могу» или отметил «Сделано»."""
    verb = {"accepted": "берёт", "declined": "не может", "done": "сделал(а)"}[kind]
    body = task.title
    if kind == "declined" and task.decline_reason and ":" in task.decline_reason:
        body = f"{task.title} — {task.decline_reason.split(':', 1)[1].strip()}"
    return PushMessage(title=f"{who.name} {verb}", body=body, url="/", tag=f"task-{task.id}")


# ---------- Отправка ----------


def push_enabled() -> bool:
    settings = get_settings()
    # На проде ссылки с ключом по умолчанию можно подделать — без своего SECRET_KEY push не включаем
    weak_secret = settings.is_production and settings.secret_key == "local-secret-key"
    return bool(settings.vapid_public_key and settings.vapid_private_key) and not weak_secret


def deliver(member_id: str, message: PushMessage) -> int:
    """Отправить push на все устройства участника. Возвращает число доставленных."""
    if not push_enabled():
        return 0
    from pywebpush import WebPushException, webpush

    settings = get_settings()
    sent = 0
    with SessionLocal() as db:
        member = db.get(MemberRow, member_id)
        if member is None:
            return 0
        actor = telemetry.Actor(member.id, member.family_id)
        subscriptions = db.scalars(
            select(PushSubscriptionRow).where(PushSubscriptionRow.member_id == member_id)
        ).all()
        for sub in subscriptions:
            started = time.perf_counter()
            status, error = "ok", None
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=message.payload(),
                    vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=24 * 3600,
                    timeout=10,
                )
                sub.last_success_at = datetime.now()
                sub.failures = 0
                sent += 1
            except WebPushException as exc:
                code = exc.response.status_code if exc.response is not None else None
                status, error = "error", f"http_{code}" if code else "webpush"
                if code in (404, 410):
                    db.delete(sub)  # устройство отписалось или подписка устарела
                else:
                    sub.failures += 1
            except Exception as exc:  # сеть, таймаут — не роняем фоновую задачу
                status, error = "error", type(exc).__name__
                sub.failures += 1
            telemetry.record(
                Kind.PUSH,
                "send",
                status=status,
                error_code=error,
                latency_ms=int((time.perf_counter() - started) * 1000),
                actor=actor,
            )
        db.commit()
    return sent
