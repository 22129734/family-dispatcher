"""Сквозные сценарии API на SQLite в памяти, без GigaChat."""

import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GIGACHAT_CREDENTIALS"] = ""
os.environ["ADMIN_TOKEN"] = "admin"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def family(client: TestClient) -> dict[str, str]:
    """Семья из мамы (создатель, с машиной) и папы, вошедшего по приглашению."""
    mom = client.post(
        "/api/v1/families",
        json={"family_name": "Ивановы", "member_name": "Мама", "has_car": True},
    ).json()
    code = client.get("/api/v1/family", headers=auth(mom["token"])).json()["invite_code"]
    dad = client.post(
        f"/api/v1/invites/{code}/join", json={"member_name": "Папа", "has_car": True}
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


def test_dispatch_assigns_and_is_visible_to_whole_family(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "Завтра в 19 забрать Соню с танцев", "source": "voice"},
        headers=auth(family["mom"]),
    ).json()

    assert task["assignee_id"] in {family["mom_id"], family["dad_id"]}
    assert task["requires_car"] is True
    assert task["source"] == "voice"
    assert task["rationale"]

    dad_view = client.get("/api/v1/tasks", headers=auth(family["dad"])).json()
    assert [t["id"] for t in dad_view] == [task["id"]]


def test_tasks_are_balanced_between_members(client: TestClient, family: dict[str, str]) -> None:
    assignees = [
        client.post(
            "/api/v1/tasks/dispatch",
            json={"message": f"Сегодня задача {i}"},
            headers=auth(family["mom"]),
        ).json()["assignee_id"]
        for i in range(4)
    ]
    assert assignees.count(family["mom_id"]) == 2
    assert assignees.count(family["dad_id"]) == 2


def test_reassign_moves_task_to_other_member(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks",
        json={"title": "Купить продукты", "assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    ).json()

    moved = client.post(f"/api/v1/tasks/{task['id']}/reassign", headers=auth(family["mom"])).json()
    assert moved["assignee_id"] == family["dad_id"]

    nobody = client.post(f"/api/v1/tasks/{task['id']}/reassign", headers=auth(family["dad"]))
    assert nobody.json()["assignee_id"] is None


def test_done_recurring_task_spawns_next(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "Каждый день завтра в 8 выгулять собаку"},
        headers=auth(family["mom"]),
    ).json()
    assert task["recurrence"] == "daily"

    done = client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"])).json()
    assert done["status"] == "done"

    tasks = client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
    open_tasks = [t for t in tasks if t["status"] == "open"]
    assert len(open_tasks) == 1
    assert open_tasks[0]["due_at"] > task["due_at"]


def test_labour_index_reflects_assigned_minutes(client: TestClient, family: dict[str, str]) -> None:
    client.post(
        "/api/v1/tasks",
        json={"title": "Уборка", "duration_minutes": 90, "assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    )
    client.post(
        "/api/v1/tasks",
        json={"title": "Мусор", "duration_minutes": 10, "assignee_id": family["dad_id"]},
        headers=auth(family["mom"]),
    )
    labour = {
        row["name"]: row
        for row in client.get("/api/v1/family", headers=auth(family["dad"])).json()["labour"]
    }
    assert labour["Мама"]["share"] == 0.9
    assert labour["Папа"]["minutes"] == 10


def test_cannot_touch_other_family_tasks(client: TestClient, family: dict[str, str]) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Секрет"}, headers=auth(family["mom"])
    ).json()
    stranger = client.post(
        "/api/v1/families", json={"family_name": "Петровы", "member_name": "Пётр"}
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
    # family_created + family_joined + task_created; app_open не считается обращением
    assert today["actions"] == 3
