"""Push-токены Android-приложения из RuStore

Revision ID: 7a1c2e9d4b60
Revises: 5b1d7e3a9c42
Create Date: 2026-10-30 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7a1c2e9d4b60"
down_revision: str | None = "5b1d7e3a9c42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "native_push_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("member_id", sa.String(length=32), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False, server_default="rustore"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        op.f("ix_native_push_tokens_member_id"), "native_push_tokens", ["member_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_native_push_tokens_member_id"), table_name="native_push_tokens")
    op.drop_table("native_push_tokens")
