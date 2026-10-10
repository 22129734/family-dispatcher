"""Удаление аккаунта по просьбе человека (152-ФЗ, отзыв согласия).

Удаляем всё, что относится к человеку: телефон, PIN, сессии, его просьбы с файлами,
события и подписки на уведомления. Дела, которые ему поручили другие, возвращаются
авторам. Если в семье больше никто не входит по телефону — удаляется вся семья.
"""

import logging

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import (
    AccountRow,
    ComponentCallRow,
    EventRow,
    FamilyRow,
    LoginAttemptRow,
    MemberRow,
    PhoneCheckRow,
    PushSubscriptionRow,
    SessionRow,
    TaskFileRow,
    TaskRow,
)
from app.services import files

logger = logging.getLogger(__name__)


def _drop_tasks(db: Session, tasks: list[TaskRow]) -> None:
    for task in tasks:
        for row in task.files:
            files.remove(row)
        db.delete(task)


def _drop_members(db: Session, member_ids: list[str]) -> None:
    if not member_ids:
        return
    db.execute(delete(PushSubscriptionRow).where(PushSubscriptionRow.member_id.in_(member_ids)))
    db.execute(delete(EventRow).where(EventRow.member_id.in_(member_ids)))
    db.execute(
        update(ComponentCallRow)
        .where(ComponentCallRow.member_id.in_(member_ids))
        .values(member_id=None)
    )
    db.execute(delete(MemberRow).where(MemberRow.id.in_(member_ids)))


def delete_account(db: Session, account: AccountRow) -> None:
    member = db.scalar(select(MemberRow).where(MemberRow.account_id == account.id))
    if member is not None:
        family = member.family
        others = [m for m in family.members if m.id != member.id and m.account_id]
        if not others:
            _delete_family(db, family)
        else:
            _leave_family(db, member)
    phone = account.phone
    db.execute(delete(SessionRow).where(SessionRow.account_id == account.id))
    db.execute(delete(PhoneCheckRow).where(PhoneCheckRow.phone == phone))
    db.execute(delete(LoginAttemptRow).where(LoginAttemptRow.phone == phone))
    db.delete(account)
    db.commit()
    logger.info("account deleted on request")


def _leave_family(db: Session, member: MemberRow) -> None:
    family_tasks = db.scalars(select(TaskRow).where(TaskRow.family_id == member.family_id)).all()
    # Его просьбы — удаляем вместе с файлами
    _drop_tasks(db, [t for t in family_tasks if t.created_by_id == member.id])
    for task in family_tasks:
        if task.created_by_id == member.id:
            continue
        if task.assignee_id == member.id:
            # Поручено ему — возвращаем автору: пусть выберет, кто сделает
            task.assignee_id = None
            if task.status != "done":
                task.status = "new"
                task.accepted_at = None
                task.decline_reason = f"{member.name} удалил(а) аккаунт"
        if member.id in (task.participants or []):
            task.participants = [i for i in task.participants if i != member.id]
    # Файлы, которые он прикрепил к чужим делам
    for row in db.scalars(select(TaskFileRow).where(TaskFileRow.uploaded_by_id == member.id)).all():
        files.remove(row)
        db.delete(row)
    db.flush()
    _drop_members(db, [member.id])


def _delete_family(db: Session, family: FamilyRow) -> None:
    _drop_tasks(db, db.scalars(select(TaskRow).where(TaskRow.family_id == family.id)).all())
    db.flush()
    _drop_members(db, [m.id for m in family.members])
    db.execute(delete(EventRow).where(EventRow.family_id == family.id))
    db.execute(
        update(ComponentCallRow)
        .where(ComponentCallRow.family_id == family.id)
        .values(family_id=None)
    )
    db.execute(
        update(FamilyRow).where(FamilyRow.referred_by_id == family.id).values(referred_by_id=None)
    )
    db.execute(delete(FamilyRow).where(FamilyRow.id == family.id))
