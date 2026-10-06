"""Генерирует ключи VAPID для Web Push и SECRET_KEY в формате строк .env.

Запуск на сервере: python3 deploy/gen_keys.py >> .env (значения не печатаются в консоль).
Нужен пакет cryptography (есть в образе приложения).
"""

import base64
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
private = key.private_numbers().private_value.to_bytes(32, "big")
public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
print(f"VAPID_PUBLIC_KEY={b64(public)}")
print(f"VAPID_PRIVATE_KEY={b64(private)}")
print(f"SECRET_KEY={secrets.token_urlsafe(32)}")
