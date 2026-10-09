"""Кого считать в метриках конкурса.

По Положению (п. 5.1.3) не засчитывается активность участников и связанных с ними лиц.
Решение команды: исключаем аккаунты участников хакатона и их семей — они помечены
`accounts.is_team`. Все остальные считаются, кто бы их ни пригласил.

Реальный пользователь (п. 4.2.2) — выполнил хотя бы один целевой сценарий: взял или
сделал дело, ответил «Я помню», либо его поручение было выполнено.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountRow, EventRow, MemberRow, TaskRow

SCENARIO_EVENTS = ("task_accepted", "task_done", "task_remembered")


def team_member_ids(db: Session) -> set[str]:
    return set(
        db.scalars(
            select(MemberRow.id)
            .join(AccountRow, MemberRow.account_id == AccountRow.id)
            .where(AccountRow.is_team.is_(True))
        )
    )


def team_family_ids(db: Session) -> set[str]:
    return set(
        db.scalars(
            select(MemberRow.family_id)
            .join(AccountRow, MemberRow.account_id == AccountRow.id)
            .where(AccountRow.is_team.is_(True))
        )
    )


def real_users(db: Session) -> tuple[int, int]:
    """(реальные пользователи, из них — в семьях из двух и больше человек), без команды."""
    team = team_member_ids(db)
    doers = set(db.scalars(select(EventRow.member_id).where(EventRow.name.in_(SCENARIO_EVENTS))))
    authors = set(db.scalars(select(TaskRow.created_by_id).where(TaskRow.status == "done")))
    users = (doers | authors) - team
    if not users:
        return 0, 0
    members = db.scalars(select(MemberRow).where(MemberRow.id.in_(users))).all()
    in_pairs = sum(1 for m in members if len(m.family.members) > 1)
    return len(members), in_pairs
