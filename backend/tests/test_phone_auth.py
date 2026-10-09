"""Вход по номеру телефона через звонок — без сети (имитация и MockTransport)."""

from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import AccountRow, ComponentCallRow, PhoneCheckRow, SessionRow
from app.services import phone_auth
from app.services.phone_auth import PhoneAuthError, ProviderUnavailableError, SmsRuVerifier


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+7 (999) 123-45-67", "79991234567"),
        ("89991234567", "79991234567"),
        ("9991234567", "79991234567"),
    ],
)
def test_normalize_phone(raw: str, expected: str) -> None:
    assert phone_auth.normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["", "12345", "+1 202 555 0100", "74951234567"])
def test_normalize_rejects_non_russian_mobile(raw: str) -> None:
    with pytest.raises(PhoneAuthError):
        phone_auth.normalize_phone(raw)


def test_mask_phone_hides_middle_digits() -> None:
    assert phone_auth.mask_phone("79991234567") == "+7 9** ***-45-67"


def test_login_flow_issues_token_once_and_account_has_no_family(client: TestClient) -> None:
    check = client.post("/api/v1/auth/phone/start", json={"phone": "+79990000010", "consent": True})
    assert check.status_code == 201
    body = check.json()
    assert body["phone_masked"] == "+7 9** ***-00-10"
    assert body["call_phone"]

    status = client.get(f"/api/v1/auth/phone/status/{body['check_id']}").json()
    assert status["status"] == "confirmed" and status["token"]
    # Повторный опрос той же проверки токен уже не выдаёт
    assert client.get(f"/api/v1/auth/phone/status/{body['check_id']}").json() == {
        "status": "used",
        "token": None,
    }

    account = client.get("/api/v1/account", headers=auth(status["token"])).json()
    assert account == {
        "phone_masked": "+7 9** ***-00-10",
        "has_pin": False,
        "member": None,
        "family_id": None,
    }
    # Без семьи доступны только создание семьи и вход по приглашению
    assert client.get("/api/v1/tasks", headers=auth(status["token"])).status_code == 409


def test_same_phone_logs_into_same_account_and_keeps_other_sessions(client: TestClient) -> None:
    def login() -> str:
        check = client.post(
            "/api/v1/auth/phone/start", json={"phone": "79990000011", "consent": True}
        ).json()
        return client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]

    first = login()
    family = client.post(
        "/api/v1/families", json={"family_name": "Ф", "member_name": "Мама"}, headers=auth(first)
    )
    assert family.status_code == 201
    second = login()
    assert second != first
    # Вход на втором устройстве (например, приложение на экране «Домой») не выбивает первое
    assert client.get("/api/v1/account", headers=auth(first)).status_code == 200
    me = client.get("/api/v1/account", headers=auth(second)).json()
    assert me["member"]["name"] == "Мама"
    # Второй раз создать семью нельзя
    again = client.post(
        "/api/v1/families", json={"family_name": "Ф2", "member_name": "Мама"}, headers=auth(second)
    )
    assert again.status_code == 409


def test_limits_per_phone(client: TestClient) -> None:
    for _ in range(phone_auth.PER_PHONE_LIMIT[0]):
        assert (
            client.post(
                "/api/v1/auth/phone/start", json={"phone": "79990000012", "consent": True}
            ).status_code
            == 201
        )
    blocked = client.post(
        "/api/v1/auth/phone/start", json={"phone": "79990000012", "consent": True}
    )
    assert blocked.status_code == 429


def test_expired_check_does_not_log_in(client: TestClient) -> None:
    check_id = client.post(
        "/api/v1/auth/phone/start", json={"phone": "79990000013", "consent": True}
    ).json()["check_id"]
    with SessionLocal() as session:
        row = session.get(PhoneCheckRow, check_id)
        row.created_at = datetime.now() - timedelta(minutes=10)
        session.commit()
    assert client.get(f"/api/v1/auth/phone/status/{check_id}").json()["status"] == "expired"


def call_login(client: TestClient, phone: str) -> str:
    check = client.post(
        "/api/v1/auth/phone/start", json={"phone": phone, "call": True, "consent": True}
    ).json()
    return client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]


def test_logout_ends_only_this_session(client: TestClient) -> None:
    token = call_login(client, "79990000014")
    other = call_login(client, "79990000014")
    assert client.post("/api/v1/auth/logout", headers=auth(token)).status_code == 204
    assert client.get("/api/v1/account", headers=auth(token)).status_code == 401
    assert client.get("/api/v1/account", headers=auth(other)).status_code == 200


def test_tokens_are_stored_hashed(client: TestClient) -> None:
    token = call_login(client, "79990000015")
    with SessionLocal() as session:
        stored = session.scalars(select(SessionRow.token_hash)).all()
    assert token not in stored and len(stored) == 1


# ---------- PIN-код ----------


def test_pin_login_after_first_call(client: TestClient) -> None:
    token = call_login(client, "79990000020")
    assert (
        client.post("/api/v1/auth/pin", json={"pin": "12ab"}, headers=auth(token)).status_code
        == 422
    )
    assert (
        client.post("/api/v1/auth/pin", json={"pin": "4821"}, headers=auth(token)).status_code
        == 204
    )
    assert client.get("/api/v1/account", headers=auth(token)).json()["has_pin"] is True

    # Теперь вход по номеру предлагает PIN, звонок не нужен
    start = client.post(
        "/api/v1/auth/phone/start", json={"phone": "+7 999 000-00-20", "consent": True}
    ).json()
    assert start == {
        "method": "pin",
        "phone_masked": "+7 9** ***-00-20",
        "check_id": None,
        "call_phone": None,
        "call_phone_pretty": None,
        "expires_in_s": None,
    }
    login = client.post("/api/v1/auth/pin/login", json={"phone": "89990000020", "pin": "4821"})
    assert login.status_code == 200
    assert client.get("/api/v1/account", headers=auth(login.json()["token"])).status_code == 200
    # Забыли PIN — можно войти звонком
    forced = client.post(
        "/api/v1/auth/phone/start", json={"phone": "79990000020", "call": True, "consent": True}
    )
    assert forced.json()["method"] == "call" and forced.json()["check_id"]


def test_pin_locks_after_five_failures_until_call(client: TestClient) -> None:
    token = call_login(client, "79990000021")
    client.post("/api/v1/auth/pin", json={"pin": "1111"}, headers=auth(token))

    def attempt(pin: str):
        return client.post("/api/v1/auth/pin/login", json={"phone": "79990000021", "pin": pin})

    for left in (4, 3, 2, 1):
        wrong = attempt("0000")
        assert wrong.status_code == 401 and str(left) in wrong.json()["detail"]
    assert attempt("0000").status_code == 429
    assert attempt("1111").status_code == 429  # даже верный PIN — только звонком
    start = client.post(
        "/api/v1/auth/phone/start", json={"phone": "79990000021", "consent": True}
    ).json()
    assert start["method"] == "call"

    # Вход звонком снимает блокировку
    call_login(client, "79990000021")
    assert attempt("1111").status_code == 200


def test_pin_unknown_phone_is_generic_401(client: TestClient) -> None:
    response = client.post("/api/v1/auth/pin/login", json={"phone": "79990000022", "pin": "1234"})
    assert response.status_code == 401


def test_pin_attempts_limited_per_ip(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(phone_auth, "PIN_IP_LIMIT", (3, timedelta(hours=1)))
    for n in range(3):
        token = call_login(client, f"7999000003{n}")
        client.post("/api/v1/auth/pin", json={"pin": "1111"}, headers=auth(token))
        client.post("/api/v1/auth/pin/login", json={"phone": f"7999000003{n}", "pin": "0000"})
    blocked = client.post("/api/v1/auth/pin/login", json={"phone": "79990000030", "pin": "1111"})
    assert blocked.status_code == 429


# ---------- клиент SMS.RU ----------


def smsru(handler) -> SmsRuVerifier:
    return SmsRuVerifier(
        Settings(smsru_api_id="test-id", smsru_base_url="https://sms.test"),
        transport=httpx.MockTransport(handler),
    )


def test_smsru_start_and_status_are_parsed(client: TestClient) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["api_id"] == "test-id"
        if request.url.path == "/callcheck/add":
            assert request.url.params["phone"] == "79991234567"
            return httpx.Response(
                200,
                json={
                    "status": "OK",
                    "check_id": "201737-542",
                    "call_phone": "78005008275",
                    "call_phone_pretty": "+7 (800) 500-8275",
                },
            )
        code = {"201737-542": 401, "old": 402}.get(request.url.params["check_id"], 400)
        return httpx.Response(200, json={"status": "OK", "check_status": code})

    verifier = smsru(handler)
    started = verifier.start("79991234567")
    assert (started.provider_check_id, started.call_phone_pretty) == (
        "201737-542",
        "+7 (800) 500-8275",
    )
    assert verifier.is_confirmed("201737-542") is True
    assert verifier.is_confirmed("old") is False
    assert verifier.is_confirmed("waiting") is None

    with SessionLocal() as session:
        calls = session.scalars(select(ComponentCallRow)).all()
    assert [(c.kind, c.operation, c.status) for c in calls] == [
        ("phone_auth", "callcheck.add", "ok")
    ]


def test_smsru_error_is_reported_as_unavailable(client: TestClient) -> None:
    verifier = smsru(
        lambda request: httpx.Response(200, json={"status": "ERROR", "status_code": 200})
    )
    with pytest.raises(ProviderUnavailableError):
        verifier.start("79991234567")
    with SessionLocal() as session:
        call = session.scalars(select(ComponentCallRow)).one()
    assert (call.status, call.error_code) == ("error", "provider")


def test_production_without_key_has_no_login() -> None:
    with pytest.raises(ProviderUnavailableError):
        phone_auth.get_verifier(Settings(app_env="production", smsru_api_id=""))


def test_consent_is_asked_once_per_phone(client: TestClient) -> None:
    def start(**extra: object):
        return client.post("/api/v1/auth/phone/start", json={"phone": "79990000050", **extra})

    # Новый номер без галочки — просим согласие, звонок не заказываем
    assert start().status_code == 428
    check = start(consent=True).json()
    token = client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]
    # Номер дал согласие — дальше галочка не нужна ни для звонка, ни для PIN
    assert start().status_code == 201
    client.post("/api/v1/auth/pin", json={"pin": "2468"}, headers=auth(token))
    assert start().json()["method"] == "pin"
    with SessionLocal() as session:
        assert session.scalar(select(AccountRow.consent_at)) is not None
