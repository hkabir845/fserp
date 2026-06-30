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
from api.services.tenant_reporting_categories import (
    APP_AQUACULTURE,
    resolve_aquaculture_expense_to_builtin,
    tenant_expense_row,
)

# Categories recorded elsewhere (not on vendor bills).
BILL_AQUACULTURE_EXPENSE_EXCLUDED: frozenset[str] = frozenset(
    {
        "vendor_bill_pond",
        "lease",
        "worker_salary",
        "feed_consumed",
        "medicine_consumed",
        "depreciation",
    }
)

BILL_AQUACULTURE_EXPENSE_CATEGORY_CODES: frozenset[str] = frozenset(
    c for c in EXPENSE_CATEGORY_CODES if c not in BILL_AQUACULTURE_EXPENSE_EXCLUDED
)

# Tenant custom labels: block payroll, lease, and automatic-only rollups on vendor bills.
TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS: frozenset[str] = frozenset(
    {
        "vendor_bill_pond",
        "lease",
        "worker_salary",
        "feed_consumed",
        "medicine_consumed",
        "depreciation",
    }
)

# Prefer one category when rehydrating UI from stored cost_bucket (first match wins).
_COST_BUCKET_TO_EXPENSE_CATEGORY: tuple[tuple[str, str], ...] = (
    ("fry_stocking", "fry_stocking"),
    ("pond_preparation", "pond_preparation"),
    ("feed", "feed_purchase"),
    ("medicine", "medicine_purchase"),
    ("labor", "worker_salary"),
    ("electricity", "electricity"),
    ("electricity", "generator_fuel"),
    ("miscellaneous", "water"),
    ("equipment", "equipment"),
    ("equipment", "depreciation"),
    ("repair_maintenance", "repair_maintenance"),
    ("lease", "lease"),
    ("transportation", "transportation"),
    ("transportation", "fish_haul_supplies"),
    ("shop_supplies", "shop_supplies"),
    ("shop_supplies", "office_supplies"),
    ("shop_supplies", "netting_gear"),
    ("miscellaneous", "meals_entertainment"),
    ("medicine", "pond_care_products"),
    ("medicine", "sampling_lab"),
    ("miscellaneous", "security"),
    ("miscellaneous", "predator_control"),
    ("miscellaneous", "insurance"),
    ("miscellaneous", "bank_charges"),
    ("miscellaneous", "licenses_permits"),
    ("miscellaneous", "professional_fees"),
    ("miscellaneous", "communication"),
    ("fisherman", "fisherman"),
    ("day_labor", "day_labor"),
    ("biological_writeoff", "mortality"),
    ("miscellaneous", "other"),
    ("ancillary", "other"),
)


def normalize_bill_expense_category(company_id: int, raw: str | None) -> tuple[str | None, str | None]:
    """Resolve tenant/custom codes; reject categories not allowed on bills."""
    if raw is None or str(raw).strip() == "":
        return None, None
    raw_s = str(raw).strip()
    tr = tenant_expense_row(company_id, APP_AQUACULTURE, raw_s)
    code = resolve_aquaculture_expense_to_builtin(company_id, raw_s)
    if code not in EXPENSE_CATEGORY_CODES:
        return None, f"Unknown aquaculture_expense_category: {raw!r}"
    if tr:
        if code in TENANT_BILL_AQUACULTURE_EXPENSE_BLOCKED_MAPS:
            return (
                None,
                f"Category {code!r} cannot be used on vendor bills (use the dedicated module for this cost type).",
            )
        return code, None
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


def chart_account_id_for_aquaculture_bill_expense(company_id: int, category: str) -> int | None:
    """Bill-line expense account: fry stocking uses biological inventory (1581) when seeded."""
    from api.services.aquaculture_pond_bio_capitalization import bio_inventory_account

    from api.services.tenant_reporting_categories import resolve_aquaculture_expense_to_builtin

    builtin = resolve_aquaculture_expense_to_builtin(company_id, category)
    if builtin == "fry_stocking":
        bio = bio_inventory_account(company_id)
        if bio:
            return int(bio.id)
    return chart_account_id_for_aquaculture_expense_category(company_id, category)


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
        aid = chart_account_id_for_aquaculture_bill_expense(company_id, code)
        if aid:
            row["expense_account_id"] = aid
    return None


def apply_aquaculture_expense_category_to_bill_line_row(company_id: int, row: dict) -> str | None:
    """
    When aquaculture_pond_id or a shop-hub receipt station and aquaculture_expense_category are set,
    fill cost_bucket and expense_account_id (when no item line) from aquaculture COA mapping.
    Returns error message or None.
    """
    from api.services.aquaculture_bill_pond_share import bill_line_cost_mode
    from api.services.station_business_kind import line_receipt_station_id_from_row, station_is_shop_hub

    raw_p = row.get("aquaculture_pond_id")
    raw_cat = row.get("aquaculture_expense_category")
    if raw_cat in (None, ""):
        return None
    if raw_p in (None, ""):
        sid = line_receipt_station_id_from_row(row)
        mode = bill_line_cost_mode(row)
        if sid and station_is_shop_hub(company_id, sid):
            pass
        elif mode in ("shared_equal", "shared_manual"):
            pass
        else:
            return None
    raw_s = str(raw_cat).strip()
    tr = tenant_expense_row(company_id, APP_AQUACULTURE, raw_s)
    if tr:
        row["tenant_reporting_category_id"] = int(tr.id)
    code, err = normalize_bill_expense_category(company_id, raw_cat)
    if err:
        return err
    assert code is not None
    if not str(row.get("aquaculture_cost_bucket") or "").strip():
        row["aquaculture_cost_bucket"] = aquaculture_expense_category_to_cost_bucket(
            code, company_id=company_id
        )
    if not row.get("item_id") and not row.get("expense_account_id"):
        aid = chart_account_id_for_aquaculture_bill_expense(company_id, code)
        if aid:
            row["expense_account_id"] = aid
    return None
