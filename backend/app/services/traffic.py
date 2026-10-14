"""Источник трафика: откуда пришёл человек. Пишется в аккаунт один раз — при регистрации.

Клиент запоминает первую точку входа (web/src/source.ts) и присылает её в заголовке
X-Source: метку рекламной ссылки (utm_source), место QR-кода (utm_source=qr_<место>)
или сайт, с которого был переход. Приглашение в семью и ссылку-рекомендацию сервер
определяет сам — при вступлении в семью и при создании семьи по рекомендации.
"""

import re
from collections.abc import Mapping

FAMILY_INVITE = "family_invite"  # пришёл по приглашению в семью (ссылка, QR, SMS)
REFERRAL = "referral"  # по ссылке «Посоветуйте знакомым» (/?from=<код>)
DIRECT = "direct"  # ввёл адрес сам, закладка, ярлык
UNKNOWN_BEFORE = "unknown_before_15_10"  # до 15.10.2026 источник не записывали

_ALLOWED = re.compile(r"^(direct|(utm|qr|site):[a-z0-9._-]{1,70})$")


def parse(headers: Mapping[str, str]) -> str:
    """Источник из заголовка X-Source; всё непохожее на ожидаемый формат — direct."""
    value = (headers.get("x-source") or "").strip().lower()
    return value if _ALLOWED.match(value) else DIRECT
