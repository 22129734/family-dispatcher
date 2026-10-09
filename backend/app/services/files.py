"""Файлы к задачам: QR-код получения с Ozon или Wildberries, фото записки, PDF.

Файлы лежат на нашем сервере (не в облаке), имя на диске — случайный id без расширения.
Отдаются по подписанной ссылке: <img src> не умеет передавать токен в заголовке, поэтому
в ссылку добавляется HMAC от id файла — без подписи файл не открыть, перебрать id нельзя.
"""

import hashlib
import hmac
from pathlib import Path

from app.config import get_settings
from app.models import TaskFileRow

MAX_BYTES = 10 * 1024 * 1024  # 10 МБ: телефонное фото после сжатия на клиенте — 0,3–1 МБ
MAX_PER_TASK = 5
ALLOWED = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG",
    "image/webp": b"RIFF",
    "application/pdf": b"%PDF",
}


class FileError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


def storage_dir() -> Path:
    path = Path(get_settings().uploads_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def path_of(file: TaskFileRow) -> Path:
    return storage_dir() / file.id


def check(content_type: str, data: bytes, already: int) -> None:
    if already >= MAX_PER_TASK:
        raise FileError(409, f"К задаче можно прикрепить не больше {MAX_PER_TASK} файлов")
    if not data:
        raise FileError(422, "Файл пустой")
    if len(data) > MAX_BYTES:
        raise FileError(413, "Файл больше 10 МБ")
    magic = ALLOWED.get(content_type)
    if magic is None or not data.startswith(magic):
        raise FileError(415, "Можно прикрепить фото (JPEG, PNG, WebP) или PDF")


def save(file: TaskFileRow, data: bytes) -> None:
    path_of(file).write_bytes(data)


def remove(file: TaskFileRow) -> None:
    path_of(file).unlink(missing_ok=True)


def signature(file_id: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"file:{file_id}".encode(), hashlib.sha256).hexdigest()[:32]


def url(file: TaskFileRow) -> str:
    return f"/api/v1/files/{file.id}?sig={signature(file.id)}"


def valid(file_id: str, sig: str) -> bool:
    return hmac.compare_digest(signature(file_id), sig)
