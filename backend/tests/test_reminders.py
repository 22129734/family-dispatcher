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
    check = client.post("/api/v1/auth/phone/start", json={"phone": phone, "consent": True}).json()
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


# ---------- «Не выполнено» ----------


def test_author_rejects_done_task_with_feedback(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Купить продукты"}, headers=auth(family["mom"])
    ).json()
    client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"]))
    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"]))
    sent.clear()

    # Исполнитель не может «отклонить» за автора
    assert (
        client.post(
            f"/api/v1/tasks/{task['id']}/reject", json={}, headers=auth(family["dad"])
        ).status_code
        == 403
    )

    back = client.post(
        f"/api/v1/tasks/{task['id']}/reject",
        json={"comment": "забыл хлеб"},
        headers=auth(family["mom"]),
    ).json()
    assert (back["status"], back["feedback"], back["completed_at"]) == (
        "accepted",
        "забыл хлеб",
        None,
    )
    member_id, message = sent[-1]
    assert member_id == family["dad_id"]
    assert message.title == "Мама: не выполнено" and message.body == "Купить продукты — забыл хлеб"
    assert [a["action"] for a in message.actions] == ["done"]

    # Повторно сделал — замечание снимается
    redone = client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"])).json()
    assert redone["status"] == "done" and redone["feedback"] is None
    # Не сделанное вернуть нельзя
    other = client.post(
        "/api/v1/tasks", json={"title": "Вынести мусор"}, headers=auth(family["mom"])
    ).json()
    assert (
        client.post(
            f"/api/v1/tasks/{other['id']}/reject", json={}, headers=auth(family["mom"])
        ).status_code
        == 409
    )


def test_reject_recurring_removes_spawned_next(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = task_due_in(client, family, 60)
    client.patch(
        f"/api/v1/tasks/{task['id']}", json={"recurrence": "weekly"}, headers=auth(family["mom"])
    )
    client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"]))
    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"]))
    open_before = [
        t
        for t in client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
        if t["status"] != "done"
    ]
    assert len(open_before) == 1  # создан следующий повтор

    client.post(f"/api/v1/tasks/{task['id']}/reject", json={}, headers=auth(family["mom"]))
    open_after = [
        t
        for t in client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
        if t["status"] != "done"
    ]
    assert [t["id"] for t in open_after] == [task["id"]]


# ---------- Проверка просьбы перед отправкой ----------


def test_parse_does_not_save_and_flags_unclear(client: TestClient, family: dict[str, str]) -> None:
    clear = client.post(
        "/api/v1/tasks/parse",
        json={"message": "Папе завтра в 19 забрать посылку", "source": "voice"},
        headers=auth(family["mom"]),
    ).json()
    assert clear["assignee_id"] == family["dad_id"] and clear["due_at"] and not clear["unclear"]
    vague = client.post(
        "/api/v1/tasks/parse", json={"message": "забрать посылку"}, headers=auth(family["mom"])
    ).json()
    assert vague["due_at"] is None and vague["unclear"] is True
    assert (
        client.get("/api/v1/tasks", headers=auth(family["mom"])).json() == []
    )  # ничего не создано


def test_create_with_all_fields_and_deferred_notify(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = client.post(
        "/api/v1/tasks",
        json={
            "title": "Забрать заказ с ВБ",
            "assignee_id": family["dad_id"],
            "due_at": "2026-10-14T19:00:00",
            "recurrence": "weekly",
            "priority": "high",
            "items": ["хлеб", " ", "молоко"],
            "source": "voice",
            "defer_notify": True,
        },
        headers=auth(family["mom"]),
    ).json()
    assert (task["recurrence"], task["priority"], [i["text"] for i in task["items"]]) == (
        "weekly", "high", ["хлеб", "молоко"],
    )  # fmt: skip
    assert sent == []  # уведомление ждёт файлов
    assert (
        client.post(f"/api/v1/tasks/{task['id']}/notify", headers=auth(family["dad"])).status_code
        == 403
    )
    client.post(f"/api/v1/tasks/{task['id']}/notify", headers=auth(family["mom"]))
    assert sent and sent[-1][0] == family["dad_id"]


def test_confirm_mode_setting(client: TestClient, family: dict[str, str]) -> None:
    me = client.get("/api/v1/me", headers=auth(family["mom"])).json()["member"]
    assert me["confirm_mode"] is None  # не выбирали — «если неясно»
    saved = client.patch("/api/v1/me", json={"confirm_mode": "always"}, headers=auth(family["mom"]))
    assert saved.json()["confirm_mode"] == "always"
    assert (
        client.patch(
            "/api/v1/me", json={"confirm_mode": "sometimes"}, headers=auth(family["mom"])
        ).status_code
        == 422
    )


# ---------- Заметки ----------


def test_note_is_saved_edited_and_shown_in_push(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = client.post(
        "/api/v1/tasks",
        json={
            "title": "Приём у врача",
            "note": "Кабинет 214, взять результаты анализов",
            "items": ["давление", "продлить рецепт"],
            "assignee_id": family["dad_id"],
        },
        headers=auth(family["mom"]),
    ).json()
    assert task["note"] == "Кабинет 214, взять результаты анализов"
    assert sent[-1][1].body == "Приём у врача\nКабинет 214, взять результаты анализов"

    edited = client.patch(
        f"/api/v1/tasks/{task['id']}", json={"note": "  Кабинет 301  "}, headers=auth(family["dad"])
    ).json()
    assert edited["note"] == "Кабинет 301"
    cleared = client.patch(
        f"/api/v1/tasks/{task['id']}", json={"note": " "}, headers=auth(family["mom"])
    ).json()
    assert cleared["note"] is None


def test_push_shows_items_when_no_note(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    client.post(
        "/api/v1/tasks",
        json={
            "title": "Купить продукты",
            "items": ["хлеб", "молоко"],
            "assignee_id": family["dad_id"],
        },
        headers=auth(family["mom"]),
    )
    assert sent[-1][1].body == "Купить продукты\nхлеб, молоко"


def test_llm_note_and_items_are_mapped() -> None:
    from app.services.task_extractor import TaskExtractor

    class Stub:
        enabled = True

        def extract_task(self, *args: object) -> dict:
            return {
                "title": "Приём у врача",
                "items": ["давление", "продлить рецепт"],
                "note": " кабинет 214 ",
            }

    draft = TaskExtractor(client=Stub()).extract("к врачу в среду, спросить про давление")
    assert (draft.items, draft.note) == (["давление", "продлить рецепт"], "кабинет 214")


def test_end_time_saved_moved_with_due_and_kept_on_repeat(
    client: TestClient, family: dict[str, str]
) -> None:
    start = (datetime.now() + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    task = client.post(
        "/api/v1/tasks",
        json={
            "title": "Подготовка к школе",
            "due_at": start.isoformat(),
            "ends_at": (start + timedelta(hours=1)).isoformat(),
            "recurrence": "daily",
            "assignee_id": family["dad_id"],
        },
        headers=auth(family["mom"]),
    ).json()
    assert task["ends_at"] == (start + timedelta(hours=1)).isoformat()

    # Перенесли начало — окончание сдвинулось следом
    moved = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"due_at": (start + timedelta(hours=2)).isoformat()},
        headers=auth(family["mom"]),
    ).json()
    assert moved["ends_at"] == (start + timedelta(hours=3)).isoformat()

    bad = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"ends_at": start.isoformat()},
        headers=auth(family["mom"]),
    )
    assert bad.status_code == 422

    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"]))
    tasks = client.get("/api/v1/tasks", headers=auth(family["mom"])).json()
    nxt = next(t for t in tasks if t["status"] != "done")
    span = datetime.fromisoformat(nxt["ends_at"]) - datetime.fromisoformat(nxt["due_at"])
    assert span == timedelta(hours=1)

    cleared = client.patch(
        f"/api/v1/tasks/{nxt['id']}", json={"ends_at": None}, headers=auth(family["mom"])
    ).json()
    assert cleared["ends_at"] is None


def test_frequent_tasks_group_by_plain_title(client: TestClient, family: dict[str, str]) -> None:
    for title in (
        "завтра подготовка к школе с 9 до 10",
        "Подготовка к школе",
        "в пятницу подготовка к школе",
        "Купить хлеб",
        "купить хлеб",
        "Позвонить в банк",
    ):
        client.post("/api/v1/tasks", json={"title": title}, headers=auth(family["mom"]))
    # Повтор по расписанию — не «частое», он и так создаётся сам
    for _ in range(3):
        client.post(
            "/api/v1/tasks",
            json={"title": "Полить цветы", "recurrence": "weekly"},
            headers=auth(family["mom"]),
        )
    copy = client.post(
        "/api/v1/tasks",
        json={"title": "Купить хлеб", "source": "copy", "items": ["батон"]},
        headers=auth(family["mom"]),
    )
    assert copy.status_code == 201

    frequent = client.get("/api/v1/tasks/frequent", headers=auth(family["mom"])).json()
    assert [(f["title"], f["count"]) for f in frequent] == [
        ("Купить хлеб", 3),
        ("Подготовка к школе", 3),
    ]
    assert frequent[0]["task"]["items"][0]["text"] == "батон"  # образец — последняя такая задача
    assert client.get("/api/v1/tasks/frequent", headers=auth(family["dad"])).json() == []


def test_participants_off_by_default_and_on_in_settings(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    phrase = {"message": "мы с мужем идём в кино в субботу с 19 до 21"}
    draft = client.post("/api/v1/tasks/parse", json=phrase, headers=auth(family["mom"])).json()
    assert draft["participant_ids"] == []  # по умолчанию — один исполнитель

    me = client.patch(
        "/api/v1/me", json={"allow_participants": True}, headers=auth(family["mom"])
    ).json()
    assert me["allow_participants"] is True
    draft = client.post("/api/v1/tasks/parse", json=phrase, headers=auth(family["mom"])).json()
    mom_id = me["id"]
    assert draft["assignee_id"] == family["dad_id"]
    assert draft["participant_ids"] == [mom_id]  # «мы» — автор участвует вместе с мужем


def test_participants_saved_notified_and_kept_on_repeat(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    mom_id = client.get("/api/v1/account", headers=auth(family["mom"])).json()["member"]["id"]
    task = client.post(
        "/api/v1/tasks",
        json={
            "title": "Баня",
            "assignee_id": mom_id,
            "participants": [family["dad_id"], family["dad_id"], mom_id],
            "recurrence": "weekly",
            "due_at": (datetime.now() + timedelta(days=1)).replace(microsecond=0).isoformat(),
        },
        headers=auth(family["mom"]),
    ).json()
    assert task["participants"] == [family["dad_id"]]  # без исполнителя и повторов
    assert [m for m, msg in sent if msg.title == "Мама: вы участвуете"] == [family["dad_id"]]

    bad = client.post(
        "/api/v1/tasks",
        json={"title": "Х", "participants": ["чужой"]},
        headers=auth(family["mom"]),
    )
    assert bad.status_code == 400

    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["mom"]))
    tasks = client.get("/api/v1/tasks", headers=auth(family["dad"])).json()
    nxt = next(t for t in tasks if t["status"] != "done" and t["title"] == "Баня")
    assert nxt["participants"] == [family["dad_id"]]

    # Участника сделали исполнителем — из участников он уходит
    moved = client.patch(
        f"/api/v1/tasks/{nxt['id']}",
        json={"assignee_id": family["dad_id"]},
        headers=auth(family["mom"]),
    ).json()
    assert moved["participants"] == []
    cleared = client.patch(
        f"/api/v1/tasks/{nxt['id']}", json={"participants": [mom_id]}, headers=auth(family["mom"])
    ).json()
    assert cleared["participants"] == [mom_id]
