"""Источник трафика и стоимость LLM

Revision ID: 3c5e9a1d7b20
Revises: e8066c40762f
Create Date: 2026-10-14 23:23:15.191272
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3c5e9a1d7b20"
down_revision: str | None = "e8066c40762f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("source", sa.String(length=80), nullable=True))
    op.add_column("component_calls", sa.Column("cost_rub", sa.Float(), nullable=True))
    # Пришедшим до 15.10.2026 источник восстанавливаем по базе, где это возможно:
    # вступил в уже существующую семью — приглашение; создал семью по рекомендации — она
    op.execute(
        """
        UPDATE accounts SET source = 'family_invite'
        WHERE id IN (
            SELECT m.account_id FROM members m
            WHERE m.account_id IS NOT NULL
              AND m.created_at > (
                  SELECT MIN(m2.created_at) FROM members m2 WHERE m2.family_id = m.family_id
              )
        )
        """
    )
    op.execute(
        """
        UPDATE accounts SET source = 'referral'
        WHERE source IS NULL AND id IN (
            SELECT m.account_id FROM members m JOIN families f ON f.id = m.family_id
            WHERE m.account_id IS NOT NULL AND f.referred_by_id IS NOT NULL
        )
        """
    )
    op.execute("UPDATE accounts SET source = 'unknown_before_15_10' WHERE source IS NULL")


def downgrade() -> None:
    op.drop_column("component_calls", "cost_rub")
    op.drop_column("accounts", "source")
