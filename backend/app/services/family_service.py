"""Задачи семьи: кому поручить по умолчанию, ответы исполнителя, события.

Исходная гипотеза о несправедливом распределении дел интервью не подтвердили
(0 из 20), поэтому движка «справедливого» распределения больше нет. Поручение
по умолчанию уходит второму взрослому — так задачи передают организаторы из
интервью; исполнителя можно сменить одним нажатием.

Ответы исполнителя («Беру», «Не могу», «Сделано») вызываются и из приложения,
и из кнопок push-уведомления, поэтому живут здесь, а не в роутерах.
"""

from datetime import datetime, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import ComponentCallRow, EventRow, FamilyRow, MemberRow, TaskRow
from app.schemas.task import TaskDraft
from app.services.when import plain_title

# Кто может брать поручения: взрослые и подростки
_DOERS = {"adult", "teen"}
_RECURRENCE_STEP = {
    "daily": relativedelta(days=1),
    "weekdays": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
}
# Повтор без срока: следующий раз — в 18:00
_DEFAULT_HOUR = 18


MIN_WEEK_TO_SHOW = 3


def week_stats(db: Session, family: FamilyRow, now: datetime | None = None) -> dict:
    """Итоги текущей недели (с понедельника): всего, по дням, по людям, «спасибо» и похвала."""
    now = now or datetime.now()
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    month_ago = monday - timedelta(weeks=4)
    done = db.scalars(
        select(TaskRow).where(
            TaskRow.family_id == family.id,
            TaskRow.status == "done",
            TaskRow.completed_at >= month_ago,
        )
    ).all()
    week = [t for t in done if t.completed_at >= monday]
    by_day = [0] * 7
    for task in week:
        by_day[task.completed_at.weekday()] += 1
    thanked = db.scalars(
        select(TaskRow).where(TaskRow.family_id == family.id, TaskRow.thanked_at >= monday)
    ).all()
    members = [
        {
            "member_id": m.id,
            "done": sum(1 for t in week if t.assignee_id == m.id),
            "thanks": sum(1 for t in thanked if t.assignee_id == m.id),
        }
        for m in family.members
    ]

    # Похвала — первая подходящая; без сравнения людей между собой
    previous = [
        sum(
            1
            for t in done
            if monday - timedelta(weeks=k) <= t.completed_at < monday - timedelta(weeks=k - 1)
        )
        for k in range(1, 5)
    ]
    overdue = db.scalar(
        select(func.count()).where(
            TaskRow.family_id == family.id,
            TaskRow.status != "done",
            TaskRow.due_at < now,
        )
    )
    days_with_done = {t.completed_at.date() for t in done}
    streak = 0
    day = now.date() if now.date() in days_with_done else now.date() - timedelta(days=1)
    while day in days_with_done:
        streak += 1
        day -= timedelta(days=1)
    total = len(week)
    if total and any(previous) and total > max(previous):
        praise = "Лучшая неделя за месяц — можно и мороженку 🍦"
    elif streak >= 3:
        praise = f"{streak} {_days(streak)} подряд — каждый день что-то сделано"
    elif total and not overdue:
        praise = "Ни одного просроченного дела — так держать"
    elif len(thanked) >= 2:
        praise = f"{len(thanked)} «спасибо» за неделю 💜"
    else:
        praise = "Каждое сделанное дело — минус забота для семьи"
    return {
        "total": total,
        "by_day": by_day,
        "members": members,
        "thanks": len(thanked),
        "praise": praise,
        "show": total >= MIN_WEEK_TO_SHOW,
    }


def _days(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "день"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "дня"
    return "дней"


def thank(task: TaskRow, member: MemberRow) -> bool:
    """«Спасибо» за сделанное: только автор и только чужое выполненное дело. True — впервые."""
    if task.status != "done":
        raise TaskActionError(409, "Спасибо можно сказать за сделанное дело")
    if task.created_by_id != member.id or task.assignee_id in (None, member.id):
        raise TaskActionError(403, "Спасибо говорит тот, кто просил, — тому, кто сделал")
    if task.thanked_at:
        return False
    task.thanked_at = datetime.now()
    return True


def move_to_family(db: Session, member: MemberRow, target: FamilyRow) -> None:
    """Перейти в семью по приглашению, когда своя семья уже есть («муж зашёл не по той ссылке»).

    Можно, только если в своей семье человек один (дети без входа переезжают с ним):
    его дела, события и рекомендации переезжают, пустая семья удаляется.
    """
    old = member.family
    if old.id == target.id:
        return
    if any(m.id != member.id and m.account_id for m in old.members):
        raise TaskActionError(
            409,
            "В вашей семье есть другие люди — переход разделил бы вас. Напишите нам, поможем",
        )
    db.execute(update(TaskRow).where(TaskRow.family_id == old.id).values(family_id=target.id))
    db.execute(update(EventRow).where(EventRow.family_id == old.id).values(family_id=target.id))
    db.execute(
        update(ComponentCallRow)
        .where(ComponentCallRow.family_id == old.id)
        .values(family_id=target.id)
    )
    db.execute(
        update(FamilyRow).where(FamilyRow.referred_by_id == old.id).values(referred_by_id=target.id)
    )
    for mover in list(old.members):
        target.members.append(mover)
    db.flush()
    db.delete(old)
    db.flush()


def frequent(db: Session, member: MemberRow, days: int = 90, limit: int = 5):
    """Дела, которые человек просит снова и снова в разные дни: (название, сколько раз, образец).

    Повторяющиеся по расписанию не берём — они и так создаются сами.
    """
    since = datetime.now() - timedelta(days=days)
    rows = db.scalars(
        select(TaskRow)
        .where(
            TaskRow.created_by_id == member.id,
            TaskRow.created_at >= since,
            TaskRow.recurrence == "none",
        )
        .order_by(TaskRow.created_at.desc())
    ).all()
    groups: dict[str, list[TaskRow]] = {}
    titles: dict[str, str] = {}
    for task in rows:
        title = plain_title(task.title)
        key = title.lower()
        groups.setdefault(key, []).append(task)
        titles.setdefault(key, title)
    ranked = sorted(
        (key for key, tasks in groups.items() if len(tasks) >= 2),
        key=lambda key: (-len(groups[key]), -groups[key][0].created_at.timestamp()),
    )
    # Образец — последнее такое дело со временем: подставим привычное время и продолжительность
    return [
        (titles[key], len(groups[key]), next((t for t in groups[key] if t.due_at), groups[key][0]))
        for key in ranked[:limit]
    ]


def next_due(due_at: datetime | None, recurrence: str, now: datetime) -> datetime | None:
    """Срок следующего повтора: шагаем от прежнего срока, пока не окажемся в будущем."""
    step = _RECURRENCE_STEP.get(recurrence)
    if step is None:
        return None
    due = due_at or now.replace(hour=_DEFAULT_HOUR, minute=0, second=0, microsecond=0)
    due += step
    while due <= now or (recurrence == "weekdays" and due.weekday() >= 5):
        due += step if recurrence != "weekdays" else relativedelta(days=1)
    return due


class TaskActionError(Exception):
    """Действие недоступно: (код HTTP, сообщение)."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


def default_assignee(
    family: FamilyRow, author: MemberRow, requires_car: bool = False
) -> tuple[MemberRow | None, str | None]:
    """Исполнитель по умолчанию и короткое пояснение; (None, None) — пусть выберет автор."""
    others = [m for m in family.members if m.id != author.id and m.role in _DOERS]
    if not others:
        return author, "Пока в семье только вы — пригласите близких во вкладке «Семья»"
    if requires_car:
        drivers = [m for m in others if m.has_car]
        if len(drivers) == 1:
            return drivers[0], "Есть машина"
    adults = [m for m in others if m.role == "adult"]
    if len(adults) == 1:
        return adults[0], None
    return None, None


def assignee_for(
    family: FamilyRow, author: MemberRow, draft: TaskDraft
) -> tuple[MemberRow | None, str | None]:
    """Кому поручить: явно сказанное в сообщении важнее правила «второму взрослому»."""
    if draft.assignee == "self":
        return author, None
    if draft.assignee:
        wanted = draft.assignee.strip().lower()
        for member in family.members:
            if member.name.strip().lower() == wanted:
                return member, None
    return default_assignee(family, author, draft.requires_car)


_RELATIONS = {
    "spouse": ("муж", "жена", "супруг", "супруга"),
    "child": ("сын", "дочь", "дочка", "ребёнок", "ребенок"),
}


def resolve_participants(
    family: FamilyRow, author: MemberRow, refs: list[str], assignee_id: str | None
) -> list[str]:
    """«self», имя или «муж» / «сын» → id членов семьи; без исполнителя и повторов.

    Родство угадываем, только когда оно однозначно: один второй взрослый — «муж»,
    один ребёнок или подросток — «сын».
    """
    others = [m for m in family.members if m.id != author.id]
    adults = [m for m in others if m.role == "adult"]
    kids = [m for m in others if m.role in ("child", "teen")]
    ids: list[str] = []
    for ref in refs:
        word = ref.strip().lower()
        found: MemberRow | None = None
        if word == "self":
            found = author
        elif any(word.startswith(r) for r in _RELATIONS["spouse"]):
            found = adults[0] if len(adults) == 1 else None
        elif any(word.startswith(r) for r in _RELATIONS["child"]):
            found = kids[0] if len(kids) == 1 else None
        else:
            for m in family.members:
                name = m.name.strip().lower()
                stem = name[:-1] if len(name) > 3 else name
                if word == name or (len(name) > 3 and word.startswith(stem)):
                    found = m
                    break
        if found and found.id != assignee_id and found.id not in ids:
            ids.append(found.id)
    return ids


def task_from_draft(draft: TaskDraft, family: FamilyRow, author: MemberRow) -> TaskRow:
    return TaskRow(
        family_id=family.id,
        created_by_id=author.id,
        title=draft.title,
        beneficiary=draft.beneficiary,
        due_at=draft.due_at,
        duration_minutes=draft.duration_minutes,
        ends_at=draft.ends_at,
        priority=draft.priority.value,
        recurrence=draft.recurrence.value,
        requires_car=draft.requires_car,
        location=draft.location,
        clarifying_question=draft.clarifying_question,
        items=[{"text": text, "done": False} for text in draft.items],
        note=draft.note,
        participants=[],
    )


def assign(task: TaskRow, assignee: MemberRow | None, author: MemberRow, why: str | None) -> None:
    """Назначить исполнителя: поручение себе сразу «взято», остальным — ждёт ответа."""
    task.assignee_id = assignee.id if assignee else None
    task.rationale = why
    task.decline_reason = None
    if assignee is not None and assignee.id == author.id:
        task.status = "accepted"
    else:
        task.status = "new"
        task.accepted_at = None


def accept(task: TaskRow, member: MemberRow) -> bool:
    """«Беру». True — статус изменился (нужно уведомить автора)."""
    if task.assignee_id != member.id:
        raise TaskActionError(403, "Это просьба к другому человеку")
    if task.status != "new":
        return False
    task.status = "accepted"
    task.accepted_at = datetime.now()
    return True


def remember(task: TaskRow, member: MemberRow) -> bool:
    """«Я помню» на напоминании: исполнитель подтвердил, что дело в силе.

    Если поручение ещё ждало ответа, «помню» означает и «беру».
    """
    if task.assignee_id != member.id:
        raise TaskActionError(403, "Это просьба к другому человеку")
    if task.status == "done":
        return False
    now = datetime.now()
    task.remembered_at = now
    if task.status == "new":
        task.status = "accepted"
        task.accepted_at = now
    return True


def decline(task: TaskRow, member: MemberRow, reason: str | None) -> None:
    """«Не могу»: задача возвращается автору без исполнителя, с причиной."""
    if task.assignee_id != member.id:
        raise TaskActionError(403, "Это просьба к другому человеку")
    if task.status == "done":
        raise TaskActionError(409, "Задача уже сделана")
    reason = (reason or "").strip()
    task.assignee_id = None
    task.status = "new"
    task.accepted_at = None
    task.rationale = None
    task.decline_reason = f"{member.name} не может" + (f": {reason}" if reason else "")


def complete(db: Session, task: TaskRow, member: MemberRow) -> bool:
    """«Сделано». True — статус изменился. Повторяющаяся задача порождает следующую."""
    if task.status == "done":
        return False
    if task.assignee_id not in (None, member.id) and task.created_by_id != member.id:
        raise TaskActionError(403, "Отметить может исполнитель или автор")
    now = datetime.now()
    if task.assignee_id is None:
        task.assignee_id = member.id
    task.status = "done"
    task.completed_at = now
    task.accepted_at = task.accepted_at or now
    task.feedback = None  # замечание «не выполнено» снято — дело сделано заново

    due = next_due(task.due_at, task.recurrence, now)
    if due is not None:
        # Следующая — тому же исполнителю, снова ждёт ответа
        members = {m.id: m for m in member.family.members}
        next_task = TaskRow(
            family_id=task.family_id,
            created_by_id=task.created_by_id,
            title=task.title,
            source=task.source,
            beneficiary=task.beneficiary,
            due_at=due,
            duration_minutes=task.duration_minutes,
            # Та же продолжительность: «подготовка к школе 9–10» каждый будний день
            ends_at=due + (task.ends_at - task.due_at) if task.ends_at and task.due_at else None,
            priority=task.priority,
            recurrence=task.recurrence,
            requires_car=task.requires_car,
            location=task.location,
            # Тот же список покупок — снова не отмеченный
            items=[{"text": item["text"], "done": False} for item in task.items or []],
            note=task.note,
            participants=list(task.participants or []),
        )
        assign(
            next_task, members.get(task.assignee_id), members[task.created_by_id], task.rationale
        )
        db.add(next_task)
    return True


def reject(db: Session, task: TaskRow, member: MemberRow, comment: str | None) -> None:
    """«Не выполнено»: автор возвращает сделанное исполнителю с комментарием.

    Задача снова «взята» тем же человеком. Если это был повтор, уже созданный следующий
    повтор убираем — иначе в списке окажутся два одинаковых дела.
    """
    if task.created_by_id != member.id:
        raise TaskActionError(403, "Вернуть может только тот, кто просил")
    if task.status != "done":
        raise TaskActionError(409, "Задача ещё не отмечена сделанной")
    if task.assignee_id in (None, member.id):
        raise TaskActionError(409, "Это ваше дело — просто верните его в работу")
    if task.recurrence != "none" and task.completed_at is not None:
        spawned = db.scalars(
            select(TaskRow).where(
                TaskRow.family_id == task.family_id,
                TaskRow.title == task.title,
                TaskRow.recurrence == task.recurrence,
                TaskRow.status != "done",
                TaskRow.id != task.id,
                TaskRow.created_at >= task.completed_at - timedelta(seconds=5),
            )
        ).all()
        for extra in spawned:
            db.delete(extra)
    now = datetime.now()
    task.status = "accepted"
    task.completed_at = None
    task.accepted_at = task.accepted_at or now
    task.feedback = (comment or "").strip() or None
    task.feedback_at = now
    task.reminded_at = None
    task.remembered_at = None


def track(db: Session, member: MemberRow, name: str, **props: object) -> None:
    db.add(EventRow(member_id=member.id, family_id=member.family_id, name=name, props=props))
