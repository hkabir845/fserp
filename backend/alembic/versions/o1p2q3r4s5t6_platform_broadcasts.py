"""platform_broadcasts for tenant announcements

Revision ID: o1p2q3r4s5t6
Revises: n0o1p2q3r4s5
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "o1p2q3r4s5t6"
down_revision = "n0o1p2q3r4s5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("platform_broadcasts"):
        return
    op.create_table(
        "platform_broadcasts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("target_tenant_domains", sa.JSON(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["platform_users.id"], name="fk_platform_broadcasts_author"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_broadcasts_status", "platform_broadcasts", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("platform_broadcasts"):
        return
    op.drop_index("ix_platform_broadcasts_status", table_name="platform_broadcasts")
    op.drop_table("platform_broadcasts")
