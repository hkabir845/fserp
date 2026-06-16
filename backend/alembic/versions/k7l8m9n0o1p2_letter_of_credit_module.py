"""Letter of Credit module — import/export trade finance (Bangladesh-aware fields)

Revision ID: k7l8m9n0o1p2
Revises: j6k7l8m9n0o1
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa


revision = "k7l8m9n0o1p2"
down_revision = "j6k7l8m9n0o1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "letter_of_credits",
        sa.Column("lc_internal_number", sa.String(length=64), nullable=False),
        sa.Column("bank_lc_reference", sa.String(length=128), nullable=True),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("deal_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("applicant_name", sa.String(length=512), nullable=False),
        sa.Column("applicant_address", sa.Text(), nullable=True),
        sa.Column("beneficiary_name", sa.String(length=512), nullable=False),
        sa.Column("beneficiary_address", sa.Text(), nullable=True),
        sa.Column("beneficiary_country", sa.String(length=128), nullable=True),
        sa.Column("issuing_bank_name", sa.String(length=256), nullable=False),
        sa.Column("issuing_bank_branch", sa.String(length=256), nullable=True),
        sa.Column("issuing_bank_swift", sa.String(length=32), nullable=True),
        sa.Column("advising_bank_name", sa.String(length=256), nullable=True),
        sa.Column("advising_bank_swift", sa.String(length=32), nullable=True),
        sa.Column("confirming_bank_name", sa.String(length=256), nullable=True),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("tolerance_pct_plus", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("tolerance_pct_minus", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("incoterm", sa.String(length=32), nullable=True),
        sa.Column("partial_shipment_allowed", sa.Boolean(), nullable=False),
        sa.Column("transshipment_allowed", sa.Boolean(), nullable=False),
        sa.Column("latest_shipment_date", sa.DateTime(), nullable=True),
        sa.Column("expiry_date", sa.DateTime(), nullable=True),
        sa.Column("presentation_period_days", sa.Integer(), nullable=True),
        sa.Column("goods_description", sa.Text(), nullable=False),
        sa.Column("goods_category", sa.String(length=64), nullable=False),
        sa.Column("hs_codes", sa.String(length=512), nullable=True),
        sa.Column("bin_tin", sa.String(length=64), nullable=True),
        sa.Column("irc_number", sa.String(length=128), nullable=True),
        sa.Column("erc_number", sa.String(length=128), nullable=True),
        sa.Column("feed_reg_license_ref", sa.String(length=128), nullable=True),
        sa.Column("bangladesh_bank_reporting_ref", sa.String(length=128), nullable=True),
        sa.Column("bank_lodgment_reference", sa.String(length=128), nullable=True),
        sa.Column("insurers_cover_note", sa.String(length=256), nullable=True),
        sa.Column("margin_pct", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("charges_account_party", sa.String(length=64), nullable=True),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("customer_id", sa.Integer(), nullable=True),
        sa.Column("purchase_order_id", sa.Integer(), nullable=True),
        sa.Column("documents_required", sa.JSON(), nullable=True),
        sa.Column("compliance_notes", sa.Text(), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "lc_internal_number", name="uq_lc_tenant_internal_no"),
    )
    op.create_index(op.f("ix_letter_of_credits_lc_internal_number"), "letter_of_credits", ["lc_internal_number"], unique=False)
    op.create_index(op.f("ix_letter_of_credits_bank_lc_reference"), "letter_of_credits", ["bank_lc_reference"], unique=False)

    op.create_table(
        "lc_amendments",
        sa.Column("lc_id", sa.Integer(), nullable=False),
        sa.Column("amendment_no", sa.Integer(), nullable=False),
        sa.Column("effective_date", sa.DateTime(), nullable=False),
        sa.Column("summary", sa.String(length=512), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("amount_before", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("amount_after", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["lc_id"], ["letter_of_credits.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lc_id", "amendment_no", name="uq_lc_amendment_seq"),
    )
    op.create_index(op.f("ix_lc_amendments_lc_id"), "lc_amendments", ["lc_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_lc_amendments_lc_id"), table_name="lc_amendments")
    op.drop_table("lc_amendments")
    op.drop_index(op.f("ix_letter_of_credits_bank_lc_reference"), table_name="letter_of_credits")
    op.drop_index(op.f("ix_letter_of_credits_lc_internal_number"), table_name="letter_of_credits")
    op.drop_table("letter_of_credits")
