"""Вход по номеру телефона через звонок и состояние аккаунта."""

import secrets
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from app.auth import CurrentAccount, DbSession, member_of
from app.models import AccountRow, PhoneCheckRow
from app.schemas.api import (
    AccountOut,
    MemberOut,
    PhoneCheckOut,
    PhoneCheckStatusOut,
    PhoneStartRequest,
)
from app.services import phone_auth, telemetry
from app.services.phone_auth import PhoneAuthError, ProviderUnavailableError
from app.services.telemetry import Kind

router = APIRouter(prefix="/api/v1", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/auth/phone/start", response_model=PhoneCheckOut, status_code=201)
def start_phone_check(payload: PhoneStartRequest, request: Request, db: DbSession) -> PhoneCheckOut:
    """Начать проверку: вернуть номер, на который нужно позвонить."""
    try:
        phone = phone_auth.normalize_phone(payload.phone)
    except PhoneAuthError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    now = datetime.now()
    ip = _client_ip(request)
    per_phone = db.scalar(
        select(func.count()).where(
            PhoneCheckRow.phone == phone,
            PhoneCheckRow.created_at >= now - phone_auth.PER_PHONE_LIMIT[1],
        )
    )
    per_ip = db.scalar(
        select(func.count()).where(
            PhoneCheckRow.ip == ip, PhoneCheckRow.created_at >= now - phone_auth.PER_IP_LIMIT[1]
        )
    )
    try:
        phone_auth.check_limits(per_phone or 0, (per_ip or 0) if ip else 0)
        started = phone_auth.get_verifier().start(phone)
    except ProviderUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except PhoneAuthError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc

    check = PhoneCheckRow(
        phone=phone,
        provider_check_id=started.provider_check_id,
        call_phone=started.call_phone,
        call_phone_pretty=started.call_phone_pretty,
        ip=ip,
    )
    db.add(check)
    db.commit()
    return PhoneCheckOut(
        check_id=check.id,
        call_phone=check.call_phone,
        call_phone_pretty=check.call_phone_pretty,
        phone_masked=phone_auth.mask_phone(phone),
        expires_in_s=int(phone_auth.CHECK_TTL.total_seconds()),
    )


@router.get("/auth/phone/status/{check_id}", response_model=PhoneCheckStatusOut)
def phone_check_status(check_id: str, db: DbSession) -> PhoneCheckStatusOut:
    """Опрос статуса (клиент спрашивает раз в 2–3 секунды). При подтверждении — токен."""
    check = db.get(PhoneCheckRow, check_id)
    if check is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Проверка не найдена")

    now = datetime.now()
    real_provider = False
    if check.status == "pending" and phone_auth.is_expired(check.created_at, now):
        check.status = "expired"
    elif check.status == "pending" and (
        check.last_polled_at is None or now - check.last_polled_at >= phone_auth.POLL_INTERVAL
    ):
        check.last_polled_at = now
        try:
            verifier = phone_auth.get_verifier()
            real_provider = isinstance(verifier, phone_auth.SmsRuVerifier)
            confirmed = verifier.is_confirmed(check.provider_check_id)
        except ProviderUnavailableError:
            confirmed = None  # провайдер моргнул — спросим в следующий раз
        if confirmed is True:
            check.status = "confirmed"
        elif confirmed is False:
            check.status = "expired"

    if check.status != "confirmed":
        db.commit()
        return PhoneCheckStatusOut(status=check.status)
    if check.consumed_at is not None:
        # По этой проверке сессия уже выдана — повторно токен не отдаём
        return PhoneCheckStatusOut(status="used")

    # Подтверждено: найти или создать аккаунт, выдать новую сессию
    account = db.scalar(select(AccountRow).where(AccountRow.phone == check.phone))
    if account is None:
        account = AccountRow(phone=check.phone)
        db.add(account)
    check.consumed_at = now
    account.token = phone_auth_token()
    account.last_login_at = now
    db.flush()
    member = member_of(db, account)
    if real_provider:  # имитация в разработке и тестах — не обращение к компоненту
        telemetry.record(
            Kind.PHONE_AUTH,
            "callcheck.confirmed",
            actor=telemetry.Actor(
                member.id if member else None, member.family_id if member else None
            ),
        )
    db.commit()
    return PhoneCheckStatusOut(status="confirmed", token=account.token)


def phone_auth_token() -> str:
    return secrets.token_urlsafe(32)


@router.get("/account", response_model=AccountOut)
def get_account(account: CurrentAccount, db: DbSession) -> AccountOut:
    member = member_of(db, account)
    return AccountOut(
        phone_masked=phone_auth.mask_phone(account.phone),
        member=MemberOut.model_validate(member) if member else None,
        family_id=member.family_id if member else None,
    )


@router.post("/auth/logout", status_code=204)
def logout(account: CurrentAccount, db: DbSession) -> None:
    account.token = phone_auth_token()  # старый токен перестаёт работать
    db.commit()
