"""Chart of account type vocabulary (aligned with frontend ACCOUNT_TYPES)."""
from __future__ import annotations

# Primary types used by FSERP UI, reports, and fuel_station_v1 template.
CHART_ACCOUNT_TYPES: frozenset[str] = frozenset(
    {
        "asset",
        "bank_account",
        "liability",
        "equity",
        "income",
        "expense",
        "cost_of_goods_sold",
        # Balance-sheet loans: use account_sub_type loan_receivable (debit-normal) or loan_payable (credit-normal).
        "loan",
    }
)

# Map legacy / alternate labels to canonical types.
CHART_ACCOUNT_TYPE_ALIASES: dict[str, str] = {
    "revenue": "income",
    "cogs": "cost_of_goods_sold",
    "cost of goods sold": "cost_of_goods_sold",
    "cost_of_sales": "cost_of_goods_sold",
    # Detail labels sometimes stored in account_type (imports / admin) — must map for P&L / BS.
    "sales_of_product_income": "income",
    "service_fee_income": "income",
    "other_income": "income",
    "discounts_refunds_given": "income",
    "supplies_materials_cogs": "cost_of_goods_sold",
    "utilities": "expense",
    "payroll_expenses": "expense",
    "repair_maintenance": "expense",
    "insurance": "expense",
    "rent_or_lease_of_buildings": "expense",
    "office_general_administrative_expenses": "expense",
    "other_business_expenses": "expense",
    "advertising_promotional": "expense",
    "supplies_materials": "expense",
}


def normalize_chart_account_type(raw: str | None, default: str = "asset") -> str:
    t = (raw or default).strip().lower()[:32]
    return CHART_ACCOUNT_TYPE_ALIASES.get(t, t)


def is_debit_normal_chart_type(
    account_type: str | None, account_sub_type: str | None = None
) -> bool:
    """Normal balance debit: assets, bank registers, expenses, COGS; loan receivable."""
    t = normalize_chart_account_type(account_type)
    st = (account_sub_type or "").strip().lower()
    if t == "asset" and st in ("accumulated_depreciation", "allowance_for_bad_debts"):
        return False
    if t == "loan":
        if st == "loan_payable":
            return False
        return True  # loan_receivable or unset → treat as receivable (debit-normal)
    return t in ("asset", "bank_account", "expense", "cost_of_goods_sold")


def is_pl_credit_normal_type(account_type: str | None) -> bool:
    """P&L lines that increase with credits (revenue side)."""
    return normalize_chart_account_type(account_type) == "income"


def pl_bucket_for_coa(
    account_type: str | None,
    account_sub_type: str | None = None,
    account_code: str | None = None,
) -> str | None:
    """
    P&L section for a chart row: income, cost_of_goods_sold, or expense.
    Mis-typed fuel COGS (51xx/52xx or cogs sub-type stored as expense) map to COGS.
    """
    t = normalize_chart_account_type(account_type)
    st = (account_sub_type or "").strip().lower()
    code = (account_code or "").strip()
    if t == "income":
        return "income"
    if t == "cost_of_goods_sold":
        return "cost_of_goods_sold"
    if t == "expense":
        if st and (
            "cogs" in st
            or st in ("cost_of_goods_sold", "supplies_materials_cogs")
        ):
            return "cost_of_goods_sold"
        if code and len(code) >= 4 and code[:2] in ("51", "52") and code[:4].isdigit():
            return "cost_of_goods_sold"
        return "expense"
    return None


# Sub-types that make an `asset` row a cash or bank register. The fuel-station chart types every
# one of these as plain "asset" (1010 cash_on_hand, 1030/1040/1050 checking, 1020 other_current_
# asset), so anything that keyed off account_type == "bank_account" alone matched nothing at all.
CASH_AND_BANK_SUB_TYPES: frozenset[str] = frozenset(
    {
        "bank_account",
        "cash_on_hand",
        "cash_and_cash_equivalents",
        "checking",
        "savings",
        "money_market",
        "undeposited_funds",
    }
)

# 1020 "Cash Clearing - Undeposited" is a real cash position but is templated as a generic
# other_current_asset, so it is recognised by code as well as by sub-type.
CASH_AND_BANK_ACCOUNT_CODES: frozenset[str] = frozenset({"1010", "1020", "1030", "1040", "1050"})


def is_cash_or_bank_account(
    account_type: str | None,
    account_sub_type: str | None = None,
    account_code: str | None = None,
) -> bool:
    """True for the cash and bank registers that make up 'cash' on a cash-flow statement."""
    t = normalize_chart_account_type(account_type)
    if t == "bank_account":
        return True
    if t != "asset":
        return False
    st = (account_sub_type or "").strip().lower()
    if st in CASH_AND_BANK_SUB_TYPES:
        return True
    return (account_code or "").strip() in CASH_AND_BANK_ACCOUNT_CODES
