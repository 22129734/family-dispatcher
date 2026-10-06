"""Беспарольный вход для MVP.

Участник получает токен при создании семьи или при входе по ссылке-приглашению.
Клиент хранит токен у себя и передаёт в заголовке `Authorization: Bearer <token>`.
Перед публичным запуском заменить на СберID / вход по телефону.
"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import MemberRow
from app.services import telemetry


def current_member(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> MemberRow:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужна авторизация")
    token = authorization.split(" ", 1)[1].strip()
    member = db.scalar(select(MemberRow).where(MemberRow.token == token))
    if member is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия недействительна")
    telemetry.set_actor(member.id, member.family_id)
    return member


CurrentMember = Annotated[MemberRow, Depends(current_member)]
DbSession = Annotated[Session, Depends(get_db)]
