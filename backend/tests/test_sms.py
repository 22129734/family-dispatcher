"""СМС через SMS.RU — без сети."""

import httpx
import pytest

from app.config import Settings
from app.services import sms

SETTINGS = Settings(smsru_api_id="key", smsru_base_url="https://sms.test")


def reply(body: dict) -> httpx.MockTransport:
    return httpx.MockTransport(lambda request: httpx.Response(200, json=body))


def test_sms_sent() -> None:
    ok = {"status": "OK", "sms": {"79990001122": {"status": "OK", "sms_id": "1"}}}
    sms.send("79990001122", "текст", SETTINGS, reply(ok))


def test_sms_error_is_shown() -> None:
    bad = {
        "status": "OK",
        "sms": {"79990001122": {"status": "ERROR", "status_code": 207, "status_text": "Нельзя"}},
    }
    with pytest.raises(sms.SmsError, match="Нельзя"):
        sms.send("79990001122", "текст", SETTINGS, reply(bad))


def test_invite_text_fits_and_has_latin_link() -> None:
    text = sms.invite_text("Анастасия", "AbC12345")
    assert "semeinidispetcher.ru/join/AbC12345" in text
    assert len(text) <= 70  # одно СМС кириллицей
