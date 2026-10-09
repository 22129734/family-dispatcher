"""Отзыв в поддержку из приложения: голосовое и/или текст уходят письмом на ящик команды."""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select

from app.auth import CurrentAccount, CurrentMember, DbSession
from app.models import EventRow
from app.services import family_service as fs
from app.services import support

router = APIRouter(prefix="/api/v1", tags=["support"])


@router.post("/support/feedback", status_code=202)
async def send_feedback(
    member: CurrentMember,
    account: CurrentAccount,
    db: DbSession,
    background: BackgroundTasks,
    text: Annotated[str | None, Form(max_length=2000)] = None,
    device: Annotated[str | None, Form(max_length=1000)] = None,
    audio: Annotated[UploadFile | None, File()] = None,
) -> dict[str, str]:
    sent_today = db.scalar(
        select(func.count()).where(
            EventRow.member_id == member.id,
            EventRow.name == "feedback_sent",
            EventRow.created_at >= datetime.now() - timedelta(days=1),
        )
    )
    if (sent_today or 0) >= support.DAILY_LIMIT:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Сегодня уже много сообщений — напишите завтра"
        )

    data: bytes | None = None
    content_type: str | None = None
    if audio is not None:
        data = await audio.read(support.MAX_AUDIO_BYTES + 1)
        content_type = (audio.content_type or "").split(";")[0].strip().lower()
        if len(data) > support.MAX_AUDIO_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Запись слишком длинная")
        if content_type not in support.AUDIO_TYPES or not data:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Не получилось прочитать запись"
            )
    text = (text or "").strip() or None
    if not data and not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Скажите или напишите, что не так"
        )

    fs.track(db, member, "feedback_sent", voice=bool(data), text=bool(text))
    db.commit()
    background.add_task(
        support.deliver,
        who=member.name,
        # Полный номер — чтобы поддержка могла перезвонить; письмо видит только команда
        phone=f"+{account.phone}",
        text=text,
        device=(device or "").strip() or None,
        audio=data,
        content_type=content_type,
    )
    return {"status": "accepted"}
