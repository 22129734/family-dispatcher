"""Сквозные сценарии API на SQLite в памяти, без LLM."""

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(client: TestClient, phone: str) -> str:
    """Вход по звонку через имитацию провайдера (без ключа SMS.RU номер подтверждается сразу)."""
    check = client.post("/api/v1/auth/phone/start", json={"phone": phone}).json()
    status = client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()
    assert status["status"] == "confirmed"
    return status["token"]


@pytest.fixture
def family(client: TestClient) -> dict[str, str]:
    """Семья из мамы (создатель, с машиной) и папы, вошедшего по приглашению."""
    mom = client.post(
        "/api/v1/families",
        json={"family_name": "Ивановы", "member_name": "Мама", "has_car": True},
        headers=auth(login(client, "+7 999 000-00-01")),
    ).json()
    code = client.get("/api/v1/family", headers=auth(mom["token"])).json()["invite_code"]
    dad = client.post(
        f"/api/v1/invites/{code}/join",
        json={"member_name": "Папа", "has_car": True},
        headers=auth(login(client, "89990000002")),
    ).json()
    return {
        "mom": mom["token"],
        "dad": dad["token"],
        "mom_id": mom["member"]["id"],
        "dad_id": dad["member"]["id"],
        "code": code,
    }


def test_requires_auth(client: TestClient) -> None:
    assert client.get("/api/v1/tasks").status_code == 401
    assert client.get("/api/v1/tasks", headers=auth("wrong")).status_code == 401


def test_invite_shows_family(client: TestClient, family: dict[str, str]) -> None:
    info = client.get(f"/api/v1/invites/{family['code']}").json()
    assert info == {"family_name": "Ивановы", "members": ["Мама", "Папа"]}
    assert client.get("/api/v1/invites/nope").status_code == 404


def test_dispatch_goes_to_second_adult_and_waits_for_answer(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "Завтра в 19 забрать Соню с танцев", "source": "voice"},
        headers=auth(family["mom"]),
    ).json()

    assert task["assignee_id"] == family["dad_id"]
    assert task["status"] == "new"
    assert task["requires_car"] is True
    assert task["source"] == "voice"

    dad_view = client.get("/api/v1/tasks", headers=auth(family["dad"])).json()
    assert [t["id"] for t in dad_view] == [task["id"]]


def test_accept_then_done_is_visible_to_author(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Купить смесь"}, headers=auth(family["mom"])
    ).json()
    assert (task["assignee_id"], task["status"]) == (family["dad_id"], "new")

    # Принять может только исполнитель
    assert (
        client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["mom"])).status_code
        == 403
    )
    accepted = client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"])).json()
    assert accepted["status"] == "accepted" and accepted["accepted_at"]

    done = client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"])).json()
    assert done["status"] == "done" and done["completed_at"]

    mom_view = client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
    assert mom_view[0]["status"] == "done"


def test_decline_returns_task_to_author_with_reason(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Забрать посылку"}, headers=auth(family["mom"])
    ).json()
    declined = client.post(
        f"/api/v1/tasks/{task['id']}/decline",
        json={"reason": "до 21 на работе"},
        headers=auth(family["dad"]),
    ).json()
    assert declined["assignee_id"] is None
    assert declined["status"] == "new"
    assert declined["decline_reason"] == "Папа не может: до 21 на работе"

    # Автор назначает другого — поручение снова ждёт ответа, причина отказа снята
    moved = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    ).json()
    assert moved["assignee_id"] == family["mom_id"]
    assert moved["status"] == "accepted"  # поручила себе — сразу «взято»
    assert moved["decline_reason"] is None


def test_task_to_yourself_is_accepted_at_once(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks",
        json={"title": "Записаться к врачу", "assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    ).json()
    assert task["status"] == "accepted"


def test_only_author_deletes_and_strangers_cannot_mark_done(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks",
        json={"title": "Полить цветы", "assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    ).json()
    assert (
        client.delete(f"/api/v1/tasks/{task['id']}", headers=auth(family["dad"])).status_code == 403
    )
    # Папа — не исполнитель и не автор
    assert (
        client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"])).status_code
        == 403
    )
    assert (
        client.delete(f"/api/v1/tasks/{task['id']}", headers=auth(family["mom"])).status_code == 204
    )


def test_done_recurring_task_spawns_next_for_same_assignee(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "Каждый день завтра в 8 выгулять собаку"},
        headers=auth(family["mom"]),
    ).json()
    assert task["recurrence"] == "daily"

    client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"]))
    done = client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"])).json()
    assert done["status"] == "done"

    tasks = client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
    upcoming = [t for t in tasks if t["status"] != "done"]
    assert len(upcoming) == 1
    assert upcoming[0]["due_at"] > task["due_at"]
    assert (upcoming[0]["assignee_id"], upcoming[0]["status"]) == (family["dad_id"], "new")


def test_explicit_self_or_named_assignee_overrides_default(
    client: TestClient, family: dict[str, str]
) -> None:
    mine = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "напомни мне завтра в 9 позвонить врачу"},
        headers=auth(family["mom"]),
    ).json()
    assert (mine["assignee_id"], mine["status"]) == (family["mom_id"], "accepted")
    named = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "папе завтра забрать посылку"},
        headers=auth(family["mom"]),
    ).json()
    assert (named["assignee_id"], named["status"]) == (family["dad_id"], "new")


def test_repeat_can_be_set_later_and_monthly_and_weekdays_roll_forward(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "оплатить интернет завтра в 10"},
        headers=auth(family["mom"]),
    ).json()
    assert task["recurrence"] == "none"
    edited = client.patch(
        f"/api/v1/tasks/{task['id']}", json={"recurrence": "monthly"}, headers=auth(family["mom"])
    ).json()
    assert edited["recurrence"] == "monthly"
    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["mom"]))
    upcoming = [
        t
        for t in client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
        if t["status"] != "done"
    ]
    assert len(upcoming) == 1 and upcoming[0]["recurrence"] == "monthly"
    assert upcoming[0]["due_at"][:7] > task["due_at"][:7]  # следующий месяц
    off = client.patch(
        f"/api/v1/tasks/{upcoming[0]['id']}", json={"recurrence": None}, headers=auth(family["mom"])
    ).json()
    assert off["recurrence"] == "none"


def test_next_due_skips_weekend_for_weekdays() -> None:
    from datetime import datetime

    from app.services.family_service import next_due

    friday = datetime(2026, 10, 9, 8, 0)
    assert next_due(friday, "weekdays", friday).weekday() == 0  # понедельник
    # Отметили поздно — следующий срок всё равно в будущем
    late = next_due(datetime(2026, 10, 1, 8, 0), "daily", datetime(2026, 10, 7, 12, 0))
    assert late == datetime(2026, 10, 8, 8, 0)
    assert next_due(None, "none", friday) is None


def test_family_name_is_optional(client: TestClient) -> None:
    token = login(client, "79990000041")
    created = client.post("/api/v1/families", json={"member_name": "Аня"}, headers=auth(token))
    assert created.status_code == 201
    assert client.get("/api/v1/family", headers=auth(token)).json()["name"] == "Моя семья"


def test_alone_in_family_tasks_go_to_yourself(client: TestClient) -> None:
    token = login(client, "79990000020")
    client.post(
        "/api/v1/families", json={"family_name": "Одна", "member_name": "Аня"}, headers=auth(token)
    )
    task = client.post(
        "/api/v1/tasks/dispatch", json={"message": "купить хлеб"}, headers=auth(token)
    ).json()
    assert task["status"] == "accepted"
    assert "пригласите" in task["rationale"]


def test_cannot_touch_other_family_tasks(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Секрет"}, headers=auth(family["mom"])
    ).json()
    stranger = client.post(
        "/api/v1/families",
        json={"family_name": "Петровы", "member_name": "Пётр"},
        headers=auth(login(client, "79990000003")),
    ).json()
    response = client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(stranger["token"]))
    assert response.status_code == 404


def test_daily_analytics_counts_actions_not_views(
    client: TestClient, family: dict[str, str]
) -> None:
    client.post("/api/v1/events", json={"name": "app_open"}, headers=auth(family["dad"]))
    client.post("/api/v1/tasks", json={"title": "Полить цветы"}, headers=auth(family["mom"]))

    assert client.get("/api/v1/analytics/daily").status_code == 403
    today = client.get(
        "/api/v1/analytics/daily", headers={"X-Admin-Token": "admin"}, params={"days": 1}
    ).json()["days"][0]
    assert today["dau"] == 2
    # family_created + family_joined + task_created; app_open не считается действием
    assert today["actions"] == 3


def test_component_calls_are_counted_per_dau_and_exported(
    client: TestClient, family: dict[str, str]
) -> None:
    from app.services import telemetry

    telemetry.record("llm", "chat.completions", tokens_in=10, tokens_out=5)
    telemetry.record("skill", "extract_task")
    telemetry.record("push", "send", status="error", error_code="http_410")

    admin = {"X-Admin-Token": "admin"}
    today = client.get("/api/v1/analytics/daily", headers=admin, params={"days": 1}).json()
    stat = today["days"][0]
    assert stat["component_calls"] == 3
    assert stat["component_calls_per_dau"] == 1.5  # 3 обращения на 2 DAU
    assert stat["component_errors"] == 1
    assert stat["calls_by_kind"] == {"llm": 1, "skill": 1, "push": 1}

    assert client.get("/api/v1/analytics/component-calls.csv").status_code == 403
    csv_text = client.get("/api/v1/analytics/component-calls.csv", headers=admin).text
    lines = csv_text.strip().splitlines()
    assert lines[0].startswith("created_at,kind,operation,status")
    assert len(lines) == 4

    events = client.get("/api/v1/analytics/events.csv", headers=admin).text.strip().splitlines()
    assert events[0] == "created_at,event,user_id,family_id"
    assert len(events) == 3  # family_created + family_joined
    # Идентификаторы обезличены: реальные id участников в выгрузку не попадают
    member_id = client.get("/api/v1/me", headers=auth(family["mom"])).json()["member"]["id"]
    assert member_id not in "\n".join(events)
