from datetime import time

from pydantic import BaseModel, Field


class TimeWindow(BaseModel):
    weekday: int = Field(ge=0, le=6, description="0 — понедельник")
    start: time
    end: time


class Member(BaseModel):
    """Член семьи и его реальная доступность."""

    id: str
    name: str
    busy_windows: list[TimeWindow] = Field(default_factory=list)
    weekly_load_minutes: int = Field(default=0, description="Уже назначенная нагрузка на неделю")
    capacity_minutes: int = Field(default=600, description="Сколько человек готов взять на себя")
    has_car: bool = False
    dislikes: list[str] = Field(
        default_factory=list, description="Задачи, которых человек избегает"
    )


class Family(BaseModel):
    id: str
    members: list[Member]

    def member(self, member_id: str) -> Member | None:
        return next((m for m in self.members if m.id == member_id), None)
