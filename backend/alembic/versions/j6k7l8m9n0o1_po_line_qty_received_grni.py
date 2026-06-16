"""purchase_order_lines.qty_received + GRNI liability account for accrual posting

Revision ID: j6k7l8m9n0o1
Revises: i4j5k6l7m8n9
Create Date: 2026-04-21

"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "j6k7l8m9n0o1"
down_revision = "i4j5k6l7m8n9"
branch_labels = None
depends_on = None


def _seed_grni_per_tenant() -> None:
    conn = op.get_bind()
    now = datetime.utcnow()
    rows = conn.execute(text("SELECT id FROM tenants")).fetchall()
    for (tenant_id,) in rows:
        exists = conn.execute(
            text("SELECT 1 FROM accounts WHERE tenant_id = :tid AND code = '2010' LIMIT 1"),
            {"tid": tenant_id},
        ).scalar()
        if exists:
            continue
        conn.execute(
            text(
                """
                INSERT INTO accounts (code, name, type, is_active, tenant_id, created_at, updated_at, created_by, parent_id)
                VALUES ('2010', 'Goods Received Not Invoiced', 'liability', 1, :tid, :ca, :ua, NULL, NULL)
                """
            ),
            {"tid": tenant_id, "ca": now, "ua": now},
        )


def upgrade() -> None:
    op.add_column(
        "purchase_order_lines",
        sa.Column("qty_received", sa.Numeric(precision=15, scale=3), nullable=False, server_default="0"),
    )
    _seed_grni_per_tenant()


def downgrade() -> None:
    op.execute(
        "DELETE FROM accounts WHERE code = '2010' AND name = 'Goods Received Not Invoiced'"
    )
    op.drop_column("purchase_order_lines", "qty_received")
