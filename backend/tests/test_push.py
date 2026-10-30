"""Push-уведомления и действия по ссылке — без сети (webpush подменяется)."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import ComponentCallRow, NativePushTokenRow, PushSubscriptionRow
from app.services import notifications

SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "BKey", "auth": "AuthKey"}}


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
        "/api/v1/families",
        json={"family_name": "Ф", "member_name": "Мама"},
        headers=auth(login(client, "79990001001")),
    ).json()
    code = client.get("/api/v1/family", headers=auth(mom["token"])).json()["invite_code"]
    dad = client.post(
        f"/api/v1/invites/{code}/join",
        json={"member_name": "Папа"},
        headers=auth(login(client, "79990001002")),
    ).json()
    return {"mom": mom["token"], "dad": dad["token"], "mom_id": mom["member"]["id"],
            "dad_id": dad["member"]["id"]}  # fmt: skip


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, notifications.PushMessage]]:
    """Перехватываем отправку: (кому, сообщение)."""
    calls: list = []
    monkeypatch.setattr(
        notifications, "deliver", lambda member_id, msg: calls.append((member_id, msg))
    )
    monkeypatch.setattr(notifications, "push_enabled", lambda: True)
    return calls


# ---------- подписанные ссылки ----------


def test_action_token_roundtrip_expiry_and_tampering() -> None:
    token = notifications.action_token("task1", "member1", now=1000)
    assert notifications.read_action_token(token, now=1000) == ("task1", "member1")
    assert notifications.read_action_token(token, now=1000 + notifications.ACTION_TTL_S + 1) is None
    body, sign = token.split(".")
    forged = notifications.action_token("task2", "member1", now=1000).split(".")[0]
    assert notifications.read_action_token(f"{forged}.{sign}", now=1000) is None
    assert notifications.read_action_token("garbage", now=1000) is None


# ---------- подписка ----------


def test_subscribe_and_unsubscribe(client: TestClient, family: dict[str, str]) -> None:
    assert (
        client.post("/api/v1/push/subscribe", json=SUB, headers=auth(family["dad"])).status_code
        == 204
    )
    # повторная подписка того же устройства не дублируется
    client.post("/api/v1/push/subscribe", json=SUB, headers=auth(family["dad"]))
    status = client.get("/api/v1/push/status", headers=auth(family["dad"])).json()
    assert status["devices"] == 1
    assert status["enabled"] is False  # в тестах нет ключей VAPID

    client.post(
        "/api/v1/push/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=auth(family["dad"])
    )
    assert client.get("/api/v1/push/status", headers=auth(family["dad"])).json()["devices"] == 0


# ---------- кому уходят уведомления ----------


def test_new_task_notifies_assignee_with_action_buttons(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Купить смесь"}, headers=auth(family["mom"])
    ).json()
    assert len(sent) == 1
    member_id, message = sent[0]
    assert member_id == family["dad_id"]
    assert message.body == "Купить смесь"
    assert message.title == "Мама просит"
    assert [a["action"] for a in message.actions] == ["accept", "decline"]
    assert message.url.startswith("/t/") and message.act_url.startswith("/api/v1/act/")
    assert task["status"] == "new"


def test_task_to_yourself_sends_nothing(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    client.post(
        "/api/v1/tasks",
        json={"title": "Записаться к врачу", "assignee_id": family["mom_id"]},
        headers=auth(family["mom"]),
    )
    assert sent == []


def test_answers_notify_author(client: TestClient, family: dict[str, str], sent: list) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Забрать посылку"}, headers=auth(family["mom"])
    ).json()
    sent.clear()
    client.post(f"/api/v1/tasks/{task['id']}/accept", headers=auth(family["dad"]))
    client.post(f"/api/v1/tasks/{task['id']}/done", headers=auth(family["dad"]))
    assert [(m, msg.title) for m, msg in sent] == [
        (family["mom_id"], "Папа берёт"),
        (family["mom_id"], "Папа сделал(а)"),
    ]


# ---------- кнопки по ссылке без входа ----------


def test_act_link_accept_then_done_without_login(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    client.post("/api/v1/tasks", json={"title": "Вынести мусор"}, headers=auth(family["mom"]))
    message = sent[0][1]
    act_url = message.act_url
    sent.clear()

    info = client.get(act_url).json()
    assert (info["task"]["title"], info["member_name"], info["author_name"]) == (
        "Вынести мусор", "Папа", "Мама",
    )  # fmt: skip
    assert info["can_accept"] and info["can_decline"]

    accepted = client.post(f"{act_url}/accept").json()
    assert accepted["task"]["status"] == "accepted" and not accepted["can_accept"]
    done = client.post(f"{act_url}/done").json()
    assert done["task"]["status"] == "done"
    assert [msg.title for _, msg in sent] == ["Папа берёт", "Папа сделал(а)"]


def test_act_link_decline_with_reason(
    client: TestClient, family: dict[str, str], sent: list
) -> None:
    client.post("/api/v1/tasks", json={"title": "Забрать сына"}, headers=auth(family["mom"]))
    act_url = sent[0][1].act_url
    info = client.post(f"{act_url}/decline", json={"reason": "на совещании"}).json()
    assert info["task"]["assignee_id"] is None
    assert info["task"]["decline_reason"] == "Папа не может: на совещании"
    assert sent[-1][1].body == "Забрать сына — на совещании"


def test_bad_act_link_is_404(client: TestClient) -> None:
    assert client.get("/api/v1/act/nope.nope").status_code == 404


def test_prod_with_default_secret_disables_push_and_links(
    client: TestClient, family: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "vapid_public_key", "pub")
    monkeypatch.setattr(settings, "vapid_private_key", "priv")
    assert notifications.push_enabled()
    token = notifications.action_token("any-task", "any-member")
    monkeypatch.setattr(settings, "app_env", "production")
    assert not notifications.push_enabled()  # ссылку с ключом по умолчанию можно подделать
    assert client.get(f"/api/v1/act/{token}").status_code == 404


# ---------- отправка ----------


def test_deliver_sends_counts_calls_and_drops_dead_subscriptions(
    client: TestClient, family: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import pywebpush

    client.post("/api/v1/push/subscribe", json=SUB, headers=auth(family["dad"]))
    dead = {**SUB, "endpoint": "https://push.example/dead"}
    client.post("/api/v1/push/subscribe", json=dead, headers=auth(family["dad"]))

    settings = get_settings()
    monkeypatch.setattr(settings, "vapid_public_key", "pub")
    monkeypatch.setattr(settings, "vapid_private_key", "priv")
    payloads = []

    def fake_webpush(subscription_info, data, **kwargs):
        if subscription_info["endpoint"].endswith("dead"):
            response = type("R", (), {"status_code": 410})()
            raise pywebpush.WebPushException("gone", response=response)
        payloads.append(json.loads(data))

    monkeypatch.setattr(pywebpush, "webpush", fake_webpush)
    message = notifications.PushMessage(title="Т", body="Б", url="/", tag="x")
    assert notifications.deliver(family["dad_id"], message) == 1
    assert payloads == [
        {"title": "Т", "body": "Б", "url": "/", "tag": "x", "actions": [], "act_url": None}
    ]

    with SessionLocal() as db:
        endpoints = db.scalars(select(PushSubscriptionRow.endpoint)).all()
        calls = db.scalars(select(ComponentCallRow).where(ComponentCallRow.kind == "push")).all()
    assert endpoints == [SUB["endpoint"]]  # мёртвая подписка удалена
    assert sorted((c.status, c.error_code) for c in calls) == [("error", "http_410"), ("ok", None)]
    assert {c.member_id for c in calls} == {family["dad_id"]}


# ---------- push RuStore (Android-приложение из RuStore) ----------


def _native_on(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict]]:
    """Включить RuStore Push и перехватить отправку: (токен, data)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "rustore_push_project_id", "project")
    monkeypatch.setattr(settings, "rustore_push_service_token", "service-token")
    sent: list[tuple[str, dict]] = []

    def fake_send(token: str, message: notifications.PushMessage) -> tuple[int, str]:
        if token.startswith("dead"):
            return 404, "NOT_FOUND"
        sent.append((token, message.native_data()))
        return 200, ""

    monkeypatch.setattr(notifications, "rustore_send", fake_send)
    return sent


def test_native_token_belongs_to_who_logged_in_and_counts_in_status(
    client: TestClient, family: dict[str, str]
) -> None:
    token = {"token": "rustore-token-1"}
    assert (
        client.post("/api/v1/push/native", json=token, headers=auth(family["mom"])).status_code
        == 204
    )
    # Телефон отдали папе: тот же токен теперь его
    client.post("/api/v1/push/native", json=token, headers=auth(family["dad"]))
    with SessionLocal() as db:
        rows = db.scalars(select(NativePushTokenRow)).all()
    assert [(r.token, r.member_id) for r in rows] == [("rustore-token-1", family["dad_id"])]
    status = client.get("/api/v1/push/status", headers=auth(family["dad"])).json()
    assert status["native_devices"] == 1

    # Выход из аккаунта в приложении — токен забыт
    client.post("/api/v1/push/native/unregister", json=token, headers=auth(family["dad"]))
    assert (
        client.get("/api/v1/push/status", headers=auth(family["dad"])).json()["native_devices"] == 0
    )


def test_native_push_alone_enables_links_and_delivery(
    client: TestClient, family: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _native_on(monkeypatch)
    assert notifications.push_enabled() and not notifications.web_push_enabled()
    client.post("/api/v1/push/native", json={"token": "good-token"}, headers=auth(family["dad"]))
    client.post("/api/v1/push/native", json={"token": "dead-token"}, headers=auth(family["dad"]))

    message = notifications.PushMessage(
        title="Мама просит",
        body="Купить хлеб",
        url="/t/abc",
        tag="task-1",
        actions=[{"action": "accept", "title": "Беру"}],
        act_url="/api/v1/act/abc",
    )
    assert notifications.deliver(family["dad_id"], message) == 1
    token, data = sent[0]
    assert token == "good-token"
    # Только строки: приложение само рисует уведомление с кнопками
    assert data["title"] == "Мама просит" and data["act_url"] == "/api/v1/act/abc"
    assert json.loads(data["actions"]) == [{"action": "accept", "title": "Беру"}]
    assert all(isinstance(v, str) for v in data.values())

    with SessionLocal() as db:
        tokens = db.scalars(select(NativePushTokenRow.token)).all()
        calls = db.scalars(
            select(ComponentCallRow).where(ComponentCallRow.operation == "rustore.send")
        ).all()
    assert tokens == ["good-token"]  # приложение удалили — токен забыт
    assert sorted((c.status, c.error_code) for c in calls) == [
        ("error", "rustore_NOT_FOUND"),
        ("ok", None),
    ]


def test_native_message_fits_rustore_limit() -> None:
    message = notifications.PushMessage(
        title="Т" * 500, body="Б" * 5000, url="/t/x", tag="task-x", act_url="/api/v1/act/x"
    )
    assert len(notifications.native_body("t" * 200, message)) < 4096


def test_account_deletion_forgets_native_tokens(client: TestClient, family: dict[str, str]) -> None:
    client.post("/api/v1/push/native", json={"token": "dad-phone"}, headers=auth(family["dad"]))
    assert client.delete("/api/v1/account", headers=auth(family["dad"])).status_code == 204
    with SessionLocal() as db:
        assert db.scalars(select(NativePushTokenRow)).all() == []
