"""ORM-модели: семья, участник, задача и продуктовые события."""

import secrets
import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _invite_code() -> str:
    return secrets.token_urlsafe(6)


class AccountRow(Base):
    """Учётная запись человека: подтверждённый телефон и PIN-код для быстрого входа."""

    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    phone: Mapped[str] = mapped_column(String(16), unique=True, index=True)  # 7XXXXXXXXXX
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_login_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    # PIN хранится только хэшем (scrypt). После 5 ошибок подряд — вход только звонком.
    pin_hash: Mapped[str | None] = mapped_column(String(160), nullable=True)
    pin_failures: Mapped[int] = mapped_column(Integer, default=0)
    pin_locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Когда человек согласился на обработку ПДн — после этого галочку больше не спрашиваем
    consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Участник хакатона или его семья — не учитывается в метриках (Положение, п. 5.1.3)
    is_team: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Откуда пришёл человек (services/traffic.py): family_invite, referral, utm:…, qr:…,
    # site:…, direct; у пришедших до 15.10.2026 без приглашения — unknown_before_15_10
    source: Mapped[str | None] = mapped_column(String(80), nullable=True)


class SessionRow(Base):
    """Сессия устройства. У аккаунта их несколько: телефон, приложение на экране, компьютер."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # Храним sha256 токена: утечка базы не даёт войти
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class LoginAttemptRow(Base):
    """Неудачные попытки входа по PIN — для ограничения перебора с одного адреса."""

    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)


class PhoneCheckRow(Base):
    """Проверка номера звонком: человек звонит на выданный номер, провайдер подтверждает."""

    __tablename__ = "phone_checks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    phone: Mapped[str] = mapped_column(String(16), index=True)
    provider_check_id: Mapped[str] = mapped_column(String(64))
    call_phone: Mapped[str] = mapped_column(String(20))
    call_phone_pretty: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending/confirmed/expired
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Когда по этой проверке выдали сессию — повторно токен не выдаётся
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FamilyRow(Base):
    __tablename__ = "families"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    invite_code: Mapped[str] = mapped_column(String(32), unique=True, default=_invite_code)
    # Ссылка-рекомендация для других семей (/?from=<код>) и откуда пришла эта семья
    ref_code: Mapped[str] = mapped_column(String(32), unique=True, default=_invite_code)
    referred_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("families.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    members: Mapped[list["MemberRow"]] = relationship(
        back_populates="family", order_by="MemberRow.created_at"
    )


class MemberRow(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True)
    # Человек входит по телефону; у одного аккаунта — одна семья
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("accounts.id"), nullable=True, unique=True
    )
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(16), default="adult")  # adult / teen / child
    has_car: Mapped[bool] = mapped_column(Boolean, default=False)
    capacity_minutes: Mapped[int] = mapped_column(Integer, default=600)
    dislikes: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Личная настройка: за сколько минут до срока напоминать о деле (0 — не напоминать)
    remind_before_min: Mapped[int] = mapped_column(Integer, default=60, server_default="60")
    # Тема оформления; пусто — тема по умолчанию («Лаванда»)
    theme: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Проверка просьбы перед отправкой: auto — если что-то неясно, always, never; пусто — auto
    confirm_mode: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Несколько участников в деле («мы с мужем в кино»); по умолчанию — один исполнитель
    allow_participants: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # После обучения при первом входе человек выбрал «Нет, разберусь» — подсказки не показываем
    hints_off: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    family: Mapped[FamilyRow] = relationship(back_populates="members")
    # Аккаунт для входа по телефону; у детей без телефона — нет
    account: Mapped[AccountRow | None] = relationship()


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
    # Окончание — только если его назвали («с 9 до 10»): видно, когда человек занят
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priority: Mapped[str] = mapped_column(String(8), default="normal")
    recurrence: Mapped[str] = mapped_column(String(8), default="none")
    # «По дням недели»: какие дни (0 — понедельник); до какого числа повторять (пусто — всегда)
    repeat_days: Mapped[list[int]] = mapped_column(JSON, default=list)
    repeat_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    requires_car: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    clarifying_question: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # new — поручено, ждёт ответа; accepted — исполнитель взял; done — сделано
    status: Mapped[str] = mapped_column(String(12), default="new", index=True)
    # Почему этот исполнитель (коротко) — например, «Есть машина»
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Если исполнитель ответил «Не могу» — кто и почему; задача возвращается автору
    decline_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Список покупок и других пунктов: [{"text": "молоко", "done": false}, ...]
    items: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # Заметка повторяющегося дела переходит в следующие повторы (иначе — только для этого раза)
    note_repeat: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Кто ещё участвует, кроме исполнителя: id членов семьи. Отвечает и отмечает «Сделано»
    # по-прежнему один исполнитель — остальные видят, что заняты в это время
    participants: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Повтор изменили «только в этот раз» — какими поля были в серии (services/series.py):
    # следующий повтор создаётся по ним, а не по изменённому делу
    series_base: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Напоминание перед сроком отправлено; исполнитель ответил «Я помню»
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remembered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Исполнитель не ответил на просьбу больше суток — напомнили (не больше двух раз)
    nudged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nudges: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # «Не выполнено»: автор вернул сделанное с комментарием исполнителю
    feedback: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Заметка: подробности, которые не влезают в название (кабинет, адрес, что взять)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Автор сказал «спасибо» за сделанное — плюсик в карму исполнителю
    thanked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    files: Mapped[list["TaskFileRow"]] = relationship(
        order_by="TaskFileRow.created_at", cascade="all, delete-orphan", passive_deletes=True
    )
    # Переписка в деле: исполнитель уточняет у автора, автор отвечает
    comments: Mapped[list["TaskCommentRow"]] = relationship(
        order_by="TaskCommentRow.created_at",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )

    @property
    def comments_count(self) -> int:
        return len(self.comments)

    @property
    def last_comment_by_id(self) -> str | None:
        return self.comments[-1].member_id if self.comments else None


class PhoneInviteRow(Base):
    """Приглашение по номеру: войдёт с этим номером — попадёт в семью, без ссылки."""

    __tablename__ = "phone_invites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    invited_by_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    phone: Mapped[str] = mapped_column(String(16), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    sms_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TaskFileRow(Base):
    """Файл к задаче: фото, скриншот, PDF — например, QR-код получения посылки."""

    __tablename__ = "task_files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    uploaded_by_id: Mapped[str] = mapped_column(ForeignKey("members.id"))
    name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class TaskCommentRow(Base):
    """Сообщение в переписке по делу: «Какой именно подарок?» — «Лего, до 3000»."""

    __tablename__ = "task_comments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"))
    text: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


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
    # Стоимость вызова LLM по данным шлюза программы (заголовок x-litellm-response-cost)
    cost_rub: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Кто инициировал (для DAU и антифрода); фоновые вызовы могут быть без участника
    member_id: Mapped[str | None] = mapped_column(
        ForeignKey("members.id"), nullable=True, index=True
    )
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), nullable=True)


class PushSubscriptionRow(Base):
    """Подписка устройства на push-уведомления (Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)


class NativePushTokenRow(Base):
    """Push-токен Android-приложения из RuStore (RuStore Push SDK).

    Токен принадлежит тому, кто вошёл в приложение на этом телефоне; при входе другого
    человека он переписывается на него.
    """

    __tablename__ = "native_push_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    token: Mapped[str] = mapped_column(String(512), unique=True)
    provider: Mapped[str] = mapped_column(String(16), default="rustore")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)


class EventRow(Base):
    """Продуктовое событие — основа для DAU и «обращений на пользователя»."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(40), index=True)
    props: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
