"""Вход по номеру телефона и состояние аккаунта.

Первый вход — звонком (номер подтверждается). Сразу после него человек задаёт PIN-код
из 4 цифр, и дальше входит по номеру и PIN без звонка. Забыл PIN или ошибся 5 раз подряд —
снова звонок.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import delete, func, select

from app.auth import CurrentAccount, CurrentSession, DbSession, issue_session, member_of
from app.models import AccountRow, LoginAttemptRow, PhoneCheckRow, SessionRow
from app.schemas.api import (
    AccountOut,
    MemberOut,
    PhoneCheckOut,
    PhoneCheckStatusOut,
    PhoneStartRequest,
    PinLoginRequest,
    SetPinRequest,
    TokenOut,
)
from app.services import phone_auth, telemetry
from app.services.phone_auth import PhoneAuthError, ProviderUnavailableError
from app.services.telemetry import Kind

router = APIRouter(prefix="/api/v1", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/auth/phone/start", response_model=PhoneCheckOut, status_code=201)
def start_phone_check(payload: PhoneStartRequest, request: Request, db: DbSession) -> PhoneCheckOut:
    """Начать вход: у номера есть PIN-код — войти по нему; иначе номер, на который позвонить."""
    try:
        phone = phone_auth.normalize_phone(payload.phone)
    except PhoneAuthError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    now = datetime.now()
    account = db.scalar(select(AccountRow).where(AccountRow.phone == phone))
    if not payload.consent and (account is None or account.consent_at is None):
        # Согласие даётся один раз на номер; дальше вход без галочки на любом устройстве
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            "Отметьте согласие на обработку персональных данных",
        )
    if not payload.call:
        if (
            account is not None
            and account.pin_hash
            and not phone_auth.pin_locked(account.pin_locked_until, now)
        ):
            return PhoneCheckOut(method="pin", phone_masked=phone_auth.mask_phone(phone))

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
def phone_check_status(check_id: str, request: Request, db: DbSession) -> PhoneCheckStatusOut:
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

    # Подтверждено: найти или создать аккаунт, выдать сессию этому устройству
    account = db.scalar(select(AccountRow).where(AccountRow.phone == check.phone))
    if account is None:
        account = AccountRow(phone=check.phone)
        db.add(account)
        db.flush()
    check.consumed_at = now
    # Проверку по звонку создают только после согласия (см. start_phone_check)
    account.consent_at = account.consent_at or now
    # Номер подтверждён звонком — снимаем блокировку PIN после ошибок
    account.pin_failures = 0
    account.pin_locked_until = None
    token = issue_session(db, account, request.headers.get("user-agent"))
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
    return PhoneCheckStatusOut(status="confirmed", token=token)


@router.post("/auth/pin/login", response_model=TokenOut)
def pin_login(payload: PinLoginRequest, request: Request, db: DbSession) -> TokenOut:
    """Вход по номеру и PIN-коду. 5 ошибок подряд — 15 минут вход только звонком."""
    now = datetime.now()
    ip = _client_ip(request)
    if ip:
        failures_from_ip = db.scalar(
            select(func.count()).where(
                LoginAttemptRow.ip == ip,
                LoginAttemptRow.created_at >= now - phone_auth.PIN_IP_LIMIT[1],
            )
        )
        if (failures_from_ip or 0) >= phone_auth.PIN_IP_LIMIT[0]:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток — войдите звонком"
            )
    try:
        phone = phone_auth.normalize_phone(payload.phone)
    except PhoneAuthError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    account = db.scalar(select(AccountRow).where(AccountRow.phone == phone))
    if account is None or not account.pin_hash:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Для этого номера нет PIN-кода")
    if phone_auth.pin_locked(account.pin_locked_until, now):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток — войдите звонком"
        )

    if not phone_auth.verify_pin(payload.pin, account.pin_hash):
        account.pin_failures += 1
        db.add(LoginAttemptRow(ip=ip, phone=phone))
        left = phone_auth.PIN_MAX_FAILURES - account.pin_failures
        if left <= 0:
            account.pin_failures = 0
            account.pin_locked_until = now + phone_auth.PIN_LOCK
            db.commit()
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток — войдите звонком"
            )
        db.commit()
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, f"Неверный PIN-код. Осталось попыток: {left}"
        )

    account.pin_failures = 0
    token = issue_session(db, account, request.headers.get("user-agent"))
    db.commit()
    return TokenOut(token=token)


@router.post("/auth/pin", status_code=204)
def set_pin(payload: SetPinRequest, account: CurrentAccount, db: DbSession) -> None:
    """Задать или сменить PIN-код (только с подтверждённой сессии)."""
    account.pin_hash = phone_auth.hash_pin(payload.pin)
    account.pin_failures = 0
    account.pin_locked_until = None
    db.commit()


@router.get("/account", response_model=AccountOut)
def get_account(account: CurrentAccount, db: DbSession) -> AccountOut:
    member = member_of(db, account)
    return AccountOut(
        phone_masked=phone_auth.mask_phone(account.phone),
        has_pin=bool(account.pin_hash),
        member=MemberOut.model_validate(member) if member else None,
        family_id=member.family_id if member else None,
    )


@router.post("/auth/logout", status_code=204)
def logout(session: CurrentSession, db: DbSession) -> None:
    """Выход только на этом устройстве — остальные сессии продолжают работать."""
    db.execute(delete(SessionRow).where(SessionRow.id == session.id))
    db.commit()
