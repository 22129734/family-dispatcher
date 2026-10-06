"""Движок распределения задач между членами семьи.

Намеренно детерминированный: LLM отвечает за понимание языка и формулировки,
а за то, кому достанется задача, отвечает алгоритм. Иначе распределение
невозможно ни воспроизвести, ни объяснить, ни оспорить.

Кандидат отбрасывается жёсткими ограничениями (нужна машина, занят в это время),
оставшиеся ранжируются по взвешенной оценке: баланс нагрузки, запас ёмкости
и предпочтения человека.
"""

from datetime import datetime, timedelta

from app.schemas.family import Family, Member
from app.schemas.task import Assignment, TaskDraft
from app.services.llm_client import LLMClient

W_LOAD_BALANCE = 0.55
W_CAPACITY = 0.30
W_PREFERENCE = 0.15


class NoEligibleMemberError(RuntimeError):
    """Ни один член семьи не проходит жёсткие ограничения задачи."""


class Allocator:
    def __init__(self, client: LLMClient | None = None) -> None:
        self._client = client or LLMClient()

    def allocate(self, family: Family, task: TaskDraft) -> Assignment:
        eligible = [m for m in family.members if self._is_eligible(m, task)]
        if not eligible:
            raise NoEligibleMemberError(
                "Нет свободного исполнителя — нужно перенести задачу или снять ограничение"
            )

        scored = sorted(
            ((self._score(m, task, family), m) for m in eligible),
            key=lambda pair: pair[0],
            reverse=True,
        )
        best_score, winner = scored[0]

        reason = self._reason(winner, task, family)
        return Assignment(
            task=task,
            assignee_id=winner.id,
            fairness_score=round(best_score, 3),
            rationale=self._client.explain_assignment(task.title, winner.name, reason),
            alternatives=[member.id for _, member in scored[1:3]],
        )

    def _is_eligible(self, member: Member, task: TaskDraft) -> bool:
        if task.requires_car and not member.has_car:
            return False
        if member.weekly_load_minutes + task.duration_minutes > member.capacity_minutes:
            return False
        return self._is_free(member, task)

    @staticmethod
    def _is_free(member: Member, task: TaskDraft) -> bool:
        if task.due_at is None:
            return True

        start = task.due_at - timedelta(minutes=task.duration_minutes)
        weekday = task.due_at.weekday()
        for window in member.busy_windows:
            if window.weekday != weekday:
                continue
            busy_start = datetime.combine(task.due_at.date(), window.start)
            busy_end = datetime.combine(task.due_at.date(), window.end)
            if start < busy_end and task.due_at > busy_start:
                return False
        return True

    @staticmethod
    def _score(member: Member, task: TaskDraft, family: Family) -> float:
        total_load = sum(m.weekly_load_minutes for m in family.members) or 1
        fair_share = total_load / len(family.members)

        # Чем сильнее человек недогружен относительно среднего по семье, тем выше балл.
        relative_slack = (fair_share - member.weekly_load_minutes) / fair_share + 0.5
        load_balance = max(0.0, min(1.0, relative_slack))

        capacity_left = member.capacity_minutes - member.weekly_load_minutes
        capacity = max(0.0, min(1.0, capacity_left / member.capacity_minutes))

        disliked = any(word.lower() in task.title.lower() for word in member.dislikes)
        preference = 0.0 if disliked else 1.0

        return W_LOAD_BALANCE * load_balance + W_CAPACITY * capacity + W_PREFERENCE * preference

    @staticmethod
    def _reason(member: Member, task: TaskDraft, family: Family) -> str:
        average = sum(m.weekly_load_minutes for m in family.members) / len(family.members)
        if member.weekly_load_minutes < average:
            return "на этой неделе нагрузка ниже средней по семье, и в это время человек свободен"
        if task.requires_car:
            return "задача требует машины, и человек свободен в нужное время"
        return "это единственный свободный слот в расписании семьи"


def invisible_labour_index(family: Family) -> dict[str, float]:
    """Доля недельной нагрузки на каждого члена семьи — «индекс невидимого труда»."""
    total = sum(m.weekly_load_minutes for m in family.members)
    if total == 0:
        return {m.id: 0.0 for m in family.members}
    return {m.id: round(m.weekly_load_minutes / total, 3) for m in family.members}
