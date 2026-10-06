from datetime import date, datetime

import pytest

from app.schemas.task import Priority, Recurrence
from app.services.task_extractor import TaskExtractor


class OfflineClient:
    """LLM недоступна — проверяем детерминированный резервный разбор."""

    enabled = False

    def extract_task(self, message: str, now_iso: str) -> None:
        return None


class StubLLM:
    enabled = True

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def extract_task(self, message: str, now_iso: str) -> dict:
        return self._payload


NOW = datetime(2026, 9, 11, 10, 0)


@pytest.fixture
def offline_extractor() -> TaskExtractor:
    return TaskExtractor(client=OfflineClient())


def test_relative_date_and_hour_are_parsed(offline_extractor: TaskExtractor) -> None:
    task = offline_extractor.extract("завтра забрать Соню с танцев в 19", now=NOW)

    assert task.due_at == datetime(2026, 9, 12, 19, 0)
    assert task.requires_car is True


def test_urgency_marker_raises_priority(offline_extractor: TaskExtractor) -> None:
    task = offline_extractor.extract("срочно сегодня оплатить садик", now=NOW)

    assert task.priority is Priority.HIGH


def test_recurrence_is_detected(offline_extractor: TaskExtractor) -> None:
    task = offline_extractor.extract("выносить мусор каждый день", now=NOW)

    assert task.recurrence is Recurrence.DAILY


def test_missing_date_produces_clarifying_question(offline_extractor: TaskExtractor) -> None:
    task = offline_extractor.extract("записать бабушку к врачу", now=NOW)

    assert task.due_at is None
    assert task.clarifying_question


def test_llm_payload_is_mapped_to_draft() -> None:
    extractor = TaskExtractor(
        client=StubLLM(
            {
                "title": "Забрать Соню с танцев",
                "beneficiary": "Соня",
                "due_at": "2026-09-12T19:00:00",
                "duration_minutes": 45,
                "priority": "high",
                "requires_car": True,
            }
        )
    )

    task = extractor.extract("завтра забрать Соню с танцев в семь", now=NOW)

    assert task.beneficiary == "Соня"
    assert task.due_at == datetime(2026, 9, 12, 19, 0)
    assert task.duration_minutes == 45
    assert task.priority is Priority.HIGH
    assert task.confidence == pytest.approx(0.95)


def test_llm_due_at_with_timezone_is_treated_as_local_time() -> None:
    extractor = TaskExtractor(
        client=StubLLM({"title": "Забрать ребёнка с танцев", "due_at": "2026-10-07T19:00:00Z"})
    )
    draft = extractor.extract("завтра в 7 забрать с танцев", NOW)
    assert draft.due_at is not None
    assert draft.due_at.tzinfo is None
    assert (draft.due_at.hour, draft.due_at.minute) == (19, 0)


def test_rules_fill_what_llm_missed() -> None:
    extractor = TaskExtractor(client=StubLLM({"title": "Купить подгузники"}))
    draft = extractor.extract("завтра купи подгузники, срочно", NOW)
    assert draft.priority == Priority.HIGH
    assert draft.due_at is not None and draft.due_at.date() == date(2026, 9, 12)
    assert draft.clarifying_question is None


def test_llm_values_win_over_rules() -> None:
    extractor = TaskExtractor(
        client=StubLLM({"title": "Полить цветы", "recurrence": "weekly", "priority": "low"})
    )
    draft = extractor.extract("каждый день полить цветы", NOW)
    assert draft.recurrence == Recurrence.WEEKLY
    assert draft.priority == Priority.LOW
