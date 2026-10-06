"""Сессии: человек входит по номеру телефона (звонок), получает токен аккаунта.

Клиент передаёт токен в заголовке `Authorization: Bearer <token>`. Аккаунт без семьи
может только создать семью или войти по приглашению; остальные эндпоинты требуют
участника семьи (`CurrentMember`).
"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AccountRow, MemberRow
from app.services import telemetry


def current_account(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> AccountRow:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужна авторизация")
    token = authorization.split(" ", 1)[1].strip()
    account = db.scalar(select(AccountRow).where(AccountRow.token == token))
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


CurrentAccount = Annotated[AccountRow, Depends(current_account)]
CurrentMember = Annotated[MemberRow, Depends(current_member)]
DbSession = Annotated[Session, Depends(get_db)]
