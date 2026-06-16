"""lab quality module — parameters, specifications, samples, results

Revision ID: i4j5k6l7m8n9
Revises: h3i4j5k6l7m8
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa


revision = "i4j5k6l7m8n9"
down_revision = "h3i4j5k6l7m8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lab_parameters",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("unit", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("method_family", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "code", name="uq_lab_parameters_tenant_code"),
    )
    op.create_index(op.f("ix_lab_parameters_code"), "lab_parameters", ["code"], unique=False)
    op.create_index(op.f("ix_lab_parameters_id"), "lab_parameters", ["id"], unique=False)
    op.create_index(op.f("ix_lab_parameters_tenant_id"), "lab_parameters", ["tenant_id"], unique=False)

    op.create_table(
        "lab_specifications",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("ingredient_item_id", sa.Integer(), nullable=True),
        sa.Column("feed_product_id", sa.Integer(), nullable=True),
        sa.Column("bom_id", sa.Integer(), nullable=True),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("effective_to", sa.DateTime(), nullable=True),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["bom_id"], ["feed_boms.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["feed_product_id"], ["feed_products.id"]),
        sa.ForeignKeyConstraint(["ingredient_item_id"], ["items.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_lab_specifications_bom_id"), "lab_specifications", ["bom_id"], unique=False)
    op.create_index(op.f("ix_lab_specifications_feed_product_id"), "lab_specifications", ["feed_product_id"], unique=False)
    op.create_index(op.f("ix_lab_specifications_id"), "lab_specifications", ["id"], unique=False)
    op.create_index(
        op.f("ix_lab_specifications_ingredient_item_id"), "lab_specifications", ["ingredient_item_id"], unique=False
    )
    op.create_index(op.f("ix_lab_specifications_supplier_id"), "lab_specifications", ["supplier_id"], unique=False)
    op.create_index(op.f("ix_lab_specifications_tenant_id"), "lab_specifications", ["tenant_id"], unique=False)

    op.create_table(
        "lab_specification_lines",
        sa.Column("specification_id", sa.Integer(), nullable=False),
        sa.Column("parameter_id", sa.Integer(), nullable=False),
        sa.Column("lower_limit", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("upper_limit", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("target_value", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("unit_override", sa.String(), nullable=True),
        sa.Column("is_critical", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["parameter_id"], ["lab_parameters.id"]),
        sa.ForeignKeyConstraint(["specification_id"], ["lab_specifications.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_lab_specification_lines_id"), "lab_specification_lines", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_lab_specification_lines_parameter_id"),
        "lab_specification_lines",
        ["parameter_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_lab_specification_lines_specification_id"),
        "lab_specification_lines",
        ["specification_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_lab_specification_lines_tenant_id"), "lab_specification_lines", ["tenant_id"], unique=False
    )

    op.create_table(
        "lab_samples",
        sa.Column("sample_number", sa.String(), nullable=False),
        sa.Column("sample_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column("ingredient_id", sa.Integer(), nullable=True),
        sa.Column("feed_product_id", sa.Integer(), nullable=True),
        sa.Column("production_order_id", sa.Integer(), nullable=True),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("lab_specification_id", sa.Integer(), nullable=True),
        sa.Column("lot_reference", sa.String(), nullable=True),
        sa.Column("sampling_point", sa.String(), nullable=True),
        sa.Column("sampled_at", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("priority", sa.String(), nullable=False),
        sa.Column("chain_of_custody_notes", sa.Text(), nullable=True),
        sa.Column("overall_compliant", sa.Boolean(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["feed_product_id"], ["feed_products.id"]),
        sa.ForeignKeyConstraint(["ingredient_id"], ["ingredients.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.ForeignKeyConstraint(["lab_specification_id"], ["lab_specifications.id"]),
        sa.ForeignKeyConstraint(["production_order_id"], ["production_orders.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "sample_number", name="uq_lab_samples_tenant_number"),
    )
    op.create_index(op.f("ix_lab_samples_feed_product_id"), "lab_samples", ["feed_product_id"], unique=False)
    op.create_index(op.f("ix_lab_samples_id"), "lab_samples", ["id"], unique=False)
    op.create_index(op.f("ix_lab_samples_ingredient_id"), "lab_samples", ["ingredient_id"], unique=False)
    op.create_index(op.f("ix_lab_samples_item_id"), "lab_samples", ["item_id"], unique=False)
    op.create_index(op.f("ix_lab_samples_lab_specification_id"), "lab_samples", ["lab_specification_id"], unique=False)
    op.create_index(
        op.f("ix_lab_samples_production_order_id"), "lab_samples", ["production_order_id"], unique=False
    )
    op.create_index(op.f("ix_lab_samples_sample_number"), "lab_samples", ["sample_number"], unique=False)
    op.create_index(op.f("ix_lab_samples_supplier_id"), "lab_samples", ["supplier_id"], unique=False)
    op.create_index(op.f("ix_lab_samples_tenant_id"), "lab_samples", ["tenant_id"], unique=False)

    op.create_table(
        "lab_results",
        sa.Column("sample_id", sa.Integer(), nullable=False),
        sa.Column("parameter_id", sa.Integer(), nullable=False),
        sa.Column("result_numeric", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("result_text", sa.String(), nullable=True),
        sa.Column("lower_applied", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("upper_applied", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("target_applied", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("compliant", sa.Boolean(), nullable=True),
        sa.Column("is_critical", sa.Boolean(), nullable=False),
        sa.Column("method_reference", sa.String(), nullable=True),
        sa.Column("equipment_id", sa.String(), nullable=True),
        sa.Column("tested_at", sa.DateTime(), nullable=True),
        sa.Column("tested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("deviation_notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["parameter_id"], ["lab_parameters.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["sample_id"], ["lab_samples.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["tested_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sample_id", "parameter_id", name="uq_lab_results_sample_parameter"),
    )
    op.create_index(op.f("ix_lab_results_id"), "lab_results", ["id"], unique=False)
    op.create_index(op.f("ix_lab_results_parameter_id"), "lab_results", ["parameter_id"], unique=False)
    op.create_index(op.f("ix_lab_results_sample_id"), "lab_results", ["sample_id"], unique=False)
    op.create_index(op.f("ix_lab_results_tenant_id"), "lab_results", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_table("lab_results")
    op.drop_table("lab_samples")
    op.drop_table("lab_specification_lines")
    op.drop_table("lab_specifications")
    op.drop_table("lab_parameters")
