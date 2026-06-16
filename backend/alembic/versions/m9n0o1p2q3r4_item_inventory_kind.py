"""item inventory_kind classification

Revision ID: m9n0o1p2q3r4
Revises: l8m9n0o1p2q3
Create Date: 2026-04-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "m9n0o1p2q3r4"
down_revision = "l8m9n0o1p2q3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("items"):
        return
    cols = {c["name"] for c in insp.get_columns("items")}
    if "inventory_kind" not in cols:
        op.add_column(
            "items",
            sa.Column("inventory_kind", sa.String(length=32), nullable=True),
        )

    # Backfill: service → service; stocked → inventory; else non-inventory (legacy had no "other")
    op.execute(
        text(
            """
            UPDATE items SET inventory_kind = CASE
                WHEN type = 'service' THEN 'service'
                WHEN is_stock_tracked THEN 'inventory'
                ELSE 'non_inventory'
            END
            WHERE inventory_kind IS NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("items"):
        return
    cols = {c["name"] for c in insp.get_columns("items")}
    if "inventory_kind" in cols:
        op.drop_column("items", "inventory_kind")
