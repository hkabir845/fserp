"""Validate optional Chart of Account FKs used on catalog rows and document lines."""
from __future__ import annotations

from typing import Optional

from api.models import ChartOfAccount
from api.services.coa_constants import normalize_chart_account_type

# What a vendor-bill line may DEBIT.
#
# Standard double entry for a purchase is Dr <what you got> / Cr Accounts Payable. What you got
# is usually an expense or COGS, but it is just as often an asset you capitalize instead of
# expensing: inventory, a prepaid, a fixed asset, or -- in this ERP -- 1581 Biological Inventory
# when a nursing pond buys fry under the capitalize policy. Excluding assets here made the system
# reject its own auto-derived fry-stocking account.
#
# What a bill line must NEVER debit is the other side of the entry or a settlement account:
# cash, bank, A/R, or a contra-asset. Those are denied by sub-type below.
ALLOWED_BILL_EXPENSE_DEBIT = frozenset({"expense", "cost_of_goods_sold", "asset"})
ALLOWED_COGS = frozenset({"cost_of_goods_sold"})
ALLOWED_INVENTORY_ASSET = frozenset({"asset", "bank_account"})
ALLOWED_INCOME = frozenset({"income"})
ALLOWED_SALARY_EXPENSE = frozenset({"expense"})

# Asset sub-types that can never be the debit side of a vendor bill: paying a supplier does not
# increase cash, the bank, or what customers owe you, and a contra-asset is not a purchase.
NON_PURCHASABLE_ASSET_SUB_TYPES = frozenset(
    {
        "cash_on_hand",
        "cash_and_cash_equivalents",
        "checking",
        "savings",
        "money_market",
        "bank_account",
        "accounts_receivable",
        "undeposited_funds",
        "accumulated_depreciation",
        "allowance_for_bad_debts",
    }
)


def parse_optional_chart_account_id(
    company_id: int,
    raw,
    *,
    allowed_normalized_types: frozenset[str],
    field_label: str = "chart_account_id",
    denied_sub_types: frozenset[str] = frozenset(),
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
    if denied_sub_types:
        st = (acc.account_sub_type or "").strip().lower()
        if st in denied_sub_types:
            return None, (
                f"{field_label}: account {acc.account_code} is a cash, bank, receivable or "
                "contra-asset account and cannot be used here"
            )
    return aid, None
