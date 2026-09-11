"""Тонкая обёртка над GigaChat API.

Изолирует остальной код от SDK и позволяет работать локально без учётных данных:
если ключи не заданы, клиент возвращает None и вызывающая сторона переходит
на детерминированный разбор.
"""

import json
import logging

from app.config import get_settings

logger = logging.getLogger(__name__)

EXTRACT_TASK_FUNCTION = {
    "name": "create_task",
    "description": "Создать домашнюю задачу из сообщения члена семьи",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Что нужно сделать, в инфинитиве"},
            "beneficiary": {"type": "string", "description": "Для кого делается задача"},
            "due_at": {"type": "string", "description": "Крайний срок в формате ISO 8601"},
            "duration_minutes": {"type": "integer", "description": "Ожидаемая длительность"},
            "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            "recurrence": {"type": "string", "enum": ["none", "daily", "weekly", "monthly"]},
            "requires_car": {"type": "boolean"},
            "location": {"type": "string"},
            "clarifying_question": {
                "type": "string",
                "description": "Один уточняющий вопрос, если сообщение неоднозначно",
            },
        },
        "required": ["title"],
    },
}

SYSTEM_PROMPT = (
    "Ты — диспетчер домашних дел русскоязычной семьи. "
    "Из сообщения выдели ровно одну задачу и вызови функцию create_task. "
    "Понимай разговорную речь, уменьшительные формы и относительные даты "
    "(«завтра», «в пятницу вечером», «до конца недели»). "
    "Если чего-то не хватает для однозначного понимания — задай ровно один "
    "короткий уточняющий вопрос, не выдумывай детали."
)


class GigaChatClient:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None

    @property
    def enabled(self) -> bool:
        return self._settings.gigachat_enabled

    def _ensure_client(self):
        if self._client is None:
            from gigachat import GigaChat

            self._client = GigaChat(
                credentials=self._settings.gigachat_credentials,
                scope=self._settings.gigachat_scope,
                model=self._settings.gigachat_model,
                verify_ssl_certs=self._settings.gigachat_verify_ssl,
            )
        return self._client

    def extract_task(self, message: str, now_iso: str) -> dict | None:
        """Вернуть аргументы вызова create_task или None, если GigaChat недоступен."""
        if not self.enabled:
            logger.info("GigaChat credentials are not set, falling back to rule-based parsing")
            return None

        from gigachat.models import Chat, Function, Messages, MessagesRole

        payload = Chat(
            messages=[
                Messages(role=MessagesRole.SYSTEM, content=f"{SYSTEM_PROMPT}\nСейчас: {now_iso}."),
                Messages(role=MessagesRole.USER, content=message),
            ],
            functions=[Function.model_validate(EXTRACT_TASK_FUNCTION)],
            function_call="auto",
            temperature=0.1,
        )

        try:
            response = self._ensure_client().chat(payload)
        except Exception:
            logger.exception("GigaChat call failed")
            return None

        call = response.choices[0].message.function_call
        if call is None:
            return None
        arguments = call.arguments
        return json.loads(arguments) if isinstance(arguments, str) else dict(arguments)

    def explain_assignment(self, task_title: str, assignee_name: str, reason: str) -> str:
        """Переформулировать техническое обоснование в человеческую фразу."""
        if not self.enabled:
            return f"{assignee_name}: {reason}"

        from gigachat.models import Chat, Messages, MessagesRole

        payload = Chat(
            messages=[
                Messages(
                    role=MessagesRole.SYSTEM,
                    content=(
                        "Объясни члену семьи в одном доброжелательном предложении, "
                        "почему задача назначена именно ему. Без канцелярита и упрёков."
                    ),
                ),
                Messages(
                    role=MessagesRole.USER,
                    content=(
                        f"Задача: {task_title}. Исполнитель: {assignee_name}. Причина: {reason}."
                    ),
                ),
            ],
            temperature=0.4,
        )

        try:
            return self._ensure_client().chat(payload).choices[0].message.content.strip()
        except Exception:
            logger.exception("GigaChat explanation failed")
            return f"{assignee_name}: {reason}"
