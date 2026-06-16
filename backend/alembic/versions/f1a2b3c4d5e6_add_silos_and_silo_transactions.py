"""add silos and silo transactions

Revision ID: f1a2b3c4d5e6
Revises: e0b0bac3501c
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa


revision = "f1a2b3c4d5e6"
down_revision = "e0b0bac3501c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "silos",
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("capacity_kg", sa.Numeric(precision=15, scale=3), nullable=True),
        sa.Column("current_qty_kg", sa.Numeric(precision=15, scale=3), nullable=False),
        sa.Column("reorder_min_kg", sa.Numeric(precision=15, scale=3), nullable=True),
        sa.Column("integration_source", sa.String(), nullable=False),
        sa.Column("external_device_id", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_silos_code"), "silos", ["code"], unique=False)
    op.create_index(op.f("ix_silos_id"), "silos", ["id"], unique=False)
    op.create_index(op.f("ix_silos_item_id"), "silos", ["item_id"], unique=False)
    op.create_index(op.f("ix_silos_tenant_id"), "silos", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_silos_warehouse_id"), "silos", ["warehouse_id"], unique=False)
    op.create_index("idx_silo_tenant_wh_item", "silos", ["tenant_id", "warehouse_id", "item_id"], unique=False)

    op.create_table(
        "silo_transactions",
        sa.Column("silo_id", sa.Integer(), nullable=False),
        sa.Column("qty_delta", sa.Numeric(precision=15, scale=3), nullable=False),
        sa.Column("ref_type", sa.String(), nullable=False),
        sa.Column("ref_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["silo_id"], ["silos.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_silo_transactions_id"), "silo_transactions", ["id"], unique=False)
    op.create_index(op.f("ix_silo_transactions_silo_id"), "silo_transactions", ["silo_id"], unique=False)
    op.create_index(op.f("ix_silo_transactions_tenant_id"), "silo_transactions", ["tenant_id"], unique=False)
    op.create_index("idx_silo_txn_silo", "silo_transactions", ["tenant_id", "silo_id"], unique=False)

    # SQLite cannot add a foreign key via ALTER; use batch mode (table copy).
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("production_order_lines", schema=None) as batch_op:
            batch_op.add_column(sa.Column("silo_id", sa.Integer(), nullable=True))
            batch_op.add_column(
                sa.Column("silo_consumed_kg", sa.Numeric(precision=15, scale=3), nullable=True),
            )
            batch_op.create_foreign_key(
                "fk_production_order_lines_silo_id_silos",
                "silos",
                ["silo_id"],
                ["id"],
            )
            batch_op.create_index(
                "ix_production_order_lines_silo_id",
                ["silo_id"],
                unique=False,
            )
    else:
        op.add_column(
            "production_order_lines",
            sa.Column("silo_id", sa.Integer(), nullable=True),
        )
        op.add_column(
            "production_order_lines",
            sa.Column("silo_consumed_kg", sa.Numeric(precision=15, scale=3), nullable=True),
        )
        op.create_foreign_key(
            "fk_production_order_lines_silo_id_silos",
            "production_order_lines",
            "silos",
            ["silo_id"],
            ["id"],
        )
        op.create_index(
            op.f("ix_production_order_lines_silo_id"),
            "production_order_lines",
            ["silo_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("production_order_lines", schema=None) as batch_op:
            batch_op.drop_index("ix_production_order_lines_silo_id")
            batch_op.drop_constraint("fk_production_order_lines_silo_id_silos", type_="foreignkey")
            batch_op.drop_column("silo_consumed_kg")
            batch_op.drop_column("silo_id")
    else:
        op.drop_index(op.f("ix_production_order_lines_silo_id"), table_name="production_order_lines")
        op.drop_constraint("fk_production_order_lines_silo_id_silos", "production_order_lines", type_="foreignkey")
        op.drop_column("production_order_lines", "silo_consumed_kg")
        op.drop_column("production_order_lines", "silo_id")

    op.drop_index("idx_silo_txn_silo", table_name="silo_transactions")
    op.drop_index(op.f("ix_silo_transactions_tenant_id"), table_name="silo_transactions")
    op.drop_index(op.f("ix_silo_transactions_silo_id"), table_name="silo_transactions")
    op.drop_index(op.f("ix_silo_transactions_id"), table_name="silo_transactions")
    op.drop_table("silo_transactions")

    op.drop_index("idx_silo_tenant_wh_item", table_name="silos")
    op.drop_index(op.f("ix_silos_warehouse_id"), table_name="silos")
    op.drop_index(op.f("ix_silos_tenant_id"), table_name="silos")
    op.drop_index(op.f("ix_silos_item_id"), table_name="silos")
    op.drop_index(op.f("ix_silos_id"), table_name="silos")
    op.drop_index(op.f("ix_silos_code"), table_name="silos")
    op.drop_table("silos")
