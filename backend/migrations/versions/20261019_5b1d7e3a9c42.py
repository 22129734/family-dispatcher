"""Разовые изменения повторяющегося дела

Revision ID: 5b1d7e3a9c42
Revises: 3c5e9a1d7b20
Create Date: 2026-10-19 09:40:48.265274
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b1d7e3a9c42"
down_revision: str | None = "3c5e9a1d7b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("series_base", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "series_base")
