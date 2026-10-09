"""Карточка ссылки-приглашения: ВК, Max и Telegram читают og:title из HTML страницы.

Для /join/<код> и /?from=<код> подставляем имя того, кто зовёт, — человек ещё до перехода
видит, что ссылку прислал знакомый, а не неизвестный сайт.
"""

from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FamilyRow

DEFAULT_TITLE = "Семейный диспетчер — попросил, сделано"
DEFAULT_DESCRIPTION = (
    "Общие дела семьи голосом: ИИ поймёт, кому и на когда, и напомнит. "
    "Близкий нажмёт «Беру», а вы увидите «Сделано». Без скачивания."
)


def _replace_meta(html: str, title: str, description: str) -> str:
    title, description = escape(title, quote=True), escape(description, quote=True)
    html = html.replace(
        f'<meta property="og:title" content="{DEFAULT_TITLE}"',
        f'<meta property="og:title" content="{title}"',
    )
    html = html.replace(
        f'<meta property="og:description" content="{DEFAULT_DESCRIPTION}"',
        f'<meta property="og:description" content="{description}"',
    )
    return html.replace(f"<title>{DEFAULT_TITLE}</title>", f"<title>{title}</title>")


def personalize(html: str, path: str, ref: str | None, db: Session) -> str:
    """index.html с именем пригласившего в заголовке карточки; иначе — как есть."""
    if path.startswith("join/"):
        code = path.removeprefix("join/").strip("/")
        family = db.scalar(select(FamilyRow).where(FamilyRow.invite_code == code))
        if family and family.members:
            name = family.members[0].name
            return _replace_meta(
                html,
                f"{name} приглашает вас в «Семейный диспетчер»",
                f"{name} зовёт вести семейные дела вместе: просьбы голосом, «Беру» и «Сделано». "
                "Нажмите, чтобы присоединиться.",
            )
    elif ref:
        family = db.scalar(select(FamilyRow).where(FamilyRow.ref_code == ref))
        if family and family.members:
            return _replace_meta(
                html, f"{family.members[0].name} советует «Семейный диспетчер»", DEFAULT_DESCRIPTION
            )
    return html
