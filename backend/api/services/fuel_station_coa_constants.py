"""Fuel-station reporting rollup → chart account codes (vendor bills, map-target hints, GL posting)."""

from __future__ import annotations

from api.services.tenant_reporting_categories import (
    APP_FUEL_STATION,
    FUEL_STATION_EXPENSE_MAP_CODES,
    FUEL_STATION_INCOME_MAP_CODES,
    tenant_expense_row_for_stored_code,
    tenant_income_row_for_stored_code,
)

# Primary GL debit/credit codes aligned with api.chart_templates.fuel_station (6100–7400 band).
FUEL_STATION_EXPENSE_ROLLUP_COA_CODES: dict[str, str] = {
    "operating": "6920",
    "cost_of_sales": "5200",
    "maintenance": "6300",
    "utilities": "6100",
    "other": "6990",
}

FUEL_STATION_INCOME_ROLLUP_COA_CODES: dict[str, str] = {
    "fuel_revenue": "4100",
    "shop_revenue": "4200",
    "services_revenue": "4220",
    "other": "4230",
}

# When rollup is unknown or the mapped account is missing from the company COA.
FUEL_STATION_EXPENSE_COA_FALLBACK = "6920"


def resolve_fuel_station_expense_to_rollup(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in FUEL_STATION_EXPENSE_MAP_CODES:
        return s
    row = tenant_expense_row_for_stored_code(company_id, APP_FUEL_STATION, s)
    if row:
        mapped = (row.maps_to_code or "").strip()
        if mapped in FUEL_STATION_EXPENSE_MAP_CODES:
            return mapped
    return s


def resolve_fuel_station_income_to_rollup(company_id: int, stored_code: str) -> str:
    s = (stored_code or "").strip()
    if s in FUEL_STATION_INCOME_MAP_CODES:
        return s
    row = tenant_income_row_for_stored_code(company_id, APP_FUEL_STATION, s)
    if row:
        mapped = (row.maps_to_code or "").strip()
        if mapped in FUEL_STATION_INCOME_MAP_CODES:
            return mapped
    return s


def coa_account_code_for_fuel_station_expense_rollup(
    rollup_or_stored_code: str, *, company_id: int | None = None
) -> str:
    code = (rollup_or_stored_code or "").strip()
    if company_id is not None:
        code = resolve_fuel_station_expense_to_rollup(company_id, code)
    return FUEL_STATION_EXPENSE_ROLLUP_COA_CODES.get(code, FUEL_STATION_EXPENSE_COA_FALLBACK)


def coa_account_code_for_fuel_station_income_rollup(
    rollup_or_stored_code: str, *, company_id: int | None = None
) -> str:
    code = (rollup_or_stored_code or "").strip()
    if company_id is not None:
        code = resolve_fuel_station_income_to_rollup(company_id, code)
    return FUEL_STATION_INCOME_ROLLUP_COA_CODES.get(code, "4230")


def chart_account_id_for_fuel_station_expense_rollup(
    company_id: int, rollup_or_stored_code: str
) -> int | None:
    from api.models import ChartOfAccount

    coa_code = coa_account_code_for_fuel_station_expense_rollup(
        rollup_or_stored_code, company_id=company_id
    )
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=coa_code, is_active=True
    ).first()
    if acc:
        return int(acc.id)
    fallback_code = FUEL_STATION_EXPENSE_COA_FALLBACK
    if coa_code != fallback_code:
        acc = ChartOfAccount.objects.filter(
            company_id=company_id, account_code=fallback_code, is_active=True
        ).first()
        if acc:
            return int(acc.id)
    return None
