"""Validate optional Chart of Account FKs used on catalog rows and document lines."""
from __future__ import annotations

from typing import Optional

from api.models import ChartOfAccount
from api.services.coa_constants import is_pl_credit_normal_type, normalize_chart_account_type

ALLOWED_BILL_EXPENSE_DEBIT = frozenset({"expense", "cost_of_goods_sold"})
ALLOWED_COGS = frozenset({"cost_of_goods_sold"})
ALLOWED_INVENTORY_ASSET = frozenset({"asset", "bank_account"})
ALLOWED_INCOME = frozenset({"income"})
ALLOWED_SALARY_EXPENSE = frozenset({"expense"})


def parse_optional_chart_account_id(
    company_id: int,
    raw,
    *,
    allowed_normalized_types: frozenset[str],
    field_label: str = "chart_account_id",
) -> tuple[Optional[int], Optional[str]]:
    """
    Returns (pk or None, error_detail).

    None / blank string clears the FK (caller sets field to None).
    """
    if raw is None or raw == "":
        return None, None
    try:
        aid = int(raw)
    except (TypeError, ValueError):
        return None, f"{field_label} must be an integer"
    if aid <= 0:
        return None, None
    acc = ChartOfAccount.objects.filter(pk=aid, company_id=company_id, is_active=True).first()
    if not acc:
        return None, f"{field_label}: unknown or inactive chart account"
    nt = normalize_chart_account_type(acc.account_type)
    if nt not in allowed_normalized_types:
        return None, f"{field_label}: account {acc.account_code} type is not allowed for this field"
    return aid, None
