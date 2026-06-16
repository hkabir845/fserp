"""Fuel ↔ PO integration, cost centers, journal line dimensions, fuel_txn GL link

Revision ID: l8m9n0o1p2q3
Revises: k7l8m9n0o1p2
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "l8m9n0o1p2q3"
down_revision = "k7l8m9n0o1p2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("cost_centers"):
        op.create_table(
            "cost_centers",
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("name", sa.String(length=256), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "code", name="uq_cost_centers_tenant_code"),
        )
        op.create_index(op.f("ix_cost_centers_tenant_id"), "cost_centers", ["tenant_id"], unique=False)

    ft_cols = {c["name"] for c in insp.get_columns("fuel_txns")} if insp.has_table("fuel_txns") else set()
    vfi_cols = {c["name"] for c in insp.get_columns("vehicle_fuel_issues")} if insp.has_table("vehicle_fuel_issues") else set()
    jl_cols = {c["name"] for c in insp.get_columns("journal_lines")} if insp.has_table("journal_lines") else set()

    if bind.dialect.name == "sqlite":
        if "po_line_id" not in ft_cols:
            with op.batch_alter_table("fuel_txns", schema=None) as batch_op:
                batch_op.add_column(sa.Column("po_line_id", sa.Integer(), nullable=True))
                batch_op.add_column(sa.Column("journal_entry_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_fuel_txns_po_line",
                    "purchase_order_lines",
                    ["po_line_id"],
                    ["id"],
                )
                batch_op.create_foreign_key(
                    "fk_fuel_txns_journal",
                    "journal_entries",
                    ["journal_entry_id"],
                    ["id"],
                )
        if "cost_center_id" not in vfi_cols:
            with op.batch_alter_table("vehicle_fuel_issues", schema=None) as batch_op:
                batch_op.add_column(sa.Column("cost_center_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_vehicle_fuel_issues_cc",
                    "cost_centers",
                    ["cost_center_id"],
                    ["id"],
                )
        if "cost_center_id" not in jl_cols:
            with op.batch_alter_table("journal_lines", schema=None) as batch_op:
                batch_op.add_column(sa.Column("cost_center_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_journal_lines_cost_center",
                    "cost_centers",
                    ["cost_center_id"],
                    ["id"],
                )
    else:
        if "po_line_id" not in ft_cols:
            op.add_column("fuel_txns", sa.Column("po_line_id", sa.Integer(), nullable=True))
            op.add_column("fuel_txns", sa.Column("journal_entry_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_fuel_txns_po_line",
                "fuel_txns",
                "purchase_order_lines",
                ["po_line_id"],
                ["id"],
            )
            op.create_foreign_key(
                "fk_fuel_txns_journal",
                "fuel_txns",
                "journal_entries",
                ["journal_entry_id"],
                ["id"],
            )
        if "cost_center_id" not in vfi_cols:
            op.add_column("vehicle_fuel_issues", sa.Column("cost_center_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_vehicle_fuel_issues_cc",
                "vehicle_fuel_issues",
                "cost_centers",
                ["cost_center_id"],
                ["id"],
            )
        if "cost_center_id" not in jl_cols:
            op.add_column("journal_lines", sa.Column("cost_center_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_journal_lines_cost_center",
                "journal_lines",
                "cost_centers",
                ["cost_center_id"],
                ["id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("journal_lines", schema=None) as batch_op:
            batch_op.drop_constraint("fk_journal_lines_cost_center", type_="foreignkey")
            batch_op.drop_column("cost_center_id")
        with op.batch_alter_table("vehicle_fuel_issues", schema=None) as batch_op:
            batch_op.drop_constraint("fk_vehicle_fuel_issues_cc", type_="foreignkey")
            batch_op.drop_column("cost_center_id")
        with op.batch_alter_table("fuel_txns", schema=None) as batch_op:
            batch_op.drop_constraint("fk_fuel_txns_journal", type_="foreignkey")
            batch_op.drop_constraint("fk_fuel_txns_po_line", type_="foreignkey")
            batch_op.drop_column("journal_entry_id")
            batch_op.drop_column("po_line_id")
    else:
        op.drop_constraint("fk_journal_lines_cost_center", "journal_lines", type_="foreignkey")
        op.drop_column("journal_lines", "cost_center_id")
        op.drop_constraint("fk_vehicle_fuel_issues_cc", "vehicle_fuel_issues", type_="foreignkey")
        op.drop_column("vehicle_fuel_issues", "cost_center_id")
        op.drop_constraint("fk_fuel_txns_journal", "fuel_txns", type_="foreignkey")
        op.drop_constraint("fk_fuel_txns_po_line", "fuel_txns", type_="foreignkey")
        op.drop_column("fuel_txns", "journal_entry_id")
        op.drop_column("fuel_txns", "po_line_id")

    op.drop_index(op.f("ix_cost_centers_tenant_id"), table_name="cost_centers")
    op.drop_table("cost_centers")
