"""Отзыв в поддержку: голосовое и текст уходят письмом; запись нигде не хранится."""

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app
from app.services import support

WEBM = b"\x1a\x45\xdf\xa3" + b"0" * 2000


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def token(client: TestClient) -> str:
    check = client.post(
        "/api/v1/auth/phone/start", json={"phone": "79990004001", "consent": True}
    ).json()
    token = client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]
    client.post(
        "/api/v1/families",
        json={"member_name": "Аня"},
        headers={"Authorization": f"Bearer {token}"},
    )
    return token


@pytest.fixture
def mails(monkeypatch: pytest.MonkeyPatch) -> list:
    sent: list = []
    monkeypatch.setattr(
        support,
        "send_mail",
        lambda subject, body, attachment=None: sent.append((subject, body, attachment)),
    )
    monkeypatch.setattr(support, "transcribe", lambda audio, ext: "Не понятно, где кнопка Беру")
    return sent


def post(client: TestClient, token: str, **kwargs):
    return client.post(
        "/api/v1/support/feedback", headers={"Authorization": f"Bearer {token}"}, **kwargs
    )


def test_voice_feedback_is_mailed_with_transcript(
    client: TestClient, token: str, mails: list
) -> None:
    response = post(
        client,
        token,
        data={"text": "и шрифт мелкий", "device": "iPhone, Safari"},
        files={"audio": ("rec.webm", WEBM, "audio/webm")},
    )
    assert response.status_code == 202
    subject, body, attachment = mails[-1]
    assert subject == "Отзыв из приложения: и шрифт мелкий"
    assert "От: Аня, +79990004001" in body
    assert "Не понятно, где кнопка Беру" in body and "iPhone, Safari" in body
    name, data, mime = attachment
    assert name.endswith(".webm") and data == WEBM and mime == "audio/webm"


def test_text_only_and_validation(client: TestClient, token: str, mails: list) -> None:
    assert post(client, token, data={"text": "Хочу тёмную тему по расписанию"}).status_code == 202
    assert mails[-1][2] is None
    assert post(client, token, data={"text": "  "}).status_code == 422
    bad = post(client, token, files={"audio": ("x.txt", b"hello", "text/plain")})
    assert bad.status_code == 415
    assert client.post("/api/v1/support/feedback", data={"text": "x"}).status_code == 401


def test_daily_limit(client: TestClient, token: str, mails: list, monkeypatch) -> None:
    monkeypatch.setattr(support, "DAILY_LIMIT", 2)
    assert post(client, token, data={"text": "1"}).status_code == 202
    assert post(client, token, data={"text": "2"}).status_code == 202
    assert post(client, token, data={"text": "3"}).status_code == 429
