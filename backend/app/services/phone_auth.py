"""Вход по номеру телефона через звонок (SMS.RU callcheck).

Человек вводит номер → получает номер 8-800 → звонит на него (бесплатно, звонок сразу
сбрасывается) → провайдер подтверждает, что звонок был именно с этого номера.

Без ключа SMS.RU вне продакшна работает имитация: номер подтверждается сразу — для
локальной разработки и тестов. В продакшне без ключа вход недоступен.
"""

import hashlib
import hmac
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app.config import Settings, get_settings
from app.services import telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

CHECK_TTL = timedelta(minutes=5)  # столько SMS.RU ждёт звонка
POLL_INTERVAL = timedelta(seconds=2)  # не дёргаем провайдера чаще
# 3 звонка на номер за 3 минуты — потом подождать; на адрес — свой лимит в час
PER_PHONE_LIMIT = (3, timedelta(minutes=3))
PER_IP_LIMIT = (10, timedelta(hours=1))

# PIN-код для быстрого входа без звонка
PIN_RE = re.compile(r"^\d{4}$")
PIN_MAX_FAILURES = 5  # подряд — дальше вход только звонком
PIN_LOCK = timedelta(minutes=15)
PIN_IP_LIMIT = (20, timedelta(hours=1))  # неудачных попыток с одного адреса
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


class PhoneAuthError(Exception):
    """Ошибка, которую можно показать пользователю."""


class ProviderUnavailableError(PhoneAuthError):
    pass


def normalize_phone(raw: str) -> str:
    """Российский мобильный номер в виде 7XXXXXXXXXX; иначе — PhoneAuthError."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits[0] in "78":
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    if not re.fullmatch(r"79\d{9}", digits):
        raise PhoneAuthError("Нужен российский мобильный номер: +7 9XX XXX-XX-XX")
    return digits


def mask_phone(phone: str) -> str:
    """+7 9** ***-45-67 — показываем, не раскрывая номер целиком."""
    return f"+7 {phone[1]}** ***-{phone[7:9]}-{phone[9:11]}"


@dataclass
class StartedCheck:
    provider_check_id: str
    call_phone: str
    call_phone_pretty: str


class SmsRuVerifier:
    """Клиент SMS.RU: callcheck/add и callcheck/status."""

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self._settings = settings
        self._transport = transport

    def _get(self, path: str, params: dict) -> dict:
        try:
            with httpx.Client(
                base_url=self._settings.smsru_base_url, timeout=15, transport=self._transport
            ) as client:
                response = client.get(
                    path, params={"api_id": self._settings.smsru_api_id, "json": 1, **params}
                )
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailableError(
                "Сервис подтверждения недоступен, попробуйте позже"
            ) from exc
        if data.get("status") != "OK":
            logger.warning("SMS.RU %s: %s", path, data)
            raise ProviderUnavailableError("Не получилось начать проверку номера, попробуйте позже")
        return data

    def start(self, phone: str) -> StartedCheck:
        with telemetry.track_call(Kind.PHONE_AUTH, "callcheck.add") as call:
            try:
                data = self._get("/callcheck/add", {"phone": phone})
            except PhoneAuthError:
                call.status, call.error_code = "error", "provider"
                raise
        return StartedCheck(
            provider_check_id=str(data["check_id"]),
            call_phone=str(data["call_phone"]),
            call_phone_pretty=str(data.get("call_phone_pretty") or data["call_phone"]),
        )

    def is_confirmed(self, provider_check_id: str) -> bool | None:
        """True — звонок был; False — время вышло; None — ещё ждём."""
        data = self._get("/callcheck/status", {"check_id": provider_check_id})
        code = int(data.get("check_status", 0))
        if code == 401:
            return True
        if code == 402:
            return False
        return None


class FakeVerifier:
    """Имитация для разработки и тестов: номер подтверждается сразу."""

    def start(self, phone: str) -> StartedCheck:
        return StartedCheck("fake-" + phone, "78000000000", "8 (800) 000-00-00")

    def is_confirmed(self, provider_check_id: str) -> bool | None:
        return True


def get_verifier(settings: Settings | None = None) -> SmsRuVerifier | FakeVerifier:
    settings = settings or get_settings()
    if settings.smsru_api_id:
        return SmsRuVerifier(settings)
    if settings.is_production:
        raise ProviderUnavailableError("Вход по телефону временно недоступен")
    return FakeVerifier()


def check_limits(recent_for_phone: int, recent_for_ip: int) -> None:
    if recent_for_phone >= PER_PHONE_LIMIT[0]:
        minutes = int(PER_PHONE_LIMIT[1].total_seconds() // 60)
        raise PhoneAuthError(f"Слишком много попыток для этого номера. Подождите {minutes} минуты")
    if recent_for_ip >= PER_IP_LIMIT[0]:
        raise PhoneAuthError("Слишком много попыток. Попробуйте через час")


def is_expired(created_at: datetime, now: datetime) -> bool:
    return now - created_at > CHECK_TTL


# ---------- PIN-код ----------


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def pin_locked(locked_until: datetime | None, now: datetime) -> bool:
    return locked_until is not None and locked_until > now
