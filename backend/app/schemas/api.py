"""Схемы запросов и ответов публичного API приложения."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.task import Recurrence

Role = Literal["adult", "teen", "child"]


class CreateFamilyRequest(BaseModel):
    family_name: str | None = Field(default=None, max_length=120)
    # Код ссылки-рекомендации (/?from=<код>), по которой пришла семья
    ref: str | None = Field(default=None, max_length=32)
    member_name: str = Field(min_length=1, max_length=80)
    has_car: bool = False


class JoinFamilyRequest(BaseModel):
    member_name: str = Field(min_length=1, max_length=80)
    role: Role = "adult"
    has_car: bool = False


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: str
    has_car: bool
    capacity_minutes: int
    dislikes: list[str]
    remind_before_min: int = 60
    # Есть ли у человека устройство с push — второй супруг должен видеть, что уведомления не дойдут
    notifications: bool = False


class UpdateMemberRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    has_car: bool | None = None
    capacity_minutes: int | None = Field(default=None, ge=0, le=6000)
    dislikes: list[str] | None = None
    # За сколько минут до срока напоминать: 0 — не напоминать, максимум — за сутки
    remind_before_min: Literal[0, 15, 30, 60, 120, 1440] | None = None


class PhoneStartRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    # True — войти звонком, даже если задан PIN-код (забыли PIN)
    call: bool = False
    # Галочка согласия на обработку ПДн; нужна, только пока номер её не давал
    consent: bool = False


class PhoneCheckOut(BaseModel):
    # pin — у номера есть PIN-код, звонок не нужен; call — позвонить на call_phone
    method: Literal["call", "pin"] = "call"
    phone_masked: str
    check_id: str | None = None
    call_phone: str | None = None  # для ссылки tel:
    call_phone_pretty: str | None = None
    expires_in_s: int | None = None


class PinLoginRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    pin: str = Field(min_length=4, max_length=4)


class SetPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class TokenOut(BaseModel):
    token: str


class PhoneCheckStatusOut(BaseModel):
    status: Literal["pending", "confirmed", "expired", "used"]
    token: str | None = None


class AccountOut(BaseModel):
    phone_masked: str
    has_pin: bool = False
    member: MemberOut | None
    family_id: str | None


class SessionOut(BaseModel):
    token: str
    member: MemberOut
    family_id: str


class ReferralInfo(BaseModel):
    """Кто рекомендует — имя создателя семьи, больше ничего."""

    from_name: str


class InviteInfo(BaseModel):
    family_name: str
    members: list[str]


class FamilyOut(BaseModel):
    id: str
    name: str
    invite_code: str
    ref_code: str
    members: list[MemberOut]


class TaskItem(BaseModel):
    """Пункт списка в задаче — например, покупка."""

    text: str = Field(min_length=1, max_length=120)
    done: bool = False


class ItemsRequest(BaseModel):
    items: list[TaskItem] = Field(max_length=60)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    source: str
    beneficiary: str | None
    due_at: datetime | None
    duration_minutes: int
    priority: str
    recurrence: str
    requires_car: bool
    location: str | None
    clarifying_question: str | None
    status: Literal["new", "accepted", "done"]
    assignee_id: str | None
    created_by_id: str
    rationale: str | None
    decline_reason: str | None
    items: list[TaskItem] = []
    reminded_at: datetime | None = None
    remembered_at: datetime | None = None
    created_at: datetime
    accepted_at: datetime | None
    completed_at: datetime | None


class DispatchRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    source: Literal["text", "voice"] = "text"


class CreateTaskRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_at: datetime | None = None
    duration_minutes: int = Field(default=30, ge=5, le=600)
    assignee_id: str | None = None
    requires_car: bool = False


class UpdateTaskRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    due_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=600)
    assignee_id: str | None = None
    recurrence: Recurrence | None = None


class DeclineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=2000)


class PushStatusOut(BaseModel):
    enabled: bool
    public_key: str | None
    devices: int


class ActRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class ActInfoOut(BaseModel):
    task: "TaskOut"
    member_name: str
    author_name: str
    assignee_name: str | None
    can_accept: bool
    can_decline: bool
    can_done: bool
    can_remember: bool = False


# События клиента: открытия, просмотры и воронка подключения уведомлений
ClientEvent = Literal[
    "app_open",
    "screen_view",
    "invite_shared",
    "pwa_opened",  # открыто как установленное приложение
    "install_prompt_shown",
    "install_accepted",
    "push_prompt_shown",
    "push_permission_granted",
    "push_permission_denied",
]


class TrackRequest(BaseModel):
    name: ClientEvent
    props: dict[str, str | int | float | bool] = Field(default_factory=dict)


class DailyStat(BaseModel):
    day: str
    dau: int
    # Действия пользователей в интерфейсе (без открытий и просмотров)
    actions: int
    actions_per_dau: float
    # Обращения решения к компонентам — метрика Положения (прил. 2, п. 2.2)
    component_calls: int = 0
    component_calls_per_dau: float = 0.0
    component_errors: int = 0
    calls_by_kind: dict[str, int] = {}


class AnalyticsOut(BaseModel):
    days: list[DailyStat]
