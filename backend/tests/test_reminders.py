"""Напоминания перед сроком, «Я помню», список покупок, видимость выключенных уведомлений."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import ComponentCallRow, TaskRow
from app.services import notifications
from app.workers import reminders


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(client: TestClient, phone: str) -> str:
    check = client.post("/api/v1/auth/phone/start", json={"phone": phone}).json()
    return client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]


@pytest.fixture
def family(client: TestClient) -> dict[str, str]:
    mom = client.post(
        "/api/v1/families", json={"member_name": "Мама"}, headers=auth(login(client, "79990002001"))
    ).json()
    code = client.get("/api/v1/family", headers=auth(mom["token"])).json()["invite_code"]
    dad = client.post(
        f"/api/v1/invites/{code}/join",
        json={"member_name": "Папа"},
        headers=auth(login(client, "79990002002")),
    ).json()
    return {"mom": mom["token"], "dad": dad["token"], "dad_id": dad["member"]["id"]}


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list:
    calls: list = []
    monkeypatch.setattr(
        notifications, "deliver", lambda member_id, msg: calls.append((member_id, msg))
    )
    monkeypatch.setattr(notifications, "push_enabled", lambda: True)
    return calls


def task_due_in(client: TestClient, family: dict[str, str], minutes: int) -> dict:
    task = client.post(
        "/api/v1/tasks", json={"title": "Забрать посылку"}, headers=auth(family["mom"])
    ).json()
    due = (datetime.now() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()
    return client.patch(
        f"/api/v1/tasks/{task['id']}", json={"due_at": due}, headers=auth(family["mom"])
    ).json()


def test_reminder_sent_once_inside_personal_window(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task_due_in(client, family, 90)
    sent.clear()
    assert reminders.run_once() == 0  # до срока 90 мин, напоминаем за 60

    later = datetime.now() + timedelta(minutes=35)
    assert reminders.run_once(later) == 1
    member_id, message = sent[-1]
    assert member_id == family["dad_id"]
    assert message.title.startswith("Ждёт ответа") and message.body == "Забрать посылку"
    assert [a["action"] for a in message.actions] == ["accept", "decline"]
    assert reminders.run_once(later) == 0  # второй раз не шлём
    with SessionLocal() as db:
        kinds = db.scalars(select(ComponentCallRow.kind)).all()
    assert "reminder" in kinds


def test_accepted_task_reminder_offers_remember_and_done(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = task_due_in(client, family, 30)
    client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"]))
    sent.clear()
    reminders.run_once()
    _, message = sent[-1]
    assert [a["action"] for a in message.actions] == ["remember", "done"]

    info = client.post(f"{message.act_url}/remember").json()
    assert info["task"]["remembered_at"] is not None and info["can_remember"] is False
    assert info["task"]["status"] == "accepted"


def test_remember_on_unanswered_task_means_accept_and_tells_author(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = task_due_in(client, family, 30)
    sent.clear()
    message = notifications.reminder_message(
        SessionLocal().get(TaskRow, task["id"]), datetime.now()
    )
    info = client.post(f"{message.act_url}/remember").json()
    assert info["task"]["status"] == "accepted"
    assert sent and sent[-1][1].title == "Папа берёт"


def test_personal_setting_off_and_change_of_due_resets(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    assert (
        client.patch(
            "/api/v1/me", json={"remind_before_min": 0}, headers=auth(family["dad"])
        ).json()["remind_before_min"]
        == 0
    )
    assert (
        client.patch(
            "/api/v1/me", json={"remind_before_min": 7}, headers=auth(family["dad"])
        ).status_code
        == 422
    )
    task = task_due_in(client, family, 10)
    sent.clear()
    assert reminders.run_once() == 0

    client.patch("/api/v1/me", json={"remind_before_min": 30}, headers=auth(family["dad"]))
    assert reminders.run_once() == 1
    due = (datetime.now() + timedelta(hours=5)).replace(microsecond=0).isoformat()
    moved = client.patch(
        f"/api/v1/tasks/{task['id']}", json={"due_at": due}, headers=auth(family["mom"])
    ).json()
    assert moved["reminded_at"] is None  # новый срок — напомним снова


def test_past_and_done_tasks_are_not_reminded(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task_due_in(client, family, -5)
    done = task_due_in(client, family, 20)
    client.post(f"/api/v1/tasks/{done['id']}/done", headers=auth(family["mom"]))
    sent.clear()
    assert reminders.run_once() == 0


# ---------- список покупок ----------


def test_shopping_list_from_message_and_checking_items(
    client: TestClient, family: dict[str, str]
) -> None:
    task = client.post(
        "/api/v1/tasks/dispatch",
        json={"message": "купи молоко, хлеб и яйца"},
        headers=auth(family["mom"]),
    ).json()
    assert [i["text"] for i in task["items"]] == ["молоко", "хлеб", "яйца"]

    items = [dict(i, done=i["text"] == "хлеб") for i in task["items"]] + [{"text": "сыр"}]
    updated = client.put(
        f"/api/v1/tasks/{task['id']}/items", json={"items": items}, headers=auth(family["dad"])
    ).json()
    assert [(i["text"], i["done"]) for i in updated["items"]] == [
        ("молоко", False), ("хлеб", True), ("яйца", False), ("сыр", False),
    ]  # fmt: skip
    assert (
        client.put(
            f"/api/v1/tasks/{task['id']}/items",
            json={"items": [{"text": ""}]},
            headers=auth(family["dad"]),
        ).status_code
        == 422
    )


def test_llm_items_are_cleaned() -> None:
    from app.services.task_extractor import TaskExtractor

    class Stub:
        enabled = True

        def extract_task(self, *args: object) -> dict:
            return {"title": "Купить продукты", "items": [" Молоко ", "молоко", "", "Хлеб."]}

    draft = TaskExtractor(client=Stub()).extract("купи молоко и хлеб")
    assert draft.items == ["Молоко", "Хлеб"]


# ---------- видимость выключенных уведомлений ----------


def test_family_shows_who_has_notifications(client: TestClient, family: dict[str, str]) -> None:
    def flags() -> dict[str, bool]:
        members = client.get("/api/v1/family", headers=auth(family["mom"])).json()["members"]
        return {m["name"]: m["notifications"] for m in members}

    assert flags() == {"Мама": False, "Папа": False}
    settings = get_settings()
    settings.vapid_public_key, settings.vapid_private_key = "pub", "priv"
    try:
        client.post(
            "/api/v1/push/subscribe",
            json={"endpoint": "https://push.test/1", "keys": {"p256dh": "k", "auth": "a"}},
            headers=auth(family["dad"]),
        )
    finally:
        settings.vapid_public_key, settings.vapid_private_key = "", ""
    assert flags() == {"Мама": False, "Папа": True}
