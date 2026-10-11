"""СМС через SMS.RU — сейчас только приглашение в семью со ссылкой.

СМС платные (≈2–4 ₽), поэтому лимиты: на один номер — одно СМС в сутки,
от одной семьи — несколько в сутки. Без ключа SMS.RU (разработка, тесты) СМС не уходит.
"""

import logging

import httpx

from app.config import Settings, get_settings
from app.services import telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

# Короткая латинская ссылка: в СМС кликабельна везде, .ru перенаправляет на .рф с тем же путём
INVITE_HOST = "semeinidispetcher.ru"


class SmsError(Exception):
    """СМС не отправлено — показываем человеку."""


def invite_text(inviter: str, code: str) -> str:
    # Укладываемся в одно СМС (70 знаков кириллицей) при обычной длине имени
    return f"{inviter.strip()[:12]}: присоединяйся к семье {INVITE_HOST}/join/{code}"


def referral_text(name: str, ref_code: str) -> str:
    return f"{name.strip()[:12]} советует Семейный диспетчер: {INVITE_HOST}/?from={ref_code}"


def send(
    phone: str,
    text: str,
    settings: Settings | None = None,
    transport: httpx.BaseTransport | None = None,
) -> None:
    settings = settings or get_settings()
    if not settings.smsru_api_id:
        if settings.is_production:
            raise SmsError("Отправка СМС временно недоступна")
        logger.info("СМС (без отправки, нет ключа): %s", text)
        return
    with telemetry.track_call(Kind.SMS, "sms.send") as call:
        try:
            with httpx.Client(
                base_url=settings.smsru_base_url, timeout=10, transport=transport
            ) as client:
                data = client.get(
                    "/sms/send",
                    params={"api_id": settings.smsru_api_id, "to": phone, "msg": text, "json": 1},
                ).json()
        except (httpx.HTTPError, ValueError) as exc:
            call.error_code = type(exc).__name__
            raise SmsError("Не удалось отправить СМС, попробуйте позже") from exc
        status = (data.get("sms") or {}).get(phone, {})
        if data.get("status") != "OK" or status.get("status") != "OK":
            call.error_code = str(status.get("status_code") or data.get("status_code") or "error")
            raise SmsError(status.get("status_text") or "Не удалось отправить СМС")
