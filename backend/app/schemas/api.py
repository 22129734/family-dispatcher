"""Схемы запросов и ответов публичного API приложения."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["adult", "teen", "child"]


class CreateFamilyRequest(BaseModel):
    family_name: str = Field(min_length=1, max_length=120)
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


class UpdateMemberRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    has_car: bool | None = None
    capacity_minutes: int | None = Field(default=None, ge=0, le=6000)
    dislikes: list[str] | None = None


class PhoneStartRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)


class PhoneCheckOut(BaseModel):
    check_id: str
    call_phone: str  # для ссылки tel:
    call_phone_pretty: str
    phone_masked: str
    expires_in_s: int


class PhoneCheckStatusOut(BaseModel):
    status: Literal["pending", "confirmed", "expired", "used"]
    token: str | None = None


class AccountOut(BaseModel):
    phone_masked: str
    member: MemberOut | None
    family_id: str | None


class SessionOut(BaseModel):
    token: str
    member: MemberOut
    family_id: str


class InviteInfo(BaseModel):
    family_name: str
    members: list[str]


class FamilyOut(BaseModel):
    id: str
    name: str
    invite_code: str
    members: list[MemberOut]


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


class DeclineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class TrackRequest(BaseModel):
    name: Literal["app_open", "screen_view", "invite_shared"]
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
