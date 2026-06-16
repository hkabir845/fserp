"""customers/suppliers/employees: bank details, opening balance, GL sub-account link

Revision ID: q7r8s9t0u1v2
Revises: o1p2q3r4s5t6
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "q7r8s9t0u1v2"
down_revision = "o1p2q3r4s5t6"
branch_labels = None
depends_on = None


def _add_column(table: str, name: str, col):
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table(table):
        return
    cols = [c["name"] for c in insp.get_columns(table)]
    if name in cols:
        return
    op.add_column(table, col)


def upgrade() -> None:
    num = sa.Numeric(15, 2)
    for tbl in ("customers", "suppliers", "employees"):
        _add_column(tbl, "bank_name", sa.Column("bank_name", sa.String(), nullable=True))
        _add_column(tbl, "bank_account_no", sa.Column("bank_account_no", sa.String(), nullable=True))
        _add_column(tbl, "bank_branch", sa.Column("bank_branch", sa.String(), nullable=True))
        _add_column(tbl, "bank_routing_or_ifsc", sa.Column("bank_routing_or_ifsc", sa.String(), nullable=True))
        _add_column(
            tbl,
            "opening_balance",
            sa.Column("opening_balance", num, nullable=False, server_default="0"),
        )
        _add_column(tbl, "opening_balance_as_of", sa.Column("opening_balance_as_of", sa.DateTime(), nullable=True))
        _add_column(
            tbl,
            "gl_account_id",
            sa.Column("gl_account_id", sa.Integer(), nullable=True),
        )

    bind = op.get_bind()
    insp = inspect(bind)
    # SQLite cannot ALTER ADD foreign key post-hoc; ORM still enforces referential intent.
    is_sqlite = bind.dialect.name == "sqlite"
    for tbl in ("customers", "suppliers", "employees"):
        if not insp.has_table(tbl):
            continue
        cols = [c["name"] for c in insp.get_columns(tbl)]
        if "gl_account_id" not in cols:
            continue
        if not is_sqlite:
            fk_name = f"fk_{tbl}_gl_account_id_accounts"
            fks = [fk["name"] for fk in insp.get_foreign_keys(tbl)]
            if fk_name not in fks:
                op.create_foreign_key(fk_name, tbl, "accounts", ["gl_account_id"], ["id"])
        idx = f"ix_{tbl}_gl_account_id"
        indexes = [i["name"] for i in insp.get_indexes(tbl)]
        if idx not in indexes:
            try:
                op.create_index(idx, tbl, ["gl_account_id"])
            except Exception:
                pass


def downgrade() -> None:
    for tbl in ("customers", "suppliers", "employees"):
        try:
            op.drop_index(f"ix_{tbl}_gl_account_id", table_name=tbl)
        except Exception:
            pass
        try:
            op.drop_constraint(f"fk_{tbl}_gl_account_id_accounts", tbl, type_="foreignkey")
        except Exception:
            pass
        for col in (
            "gl_account_id",
            "opening_balance_as_of",
            "opening_balance",
            "bank_routing_or_ifsc",
            "bank_branch",
            "bank_account_no",
            "bank_name",
        ):
            try:
                op.drop_column(tbl, col)
            except Exception:
                pass
