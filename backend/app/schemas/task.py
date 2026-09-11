from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class Recurrence(StrEnum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class TaskDraft(BaseModel):
    """Задача, извлечённая из свободной речи, до назначения исполнителя."""

    title: str = Field(description="Что нужно сделать")
    beneficiary: str | None = Field(default=None, description="Для кого делается задача")
    due_at: datetime | None = Field(default=None, description="Крайний срок")
    duration_minutes: int = Field(default=30, ge=5, le=600)
    priority: Priority = Priority.NORMAL
    recurrence: Recurrence = Recurrence.NONE
    requires_car: bool = False
    location: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    clarifying_question: str | None = Field(
        default=None,
        description="Единственный уточняющий вопрос, если задача разобрана неоднозначно",
    )


class Assignment(BaseModel):
    """Результат работы движка распределения."""

    task: TaskDraft
    assignee_id: str
    fairness_score: float = Field(description="Насколько назначение выравнивает нагрузку, 0..1")
    rationale: str = Field(description="Объяснение, почему задача ушла этому человеку")
    alternatives: list[str] = Field(default_factory=list)
