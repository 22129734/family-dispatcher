"""Фоновая система напоминаний: за N минут до срока — push исполнителю.

N — личная настройка участника (`remind_before_min`, по умолчанию час, 0 — не напоминать).
Одно напоминание на задачу; после смены срока или исполнителя оно отправится заново.
Работает отдельным процессом (сервис `worker` в docker-compose):

    python -m app.workers.reminders

Каждое срабатывание пишется в журнал обращений как фоновая система (`reminder`),
доставка — как `push`.
"""

import logging
import time
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import MemberRow, TaskRow
from app.services import notifications, telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

TICK_S = 60
# Напоминания о сроке, который уже прошёл, не шлём — это уже другая история (эскалация)
_LOOKAHEAD = timedelta(days=1, minutes=5)


def due_reminders(db: Session, now: datetime) -> list[tuple[TaskRow, MemberRow]]:
    """Задачи, о которых пора напомнить исполнителю."""
    candidates = db.scalars(
        select(TaskRow).where(
            TaskRow.status.in_(("new", "accepted")),
            TaskRow.assignee_id.is_not(None),
            TaskRow.due_at.is_not(None),
            TaskRow.reminded_at.is_(None),
            TaskRow.due_at > now,
            TaskRow.due_at <= now + _LOOKAHEAD,
        )
    ).all()
    result = []
    for task in candidates:
        member = db.get(MemberRow, task.assignee_id)
        if member is None or member.remind_before_min <= 0:
            continue
        if task.due_at - timedelta(minutes=member.remind_before_min) <= now:
            result.append((task, member))
    return result


def run_once(now: datetime | None = None) -> int:
    """Отправить все созревшие напоминания. Возвращает число задач."""
    now = now or datetime.now()
    with SessionLocal() as db:
        due = due_reminders(db, now)
        for task, member in due:
            message = notifications.reminder_message(task, now)
            task.reminded_at = now
            db.commit()  # отмечаем до отправки: сбой доставки не должен слать повторы
            telemetry.record(
                Kind.REMINDER, "before_due", actor=telemetry.Actor(member.id, member.family_id)
            )
            notifications.deliver(member.id, message)
        return len(due)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger.info("Напоминания: проверка раз в %s с", TICK_S)
    while True:
        try:
            sent = run_once()
            if sent:
                logger.info("Отправлено напоминаний: %s", sent)
        except Exception:
            logger.exception("Сбой цикла напоминаний")
        time.sleep(TICK_S)


if __name__ == "__main__":
    main()
