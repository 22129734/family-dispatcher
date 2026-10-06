from datetime import datetime, time

import pytest

from app.schemas.family import Family, Member, TimeWindow
from app.schemas.task import TaskDraft
from app.services.allocator import Allocator, NoEligibleMemberError, invisible_labour_index


class StubClient:
    """Заглушка LLM: тесты движка распределения не должны ходить в сеть."""

    enabled = False

    def explain_assignment(self, task_title: str, assignee_name: str, reason: str) -> str:
        return f"{assignee_name}: {reason}"


@pytest.fixture
def allocator() -> Allocator:
    return Allocator(client=StubClient())


@pytest.fixture
def family() -> Family:
    return Family(
        id="f1",
        members=[
            Member(id="mom", name="Мама", weekly_load_minutes=480, has_car=True),
            Member(id="dad", name="Папа", weekly_load_minutes=120, has_car=True),
            Member(id="son", name="Сын", weekly_load_minutes=60, capacity_minutes=300),
        ],
    )


def test_task_goes_to_least_loaded_member(allocator: Allocator, family: Family) -> None:
    task = TaskDraft(title="Купить продукты", duration_minutes=60)

    assignment = allocator.allocate(family, task)

    assert assignment.assignee_id == "son"
    assert assignment.fairness_score > 0


def test_car_requirement_filters_out_members_without_car(
    allocator: Allocator, family: Family
) -> None:
    task = TaskDraft(title="Забрать Соню с танцев", duration_minutes=45, requires_car=True)

    assignment = allocator.allocate(family, task)

    assert assignment.assignee_id == "dad"


def test_capacity_overflow_excludes_member(allocator: Allocator, family: Family) -> None:
    task = TaskDraft(title="Генеральная уборка", duration_minutes=270)

    assignment = allocator.allocate(family, task)

    # У мамы и сына не хватает недельной ёмкости под задачу такого размера.
    assert assignment.assignee_id == "dad"


def test_busy_window_blocks_assignment(allocator: Allocator) -> None:
    monday_evening = datetime(2026, 9, 14, 19, 0)
    family = Family(
        id="f2",
        members=[
            Member(
                id="mom",
                name="Мама",
                weekly_load_minutes=0,
                busy_windows=[TimeWindow(weekday=0, start=time(18, 0), end=time(21, 0))],
            ),
            Member(id="dad", name="Папа", weekly_load_minutes=300),
        ],
    )
    task = TaskDraft(title="Проверить домашку", duration_minutes=30, due_at=monday_evening)

    assignment = allocator.allocate(family, task)

    assert assignment.assignee_id == "dad"


def test_no_eligible_member_raises(allocator: Allocator) -> None:
    family = Family(id="f3", members=[Member(id="mom", name="Мама", has_car=False)])
    task = TaskDraft(title="Отвезти бабушку к врачу", requires_car=True)

    with pytest.raises(NoEligibleMemberError):
        allocator.allocate(family, task)


def test_invisible_labour_index_sums_to_one(family: Family) -> None:
    index = invisible_labour_index(family)

    assert index["mom"] == pytest.approx(0.727, abs=0.001)
    assert sum(index.values()) == pytest.approx(1.0, abs=0.01)
