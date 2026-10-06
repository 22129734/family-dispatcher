"""Подключение к базе данных.

Локально по умолчанию используется SQLite-файл, чтобы проект запускался без Docker.
На сервере DATABASE_URL указывает на PostgreSQL (docker-compose), схему ведут миграции Alembic.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)
    return create_engine(url, pool_pre_ping=True)


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Локально (SQLite) и в тестах создаём таблицы сами; в PostgreSQL схему ведёт Alembic."""
    from app import models  # noqa: F401 — регистрирует таблицы в metadata

    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
