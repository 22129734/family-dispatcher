"""Клиент LLM (OpenAI-совместимый API) и учёт обращений к компонентам — без сети."""

import json

import httpx
import pytest
from sqlalchemy import select

from app.config import Settings
from app.db import Base, SessionLocal, engine
from app.models import ComponentCallRow
from app.services import telemetry
from app.services.llm_client import LLMClient


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    telemetry.set_actor(None, None)
    yield


def make_client(handler) -> LLMClient:
    client = LLMClient(transport=httpx.MockTransport(handler))
    client._settings = Settings(
        llm_base_url="https://llm.test/v1", llm_api_key="key", llm_model="test-model"
    )
    return client


def calls() -> list[ComponentCallRow]:
    with SessionLocal() as session:
        return list(session.scalars(select(ComponentCallRow).order_by(ComponentCallRow.id)))


def tool_response(arguments: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "create_task",
                                    "arguments": json.dumps(arguments, ensure_ascii=False),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {"prompt_tokens": 120, "completion_tokens": 30},
        },
    )


def test_extract_task_parses_tool_call_and_records_two_calls() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return tool_response({"title": "Купить подгузники", "priority": "high"})

    telemetry.set_actor("member-1", None)
    result = make_client(handler).extract_task("купи подгузники срочно", "2026-10-06T10:00")

    assert result == {"title": "Купить подгузники", "priority": "high"}
    assert seen["auth"] == "Bearer key"
    assert seen["body"]["model"] == "test-model"
    assert seen["body"]["tools"][0]["function"]["name"] == "create_task"

    # Модель + навык — два обращения по методике Положения
    llm, skill = sorted(calls(), key=lambda c: c.kind)
    assert (llm.kind, llm.status, llm.tokens_in, llm.tokens_out) == ("llm", "ok", 120, 30)
    assert (skill.kind, skill.operation) == ("skill", "extract_task")
    assert llm.member_id == skill.member_id == "member-1"


def test_http_error_falls_back_and_is_logged_as_error() -> None:
    client = make_client(lambda request: httpx.Response(503, text="overloaded"))

    assert client.extract_task("купи хлеб", "2026-10-06T10:00") is None
    statuses = {(c.kind, c.status, c.error_code) for c in calls()}
    assert ("llm", "error", "http_503") in statuses
    assert ("skill", "error", "LLMError") in statuses


def test_disabled_client_makes_no_calls() -> None:
    client = LLMClient()
    client._settings = Settings(llm_api_key="", llm_model="")

    assert client.extract_task("купи хлеб", "2026-10-06T10:00") is None
    assert client.explain_assignment("Купить хлеб", "Папа", "свободен") == "Папа: свободен"
    assert calls() == []


def test_explain_assignment_returns_model_text() -> None:
    client = make_client(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": " Папа сегодня свободнее. "}}]}
        )
    )
    assert (
        client.explain_assignment("Купить хлеб", "Папа", "меньше дел") == "Папа сегодня свободнее."
    )


def test_anonymize_is_stable_and_hides_id() -> None:
    first = telemetry.anonymize("member-1")
    assert first == telemetry.anonymize("member-1")
    assert first != telemetry.anonymize("member-2")
    assert "member" not in first
    assert telemetry.anonymize(None) is None
