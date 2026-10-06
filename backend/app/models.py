"""ORM-модели: семья, участник, задача и продуктовые события."""

import secrets
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _token() -> str:
    return secrets.token_urlsafe(32)


def _invite_code() -> str:
    return secrets.token_urlsafe(6)


class FamilyRow(Base):
    __tablename__ = "families"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    invite_code: Mapped[str] = mapped_column(String(32), unique=True, default=_invite_code)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    members: Mapped[list["MemberRow"]] = relationship(
        back_populates="family", order_by="MemberRow.created_at"
    )


class MemberRow(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(16), default="adult")  # adult / teen / child
    has_car: Mapped[bool] = mapped_column(Boolean, default=False)
    capacity_minutes: Mapped[int] = mapped_column(Integer, default=600)
    dislikes: Mapped[list[str]] = mapped_column(JSON, default=list)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=_token)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    family: Mapped[FamilyRow] = relationship(back_populates="members")


class TaskRow(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True)
    created_by_id: Mapped[str] = mapped_column(ForeignKey("members.id"))
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("members.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(300))
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="text")  # text / voice / manual
    beneficiary: Mapped[str | None] = mapped_column(String(80), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    priority: Mapped[str] = mapped_column(String(8), default="normal")
    recurrence: Mapped[str] = mapped_column(String(8), default="none")
    requires_car: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    clarifying_question: Mapped[str | None] = mapped_column(String(300), nullable=True)

    status: Mapped[str] = mapped_column(String(12), default="open")  # open / done
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    fairness_score: Mapped[float | None] = mapped_column(nullable=True)
    vetoed_by: Mapped[list[str]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ComponentCallRow(Base):
    """Обращение решения к компоненту (LLM, навык, голос, push, боты…) — см. services/telemetry."""

    __tablename__ = "component_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    operation: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(12), default="ok")  # ok / error
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Кто инициировал (для DAU и антифрода); фоновые вызовы могут быть без участника
    member_id: Mapped[str | None] = mapped_column(
        ForeignKey("members.id"), nullable=True, index=True
    )
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), nullable=True)


class EventRow(Base):
    """Продуктовое событие — основа для DAU и «обращений на пользователя»."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(40), index=True)
    props: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
