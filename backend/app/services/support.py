"""Обратная связь из приложения: голосовое и/или текст → письмо на ящик поддержки.

Голос расшифровывается моделью распознавания речи на шлюзе программы (whisper), чтобы
письмо можно было прочитать, не слушая. Сама запись уходит вложением и у нас не хранится.
"""

import logging
from datetime import datetime

import httpx

from app.config import get_settings
from app.services import telemetry
from app.services.mailer import send_mail
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 8 * 1024 * 1024  # ≈ 5 минут речи в webm/opus или m4a
DAILY_LIMIT = 10  # обращений от одного человека в сутки
AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}


def transcribe(audio: bytes, extension: str) -> str | None:
    """Текст голосового или None, если распознавание недоступно."""
    settings = get_settings()
    if not settings.llm_api_key or not settings.stt_model:
        return None
    try:
        with telemetry.track_call(Kind.STT, "support_feedback") as call:
            call.model = settings.stt_model
            response = httpx.post(
                f"{settings.llm_base_url.rstrip('/')}/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                data={"model": settings.stt_model, "language": "ru"},
                files={"file": (f"feedback.{extension}", audio, "application/octet-stream")},
                timeout=60,
            )
            if response.status_code != 200:
                call.error_code = f"http_{response.status_code}"
                raise RuntimeError(response.text[:200])
            return (response.json().get("text") or "").strip() or None
    except Exception:
        logger.exception("Не удалось расшифровать голосовое")
        return None


def deliver(
    *,
    who: str,
    phone: str,
    text: str | None,
    device: str | None,
    audio: bytes | None,
    content_type: str | None,
) -> None:
    """Собрать и отправить письмо (вызывается в фоне после ответа клиенту)."""
    extension = AUDIO_TYPES.get(content_type or "", "webm")
    transcript = transcribe(audio, extension) if audio else None
    stamp = datetime.now().strftime("%d.%m %H:%M")
    lines = [f"От: {who}, {phone}", f"Когда: {stamp}", ""]
    if text:
        lines += ["Текст:", text, ""]
    if audio:
        lines += [
            "Голосовое (расшифровка):",
            transcript or "— не удалось расшифровать, послушайте вложение —",
            "",
        ]
    if device:
        lines += ["— — —", device]
    preview = (text or transcript or "голосовое сообщение").replace("\n", " ")[:60]
    attachment = (
        (
            f"голосовое_{stamp.replace(' ', '_').replace(':', '-')}.{extension}",
            audio,
            content_type or "audio/webm",
        )
        if audio
        else None
    )
    with telemetry.track_call(Kind.EMAIL, "support_feedback"):
        send_mail(f"Отзыв из приложения: {preview}", "\n".join(lines), attachment)
