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
    assert calls() == []


def test_anonymize_is_stable_and_hides_id() -> None:
    first = telemetry.anonymize("member-1")
    assert first == telemetry.anonymize("member-1")
    assert first != telemetry.anonymize("member-2")
    assert "member" not in first
    assert telemetry.anonymize(None) is None


def test_connect_failure_is_retried_once() -> None:
    attempts = {"n": 0}

    def flaky(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise httpx.ConnectTimeout("сеть моргнула", request=request)
        return tool_response({"title": "Купить хлеб"})

    result = make_client(flaky).extract_task("купи хлеб", "2026-10-10T10:00:00")
    assert result["title"] == "Купить хлеб"
    assert attempts["n"] == 2
    llm = [c for c in calls() if c.kind == "llm"]
    assert [(c.status, c.error_code) for c in llm] == [("error", "ConnectTimeout"), ("ok", None)]


def test_read_timeout_is_not_retried() -> None:
    attempts = {"n": 0}

    def slow(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        raise httpx.ReadTimeout("модель думает", request=request)

    assert make_client(slow).extract_task("купи хлеб", "2026-10-10T10:00:00") is None
    assert attempts["n"] == 1
