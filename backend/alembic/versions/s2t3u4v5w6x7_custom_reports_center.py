"""custom reports center table

Revision ID: s2t3u4v5w6x7
Revises: r1s2t3u4v5w6
Create Date: 2026-04-25
"""
from alembic import op
import sqlalchemy as sa


revision = "s2t3u4v5w6x7"
down_revision = "r1s2t3u4v5w6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_custom_reports_id"), "custom_reports", ["id"], unique=False)
    op.create_index(op.f("ix_custom_reports_tenant_id"), "custom_reports", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_custom_reports_created_by"), "custom_reports", ["created_by"], unique=False)
    op.create_index(op.f("ix_custom_reports_source"), "custom_reports", ["source"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_custom_reports_source"), table_name="custom_reports")
    op.drop_index(op.f("ix_custom_reports_created_by"), table_name="custom_reports")
    op.drop_index(op.f("ix_custom_reports_tenant_id"), table_name="custom_reports")
    op.drop_index(op.f("ix_custom_reports_id"), table_name="custom_reports")
    op.drop_table("custom_reports")
