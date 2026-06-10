"""Fuel-station reporting categories on vendor bill lines."""
from __future__ import annotations

from api.services.fuel_station_coa_constants import chart_account_id_for_fuel_station_expense_rollup
from api.services.tenant_reporting_categories import (
    APP_FUEL_STATION,
    FUEL_STATION_EXPENSE_MAP_CODES,
    tenant_expense_row,
)


def normalize_fuel_station_expense_category(
    company_id: int, raw: str | None
) -> tuple[str | None, str | None]:
    if raw is None or str(raw).strip() == "":
        return None, None
    code = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    if code in FUEL_STATION_EXPENSE_MAP_CODES:
        return code, None
    if tenant_expense_row(company_id, APP_FUEL_STATION, code):
        return code, None
    return None, f"Unknown fuel_station_expense_category: {raw!r}"


def apply_fuel_station_category_to_bill_line_row(company_id: int, row: dict) -> str | None:
    """
    Optional fuel_station_expense_category on non-pond bill lines.
    Sets tenant_reporting_category_id when the code is a tenant-defined row,
    and default expense_account_id from rollup → COA mapping when no item line.
    """
    raw_p = row.get("aquaculture_pond_id")
    if raw_p not in (None, ""):
        if row.get("fuel_station_expense_category") not in (None, ""):
            return "fuel_station_expense_category cannot be set when aquaculture_pond_id is set"
        row["fuel_station_expense_category"] = ""
        row["tenant_reporting_category_id"] = None
        return None

    raw_cat = row.get("fuel_station_expense_category")
    if raw_cat in (None, ""):
        row["fuel_station_expense_category"] = ""
        row["tenant_reporting_category_id"] = None
        return None

    code, err = normalize_fuel_station_expense_category(company_id, raw_cat)
    if err:
        return err
    assert code is not None
    row["fuel_station_expense_category"] = code
    tr = tenant_expense_row(company_id, APP_FUEL_STATION, code)
    row["tenant_reporting_category_id"] = int(tr.id) if tr else None
    if not row.get("item_id") and not row.get("expense_account_id"):
        aid = chart_account_id_for_fuel_station_expense_rollup(company_id, code)
        if aid:
            row["expense_account_id"] = aid
    return None
