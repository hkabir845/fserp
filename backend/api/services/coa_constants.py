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
    if t == "loan":
        st = (account_sub_type or "").strip().lower()
        if st == "loan_payable":
            return False
        return True  # loan_receivable or unset → treat as receivable (debit-normal)
    return t in ("asset", "bank_account", "expense", "cost_of_goods_sold")


def is_pl_credit_normal_type(account_type: str | None) -> bool:
    """P&L lines that increase with credits (revenue side)."""
    return normalize_chart_account_type(account_type) == "income"
