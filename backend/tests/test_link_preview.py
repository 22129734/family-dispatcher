"""Карточка ссылки-приглашения: имя пригласившего в og:title."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import FamilyRow, MemberRow
from app.services.link_preview import DEFAULT_TITLE, personalize


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


INDEX = (Path(__file__).resolve().parents[2] / "web" / "index.html").read_text(encoding="utf-8")


def test_index_has_default_preview() -> None:
    assert f'<meta property="og:title" content="{DEFAULT_TITLE}"' in INDEX
    assert 'property="og:image"' in INDEX


def test_invite_and_referral_titles(client) -> None:  # noqa: ARG001 — фикстура готовит базу
    with SessionLocal() as db:
        family = FamilyRow(name="Семья", invite_code="inv12345", ref_code="ref12345")
        family.members.append(MemberRow(name="Анна <3", role="adult"))
        db.add(family)
        db.commit()

        invite = personalize(INDEX, "join/inv12345", None, db)
        assert 'content="Анна &lt;3 приглашает вас в «Семейный диспетчер»"' in invite
        assert "<title>Анна &lt;3 приглашает" in invite

        referral = personalize(INDEX, "", "ref12345", db)
        assert 'content="Анна &lt;3 советует «Семейный диспетчер»"' in referral

        assert personalize(INDEX, "join/nope", None, db) == INDEX
