"""Сессии: человек входит по номеру телефона (звонок или PIN-код) и получает токен сессии.

Клиент передаёт токен в заголовке `Authorization: Bearer <token>`. У аккаунта может быть
несколько сессий — по одной на устройство или браузер; вход на новом устройстве не выбивает
остальные. Аккаунт без семьи может только создать семью или войти по приглашению; остальные
эндпоинты требуют участника семьи (`CurrentMember`).
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AccountRow, MemberRow, SessionRow
from app.services import telemetry

# Отметку «последнее использование» обновляем не чаще раза в час — без записи на каждый запрос
_TOUCH_EVERY = timedelta(hours=1)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_session(db: Session, account: AccountRow, user_agent: str | None) -> str:
    """Новая сессия для устройства; возвращает токен (в базе — только его хэш)."""
    token = secrets.token_urlsafe(32)
    db.add(
        SessionRow(
            account_id=account.id,
            token_hash=token_hash(token),
            user_agent=(user_agent or "")[:300] or None,
        )
    )
    account.last_login_at = datetime.now()
    return token


def bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


def current_session(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> SessionRow:
    token = bearer(authorization)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужна авторизация")
    session = db.scalar(select(SessionRow).where(SessionRow.token_hash == token_hash(token)))
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия недействительна")
    now = datetime.now()
    if now - session.last_used_at >= _TOUCH_EVERY:
        session.last_used_at = now
        db.commit()
    return session


def current_token(authorization: Annotated[str | None, Header()] = None) -> str:
    """Токен текущего запроса — чтобы вернуть его клиенту в ответе с сессией."""
    token = bearer(authorization)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужна авторизация")
    return token


def current_account(
    db: Annotated[Session, Depends(get_db)],
    session: Annotated[SessionRow, Depends(current_session)],
) -> AccountRow:
    account = db.get(AccountRow, session.account_id)
    if account is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия недействительна")
    return account


def member_of(db: Session, account: AccountRow) -> MemberRow | None:
    return db.scalar(select(MemberRow).where(MemberRow.account_id == account.id))


def current_member(
    db: Annotated[Session, Depends(get_db)],
    account: Annotated[AccountRow, Depends(current_account)],
) -> MemberRow:
    member = member_of(db, account)
    if member is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Сначала создайте семью или войдите по приглашению"
        )
    telemetry.set_actor(member.id, member.family_id)
    return member


CurrentToken = Annotated[str, Depends(current_token)]
CurrentSession = Annotated[SessionRow, Depends(current_session)]
CurrentAccount = Annotated[AccountRow, Depends(current_account)]
CurrentMember = Annotated[MemberRow, Depends(current_member)]
DbSession = Annotated[Session, Depends(get_db)]
