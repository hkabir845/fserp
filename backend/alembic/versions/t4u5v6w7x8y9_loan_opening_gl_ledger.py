"""loan opening balance and GL sub-ledger link

Revision ID: t4u5v6w7x8y9
Revises: s2t3u4v5w6x7
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "t4u5v6w7x8y9"
down_revision = "s2t3u4v5w6x7"
branch_labels = None
depends_on = None


def _add_column_if_missing(table_name: str, column_name: str, column) -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table(table_name):
        return
    existing = {c["name"] for c in insp.get_columns(table_name)}
    if column_name in existing:
        return
    op.add_column(table_name, column)


def upgrade() -> None:
    _add_column_if_missing(
        "loans",
        "opening_balance",
        sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    _add_column_if_missing(
        "loans",
        "opening_balance_as_of",
        sa.Column("opening_balance_as_of", sa.DateTime(), nullable=True),
    )
    _add_column_if_missing(
        "loans",
        "gl_account_id",
        sa.Column("gl_account_id", sa.Integer(), nullable=True),
    )

    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("loans"):
        return

    indexes = {i["name"] for i in insp.get_indexes("loans")}
    if "ix_loans_gl_account_id" not in indexes:
        try:
            op.create_index("ix_loans_gl_account_id", "loans", ["gl_account_id"])
        except Exception:
            pass

    if bind.dialect.name != "sqlite":
        fks = {fk["name"] for fk in insp.get_foreign_keys("loans")}
        fk_name = "fk_loans_gl_account_id_accounts"
        if fk_name not in fks:
            op.create_foreign_key(fk_name, "loans", "accounts", ["gl_account_id"], ["id"])


def downgrade() -> None:
    try:
        op.drop_index("ix_loans_gl_account_id", table_name="loans")
    except Exception:
        pass
    try:
        op.drop_constraint("fk_loans_gl_account_id_accounts", "loans", type_="foreignkey")
    except Exception:
        pass
    for col in ("gl_account_id", "opening_balance_as_of", "opening_balance"):
        try:
            op.drop_column("loans", col)
        except Exception:
            pass
