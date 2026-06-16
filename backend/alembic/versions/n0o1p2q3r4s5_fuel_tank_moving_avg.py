"""fuel_tanks moving_avg_unit_cost for WAC-backed issues and GL alignment

Revision ID: n0o1p2q3r4s5
Revises: m9n0o1p2q3r4
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "n0o1p2q3r4s5"
down_revision = "m9n0o1p2q3r4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("fuel_tanks"):
        return
    cols = {c["name"] for c in insp.get_columns("fuel_tanks")}
    if "moving_avg_unit_cost" not in cols:
        op.add_column(
            "fuel_tanks",
            sa.Column("moving_avg_unit_cost", sa.Numeric(15, 4), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("fuel_tanks"):
        return
    cols = {c["name"] for c in insp.get_columns("fuel_tanks")}
    if "moving_avg_unit_cost" in cols:
        with op.batch_alter_table("fuel_tanks") as batch_op:
            batch_op.drop_column("moving_avg_unit_cost")
