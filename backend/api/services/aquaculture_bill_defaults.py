"""
Defaults for vendor bill lines tagged to aquaculture ponds: expense category → COA + cost bucket.
"""
from __future__ import annotations

from api.models import ChartOfAccount
from api.services.aquaculture_constants import (
    EXPENSE_CATEGORY_CODES,
    coa_account_code_for_aquaculture_expense_category,
)
from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket
from api.services.tenant_reporting_categories import resolve_aquaculture_expense_to_builtin

# Categories recorded elsewhere (not on vendor bills).
BILL_AQUACULTURE_EXPENSE_EXCLUDED: frozenset[str] = frozenset(
    {
        "vendor_bill_pond",
        "lease",
        "worker_salary",
        "feed_consumed",
        "medicine_consumed",
    }
)

BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES: frozenset[str] = frozenset(
    c for c in EXPENSE_CATEGORY_CODES if c not in BILL_AQUACULTURE_EXPENSE_EXCLUDED
)

# Prefer one category when rehydrating UI from stored cost_bucket (first match wins).
_COST_BUCKET_TO_EXPENSE_CATEGORY: tuple[tuple[str, str], ...] = (
    ("fry_stocking", "fry_stocking"),
    ("pond_preparation", "pond_preparation"),
    ("feed", "feed_purchase"),
    ("medicine", "medicine_purchase"),
    ("labor", "worker_salary"),
    ("electricity", "electricity"),
    ("equipment", "equipment"),
    ("repair_maintenance", "repair_maintenance"),
    ("lease", "lease"),
    ("transportation", "transportation"),
    ("fisherman", "fisherman"),
    ("miscellaneous", "other"),
    ("ancillary", "other"),
)


def normalize_bill_expense_category(company_id: int, raw: str | None) -> tuple[str | None, str | None]:
    """Resolve tenant/custom codes; reject categories not allowed on bills."""
    if raw is None or str(raw).strip() == "":
        return None, None
    code = resolve_aquaculture_expense_to_builtin(company_id, str(raw).strip())
    if code not in EXPENSE_CATEGORY_CODES:
        return None, f"Unknown aquaculture_expense_category: {raw!r}"
    if code in BILL_AQUACULTURE_EXPENSE_EXCLUDED:
        return (
            None,
            f"Category {code!r} cannot be used on vendor bills (use the dedicated module for this cost type).",
        )
    return code, None


def expense_category_from_cost_bucket(bucket: str | None) -> str | None:
    b = (bucket or "").strip()
    if not b:
        return None
    for key, cat in _COST_BUCKET_TO_EXPENSE_CATEGORY:
        if b == key and cat in BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES:
            return cat
    return None


def chart_account_id_for_aquaculture_expense_category(company_id: int, category: str) -> int | None:
    code = coa_account_code_for_aquaculture_expense_category(category, company_id=company_id)
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code, is_active=True
    ).first()
    return int(acc.id) if acc else None


def validate_and_apply_shared_pond_bill_line_category(company_id: int, row: dict) -> str | None:
    """
    Shared pond split rows carry aquaculture_expense_category without aquaculture_pond_id.
    Normalize category, fill cost bucket, and default expense_account_id when applicable.
    """
    from api.services.aquaculture_bill_pond_share import bill_line_cost_mode

    mode = bill_line_cost_mode(row)
    if mode not in ("shared_equal", "shared_manual"):
        return None
    raw_cat = row.get("aquaculture_expense_category")
    if raw_cat in (None, ""):
        return "aquaculture_expense_category is required for shared pond split lines."
    code, err = normalize_bill_expense_category(company_id, raw_cat)
    if err:
        return err
    assert code is not None
    if not str(row.get("aquaculture_cost_bucket") or "").strip():
        row["aquaculture_cost_bucket"] = aquaculture_expense_category_to_cost_bucket(
            code, company_id=company_id
        )
    if not row.get("item_id") and not row.get("expense_account_id"):
        aid = chart_account_id_for_aquaculture_expense_category(company_id, code)
        if aid:
            row["expense_account_id"] = aid
    return None


def apply_aquaculture_expense_category_to_bill_line_row(company_id: int, row: dict) -> str | None:
    """
    When aquaculture_pond_id and aquaculture_expense_category are set, fill cost_bucket and
    expense_account_id (when no item line) from aquaculture COA mapping.
    Returns error message or None.
    """
    raw_p = row.get("aquaculture_pond_id")
    if raw_p in (None, ""):
        return None
    raw_cat = row.get("aquaculture_expense_category")
    if raw_cat in (None, ""):
        return None
    code, err = normalize_bill_expense_category(company_id, raw_cat)
    if err:
        return err
    assert code is not None
    if not str(row.get("aquaculture_cost_bucket") or "").strip():
        row["aquaculture_cost_bucket"] = aquaculture_expense_category_to_cost_bucket(
            code, company_id=company_id
        )
    if not row.get("item_id") and not row.get("expense_account_id"):
        aid = chart_account_id_for_aquaculture_expense_category(company_id, code)
        if aid:
            row["expense_account_id"] = aid
    return None
