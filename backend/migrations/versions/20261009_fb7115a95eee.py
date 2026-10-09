"""Ссылка-рекомендация для других семей

Revision ID: fb7115a95eee
Revises: 47fccb742891
Create Date: 2026-10-09 12:49:05.382242
"""

import secrets
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fb7115a95eee"
down_revision: str | None = "47fccb742891"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Сначала колонка без ограничений: существующим семьям раздаём коды, потом NOT NULL и UNIQUE
    with op.batch_alter_table("families", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ref_code", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("referred_by_id", sa.String(length=32), nullable=True))

    bind = op.get_bind()
    for (family_id,) in bind.execute(sa.text("SELECT id FROM families")).all():
        bind.execute(
            sa.text("UPDATE families SET ref_code = :code WHERE id = :id"),
            {"code": secrets.token_urlsafe(6), "id": family_id},
        )

    with op.batch_alter_table("families", schema=None) as batch_op:
        batch_op.alter_column("ref_code", existing_type=sa.String(length=32), nullable=False)
        batch_op.create_index(
            batch_op.f("ix_families_referred_by_id"), ["referred_by_id"], unique=False
        )
        batch_op.create_unique_constraint("uq_families_ref_code", ["ref_code"])
        batch_op.create_foreign_key(
            "fk_families_referred_by_id_families", "families", ["referred_by_id"], ["id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("families", schema=None) as batch_op:
        batch_op.drop_constraint("fk_families_referred_by_id_families", type_="foreignkey")
        batch_op.drop_constraint("uq_families_ref_code", type_="unique")
        batch_op.drop_index(batch_op.f("ix_families_referred_by_id"))
        batch_op.drop_column("referred_by_id")
        batch_op.drop_column("ref_code")
