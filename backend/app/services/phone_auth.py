"""Вход по номеру телефона через звонок (SMS.RU callcheck).

Человек вводит номер → получает номер 8-800 → звонит на него (бесплатно, звонок сразу
сбрасывается) → провайдер подтверждает, что звонок был именно с этого номера.

Без ключа SMS.RU вне продакшна работает имитация: номер подтверждается сразу — для
локальной разработки и тестов. В продакшне без ключа вход недоступен.
"""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app.config import Settings, get_settings
from app.services import telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

CHECK_TTL = timedelta(minutes=5)  # столько SMS.RU ждёт звонка
POLL_INTERVAL = timedelta(seconds=2)  # не дёргаем провайдера чаще
PER_PHONE_LIMIT = (3, timedelta(minutes=10))
PER_IP_LIMIT = (10, timedelta(hours=1))


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
        raise PhoneAuthError("Слишком много попыток для этого номера. Подождите 10 минут")
    if recent_for_ip >= PER_IP_LIMIT[0]:
        raise PhoneAuthError("Слишком много попыток. Попробуйте через час")


def is_expired(created_at: datetime, now: datetime) -> bool:
    return now - created_at > CHECK_TTL
