"""Письма команде через SMTP (Яндекс Почта): утренний отчёт и обращения пользователей."""

import smtplib
from email.message import EmailMessage

from app.config import Settings, get_settings


def send_mail(
    subject: str,
    body: str,
    attachment: tuple[str, bytes, str] | None = None,
    settings: Settings | None = None,
) -> None:
    """attachment — (имя файла, содержимое, MIME-тип)."""
    settings = settings or get_settings()
    if not settings.smtp_user or not settings.smtp_password:
        raise RuntimeError("SMTP_USER и SMTP_PASSWORD не заданы")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_user
    message["To"] = settings.report_to
    message.set_content(body)
    if attachment:
        name, data, mime = attachment
        maintype, _, subtype = mime.partition("/")
        message.add_attachment(
            data, maintype=maintype, subtype=subtype or "octet-stream", filename=name
        )
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)
