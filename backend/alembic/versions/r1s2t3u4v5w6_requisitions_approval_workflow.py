"""Purchase/sales requisitions with multi-level approval + PO/invoice source links.

Revision ID: r1s2t3u4v5w6
Revises: q7r8s9t0u1v2
Create Date: 2026-04-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "r1s2t3u4v5w6"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("purchase_requisitions"):
        op.create_table(
            "purchase_requisitions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("doc_number", sa.String(length=64), nullable=False),
            sa.Column("supplier_id", sa.Integer(), nullable=True),
            sa.Column("warehouse_id", sa.Integer(), nullable=True),
            sa.Column("needed_by", sa.DateTime(), nullable=True),
            sa.Column("purpose", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("converted_po_id", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["converted_po_id"], ["purchase_orders.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "doc_number", name="uq_pr_tenant_doc"),
        )
        op.create_index(
            op.f("ix_purchase_requisitions_doc_number"), "purchase_requisitions", ["doc_number"], unique=False
        )
        op.create_index(op.f("ix_purchase_requisitions_status"), "purchase_requisitions", ["status"], unique=False)
        op.create_index(op.f("ix_purchase_requisitions_tenant_id"), "purchase_requisitions", ["tenant_id"], unique=False)

    if not insp.has_table("purchase_requisition_lines"):
        op.create_table(
            "purchase_requisition_lines",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("pr_id", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column("qty", sa.Numeric(15, 3), nullable=False),
            sa.Column("est_unit_price", sa.Numeric(15, 2), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
            sa.ForeignKeyConstraint(["pr_id"], ["purchase_requisitions.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_purchase_requisition_lines_pr_id"), "purchase_requisition_lines", ["pr_id"], unique=False
        )
        op.create_index(
            op.f("ix_purchase_requisition_lines_tenant_id"), "purchase_requisition_lines", ["tenant_id"], unique=False
        )

    if not insp.has_table("sales_requisitions"):
        op.create_table(
            "sales_requisitions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("doc_number", sa.String(length=64), nullable=False),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("requested_delivery", sa.DateTime(), nullable=True),
            sa.Column("purpose", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("converted_invoice_id", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["converted_invoice_id"], ["sales_invoices.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "doc_number", name="uq_sr_tenant_doc"),
        )
        op.create_index(
            op.f("ix_sales_requisitions_customer_id"), "sales_requisitions", ["customer_id"], unique=False
        )
        op.create_index(op.f("ix_sales_requisitions_doc_number"), "sales_requisitions", ["doc_number"], unique=False)
        op.create_index(op.f("ix_sales_requisitions_status"), "sales_requisitions", ["status"], unique=False)
        op.create_index(op.f("ix_sales_requisitions_tenant_id"), "sales_requisitions", ["tenant_id"], unique=False)

    if not insp.has_table("sales_requisition_lines"):
        op.create_table(
            "sales_requisition_lines",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("sr_id", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column("qty", sa.Numeric(15, 3), nullable=False),
            sa.Column("unit_price", sa.Numeric(15, 2), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
            sa.ForeignKeyConstraint(["sr_id"], ["sales_requisitions.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_sales_requisition_lines_sr_id"), "sales_requisition_lines", ["sr_id"], unique=False)
        op.create_index(
            op.f("ix_sales_requisition_lines_tenant_id"), "sales_requisition_lines", ["tenant_id"], unique=False
        )

    if not insp.has_table("requisition_approval_logs"):
        op.create_table(
            "requisition_approval_logs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tenant_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("requisition_kind", sa.String(length=16), nullable=False),
            sa.Column("requisition_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=32), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("actor_user_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_requisition_approval_logs_requisition_id"),
            "requisition_approval_logs",
            ["requisition_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requisition_approval_logs_requisition_kind"),
            "requisition_approval_logs",
            ["requisition_kind"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requisition_approval_logs_tenant_id"), "requisition_approval_logs", ["tenant_id"], unique=False
        )

    insp = inspect(bind)  # refresh after DDL
    po_cols = {c["name"] for c in insp.get_columns("purchase_orders")} if insp.has_table("purchase_orders") else set()
    si_cols = {c["name"] for c in insp.get_columns("sales_invoices")} if insp.has_table("sales_invoices") else set()

    if bind.dialect.name == "sqlite":
        if "source_purchase_requisition_id" not in po_cols:
            with op.batch_alter_table("purchase_orders", schema=None) as batch_op:
                batch_op.add_column(sa.Column("source_purchase_requisition_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_po_source_pr",
                    "purchase_requisitions",
                    ["source_purchase_requisition_id"],
                    ["id"],
                )
                batch_op.create_index(
                    "ix_purchase_orders_source_purchase_requisition_id",
                    ["source_purchase_requisition_id"],
                    unique=False,
                )
        if "source_sales_requisition_id" not in si_cols:
            with op.batch_alter_table("sales_invoices", schema=None) as batch_op:
                batch_op.add_column(sa.Column("source_sales_requisition_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_si_source_sr",
                    "sales_requisitions",
                    ["source_sales_requisition_id"],
                    ["id"],
                )
                batch_op.create_index(
                    "ix_sales_invoices_source_sales_requisition_id",
                    ["source_sales_requisition_id"],
                    unique=False,
                )
    else:
        if "source_purchase_requisition_id" not in po_cols:
            op.add_column(
                "purchase_orders",
                sa.Column("source_purchase_requisition_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                "fk_po_source_pr",
                "purchase_orders",
                "purchase_requisitions",
                ["source_purchase_requisition_id"],
                ["id"],
            )
            op.create_index(
                op.f("ix_purchase_orders_source_purchase_requisition_id"),
                "purchase_orders",
                ["source_purchase_requisition_id"],
                unique=False,
            )
        if "source_sales_requisition_id" not in si_cols:
            op.add_column(
                "sales_invoices",
                sa.Column("source_sales_requisition_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                "fk_si_source_sr",
                "sales_invoices",
                "sales_requisitions",
                ["source_sales_requisition_id"],
                ["id"],
            )
            op.create_index(
                op.f("ix_sales_invoices_source_sales_requisition_id"),
                "sales_invoices",
                ["source_sales_requisition_id"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    po_cols = {c["name"] for c in insp.get_columns("purchase_orders")} if insp.has_table("purchase_orders") else set()
    si_cols = {c["name"] for c in insp.get_columns("sales_invoices")} if insp.has_table("sales_invoices") else set()

    if bind.dialect.name == "sqlite":
        if "source_purchase_requisition_id" in po_cols:
            with op.batch_alter_table("purchase_orders", schema=None) as batch_op:
                batch_op.drop_constraint("fk_po_source_pr", type_="foreignkey")
                batch_op.drop_index("ix_purchase_orders_source_purchase_requisition_id")
                batch_op.drop_column("source_purchase_requisition_id")
        if "source_sales_requisition_id" in si_cols:
            with op.batch_alter_table("sales_invoices", schema=None) as batch_op:
                batch_op.drop_constraint("fk_si_source_sr", type_="foreignkey")
                batch_op.drop_index("ix_sales_invoices_source_sales_requisition_id")
                batch_op.drop_column("source_sales_requisition_id")
    else:
        if "source_sales_requisition_id" in si_cols:
            op.drop_index(op.f("ix_sales_invoices_source_sales_requisition_id"), table_name="sales_invoices")
            op.drop_constraint("fk_si_source_sr", "sales_invoices", type_="foreignkey")
            op.drop_column("sales_invoices", "source_sales_requisition_id")
        if "source_purchase_requisition_id" in po_cols:
            op.drop_index(op.f("ix_purchase_orders_source_purchase_requisition_id"), table_name="purchase_orders")
            op.drop_constraint("fk_po_source_pr", "purchase_orders", type_="foreignkey")
            op.drop_column("purchase_orders", "source_purchase_requisition_id")

    op.drop_index(op.f("ix_requisition_approval_logs_tenant_id"), table_name="requisition_approval_logs")
    op.drop_index(op.f("ix_requisition_approval_logs_requisition_kind"), table_name="requisition_approval_logs")
    op.drop_index(op.f("ix_requisition_approval_logs_requisition_id"), table_name="requisition_approval_logs")
    op.drop_table("requisition_approval_logs")

    op.drop_index(op.f("ix_sales_requisition_lines_tenant_id"), table_name="sales_requisition_lines")
    op.drop_index(op.f("ix_sales_requisition_lines_sr_id"), table_name="sales_requisition_lines")
    op.drop_table("sales_requisition_lines")

    op.drop_index(op.f("ix_sales_requisitions_tenant_id"), table_name="sales_requisitions")
    op.drop_index(op.f("ix_sales_requisitions_status"), table_name="sales_requisitions")
    op.drop_index(op.f("ix_sales_requisitions_doc_number"), table_name="sales_requisitions")
    op.drop_index(op.f("ix_sales_requisitions_customer_id"), table_name="sales_requisitions")
    op.drop_table("sales_requisitions")

    op.drop_index(op.f("ix_purchase_requisition_lines_tenant_id"), table_name="purchase_requisition_lines")
    op.drop_index(op.f("ix_purchase_requisition_lines_pr_id"), table_name="purchase_requisition_lines")
    op.drop_table("purchase_requisition_lines")

    op.drop_index(op.f("ix_purchase_requisitions_tenant_id"), table_name="purchase_requisitions")
    op.drop_index(op.f("ix_purchase_requisitions_status"), table_name="purchase_requisitions")
    op.drop_index(op.f("ix_purchase_requisitions_doc_number"), table_name="purchase_requisitions")
    op.drop_table("purchase_requisitions")
