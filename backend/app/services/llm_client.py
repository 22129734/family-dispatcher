"""Клиент LLM через OpenAI-совместимый API (Chat Completions + tools).

В программе Sber500 это шлюз к моделям Cloud.ru Foundation Models; подойдёт и любой
другой совместимый провайдер. Если ключ или модель не заданы, методы возвращают None
и вызывающая сторона переходит на детерминированный разбор правилами.

Каждый запрос учитывается как два обращения к компонентам (Положение, прил. 2, п. 2.2):
вызов фундаментальной модели и навык — системный промпт с инструментами над ней.
"""

import json
import logging

import httpx

from app.config import get_settings
from app.services import telemetry
from app.services.telemetry import Kind

logger = logging.getLogger(__name__)

EXTRACT_TASK_FUNCTION = {
    "name": "create_task",
    "description": "Создать домашнюю задачу из сообщения члена семьи",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Что нужно сделать, в инфинитиве"},
            "beneficiary": {"type": "string", "description": "Для кого делается задача"},
            "due_at": {
                "type": "string",
                "description": "Крайний срок: местное время семьи, ISO 8601 без часового пояса",
            },
            "duration_minutes": {"type": "integer", "description": "Ожидаемая длительность"},
            "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            "recurrence": {
                "type": "string",
                "enum": ["none", "daily", "weekdays", "weekly", "monthly"],
                "description": "Повтор: weekdays — по будням (пн–пт)",
            },
            "requires_car": {"type": "boolean"},
            "location": {"type": "string"},
            "clarifying_question": {
                "type": "string",
                "description": "Один уточняющий вопрос, если сообщение неоднозначно",
            },
            "items": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Если нужно купить несколько вещей — список покупок по одной вещи "
                    "в именительном падеже, с количеством, если оно сказано "
                    "(«молоко 2 л», «хлеб», «яйца»); title тогда — «Купить продукты» или похожее"
                ),
            },
            "assignee": {
                "type": "string",
                "description": (
                    "Кто сделает, только если это сказано явно: «self» — автор берёт дело "
                    "на себя («я заберу», «напомни мне», «сама схожу»); имя члена семьи — "
                    "если сказано, кому поручить; иначе не заполнять"
                ),
            },
        },
        "required": ["title"],
    },
}

EXTRACT_SYSTEM_PROMPT = (
    "Ты — диспетчер домашних дел русскоязычной семьи. "
    "Из сообщения выдели ровно одну задачу и вызови функцию create_task. "
    "Понимай разговорную речь, уменьшительные формы и относительные даты "
    "(«завтра», «в пятницу вечером», «до конца недели»). "
    "Время — местное время семьи, без часового пояса и без «Z». "
    "Время суток без дня означает сегодня, а если это время уже прошло — завтра: "
    "«после работы» и «вечером» — 19:00, «утром» — 9:00, «днём» — 13:00, «перед сном» — 21:00, "
    "«в 19» — сегодня в 19:00. День без времени — 18:00 этого дня. "
    "Срок заполняй всегда, когда в сообщении есть день или время суток. "
    "Если чего-то не хватает для однозначного понимания — задай ровно один "
    "короткий уточняющий вопрос, не выдумывай детали."
)


class LLMError(Exception):
    """Ответ модели не удалось получить или разобрать."""


class LLMClient:
    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._settings = get_settings()
        self._transport = transport

    @property
    def enabled(self) -> bool:
        return self._settings.llm_enabled

    def _chat(self, skill: str, body: dict) -> dict:
        """Один запрос к модели с учётом двух обращений: модель + навык."""
        settings = self._settings
        body = {"model": settings.llm_model, **body}
        with telemetry.track_call(Kind.SKILL, skill):
            with telemetry.track_call(Kind.LLM, "chat.completions") as call:
                call.model = settings.llm_model
                try:
                    with httpx.Client(
                        base_url=settings.llm_base_url,
                        timeout=settings.llm_timeout_s,
                        transport=self._transport,
                    ) as client:
                        response = client.post(
                            "/chat/completions",
                            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                            json=body,
                        )
                except httpx.HTTPError as exc:
                    call.error_code = type(exc).__name__
                    raise LLMError(str(exc)) from exc
                if response.status_code != 200:
                    call.error_code = f"http_{response.status_code}"
                    raise LLMError(f"LLM ответил {response.status_code}: {response.text[:200]}")
                data = response.json()
                usage = data.get("usage") or {}
                call.tokens_in = usage.get("prompt_tokens")
                call.tokens_out = usage.get("completion_tokens")
                return data

    def extract_task(
        self,
        message: str,
        now_iso: str,
        author: str | None = None,
        members: list[str] | None = None,
    ) -> dict | None:
        """Аргументы вызова create_task или None, если модель недоступна."""
        if not self.enabled:
            return None
        context = f"Сейчас: {now_iso}."
        if author:
            context += f" Автор сообщения: {author}."
        if members:
            context += f" Остальные члены семьи: {', '.join(members)}."
        try:
            data = self._chat(
                "extract_task",
                {
                    "messages": [
                        {
                            "role": "system",
                            "content": f"{EXTRACT_SYSTEM_PROMPT}\nСейчас: {now_iso}.",
                        },
                        {"role": "user", "content": message},
                    ],
                    "tools": [{"type": "function", "function": EXTRACT_TASK_FUNCTION}],
                    "tool_choice": {"type": "function", "function": {"name": "create_task"}},
                    "temperature": 0.1,
                },
            )
            return _tool_arguments(data, "create_task")
        except LLMError:
            logger.exception("Не удалось разобрать задачу моделью")
            return None


def _tool_arguments(data: dict, name: str) -> dict | None:
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError) as exc:
        raise LLMError("В ответе нет choices[0].message") from exc
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        if function.get("name") == name:
            arguments = function.get("arguments") or "{}"
            try:
                return json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
            except json.JSONDecodeError as exc:
                raise LLMError("Аргументы функции — не JSON") from exc
    return None
