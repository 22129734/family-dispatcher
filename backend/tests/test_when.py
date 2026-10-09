"""Сроки из разговорных фраз: время суток, дни недели, «послезавтра»."""

from datetime import datetime

import pytest

from app.schemas.task import TaskDraft
from app.services.task_extractor import TaskExtractor
from app.services.when import due_from_text, end_from_text

FRIDAY_4PM = datetime(2026, 10, 9, 16, 20)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("после работы мне нужно забрать авито", datetime(2026, 10, 9, 19, 0)),
        ("вечером купить хлеб", datetime(2026, 10, 9, 19, 0)),
        ("утром позвонить маме", datetime(2026, 10, 10, 9, 0)),  # утро уже прошло — завтра
        ("в 19 забрать Машу", datetime(2026, 10, 9, 19, 0)),
        ("в 7:30 отвести в школу", datetime(2026, 10, 10, 7, 30)),
        ("в 7 вечером погулять", datetime(2026, 10, 9, 19, 0)),
        ("завтра в 10 оплатить кружок", datetime(2026, 10, 10, 10, 0)),
        ("послезавтра сдать отчёт", datetime(2026, 10, 11, 18, 0)),  # не «завтра»
        ("в субботу забрать посылку", datetime(2026, 10, 10, 18, 0)),
        ("в пятницу в 9 забрать", datetime(2026, 10, 16, 9, 0)),  # сегодняшние 9 уже прошли
        ("в среду полить цветы", datetime(2026, 10, 14, 18, 0)),
        ("перед сном выпить таблетку", datetime(2026, 10, 9, 21, 0)),
        ("купить хлеб", None),
    ],
)
def test_due_from_text(text: str, expected: datetime | None) -> None:
    assert due_from_text(text, FRIDAY_4PM) == expected


class SilentLLM:
    """Модель вернула только название — без срока и без вопроса (так было с «Авито»)."""

    enabled = True

    def extract_task(self, *args: object) -> dict:
        return {"title": "Забрать заказ Авито", "assignee": "self"}


def test_rules_fill_due_when_llm_skips_it() -> None:
    draft = TaskExtractor(client=SilentLLM()).extract(
        "после работы мне нужно забрать авито", now=FRIDAY_4PM
    )
    assert draft.due_at == datetime(2026, 10, 9, 19, 0)
    assert draft.clarifying_question is None


def test_question_asked_when_nobody_understood_due() -> None:
    draft: TaskDraft = TaskExtractor(client=SilentLLM()).extract("забрать авито", now=FRIDAY_4PM)
    assert draft.due_at is None
    assert draft.clarifying_question == "На какой день поставить эту задачу?"


@pytest.mark.parametrize(
    ("text", "start", "end"),
    [
        ("завтра подготовка к школе с 9 до 10", (10, 9, 0), (10, 10, 0)),
        ("завтра подготовка к школе с 9-10", (10, 9, 0), (10, 10, 0)),
        ("в субботу уборка 10–12", (10, 10, 0), (10, 12, 0)),
        ("завтра с 9:30 по 11 бассейн", (10, 9, 30), (10, 11, 0)),
        ("завтра с 11 до 1 прогулка", (10, 11, 0), (10, 13, 0)),
        ("в 18 тренировка на полтора часа", (9, 18, 0), (9, 19, 30)),
        ("завтра в 10 уроки на час", (10, 10, 0), (10, 11, 0)),
        ("завтра в 10 созвон на 40 минут", (10, 10, 0), (10, 10, 40)),
        ("забрать посылку до 19", (9, 19, 0), None),  # «до» без «с» — это срок, не промежуток
        ("позвонить +7 900-123-45-67 завтра", (10, 18, 0), None),
    ],
)
def test_span_from_text(text: str, start: tuple, end: tuple | None) -> None:
    due = due_from_text(text, FRIDAY_4PM)
    assert due == datetime(2026, 10, *start)
    assert end_from_text(text, due) == (datetime(2026, 10, *end) if end else None)


class EndAsStartLLM:
    """Модель приняла «до 10» за срок и не заполнила окончание."""

    enabled = True

    def extract_task(self, *args: object) -> dict:
        return {"title": "Подготовка к школе", "due_at": "2026-10-10T10:00:00"}


def test_rules_fix_range_when_llm_takes_end_as_due() -> None:
    draft = TaskExtractor(client=EndAsStartLLM()).extract(
        "завтра подготовка к школе с 9 до 10", now=FRIDAY_4PM
    )
    assert (draft.due_at, draft.ends_at) == (
        datetime(2026, 10, 10, 9, 0),
        datetime(2026, 10, 10, 10, 0),
    )


class RangeLLM:
    enabled = True

    def extract_task(self, *args: object) -> dict:
        return {
            "title": "Подготовка к школе",
            "due_at": "2026-10-10T09:00:00",
            "ends_at": "2026-10-10T08:00:00",  # раньше начала — отбрасываем, берём правила
        }


def test_llm_end_before_start_is_ignored() -> None:
    draft = TaskExtractor(client=RangeLLM()).extract(
        "завтра подготовка к школе с 9 до 10", now=FRIDAY_4PM
    )
    assert draft.ends_at == datetime(2026, 10, 10, 10, 0)
