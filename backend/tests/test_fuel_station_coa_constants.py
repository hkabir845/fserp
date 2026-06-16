"""Fuel-station rollup → COA mapping."""
from __future__ import annotations

import pytest

from api.models import ChartOfAccount
from api.services.fuel_station_coa_constants import (
    coa_account_code_for_fuel_station_expense_rollup,
    coa_account_code_for_fuel_station_income_rollup,
    chart_account_id_for_fuel_station_expense_rollup,
)


@pytest.mark.django_db
def test_fuel_station_expense_rollup_coa_codes(company_tenant):
    assert coa_account_code_for_fuel_station_expense_rollup("operating") == "6920"
    assert coa_account_code_for_fuel_station_expense_rollup("payroll") == "6400"
    assert coa_account_code_for_fuel_station_expense_rollup("rent") == "6200"
    assert coa_account_code_for_fuel_station_expense_rollup("security") == "7000"
    assert coa_account_code_for_fuel_station_expense_rollup("utilities") == "6100"
    assert coa_account_code_for_fuel_station_expense_rollup("water_sewer") == "6110"
    assert coa_account_code_for_fuel_station_expense_rollup("maintenance") == "6300"
    assert coa_account_code_for_fuel_station_expense_rollup("building_maintenance") == "6310"
    assert coa_account_code_for_fuel_station_expense_rollup("cost_of_sales") == "5200"
    assert coa_account_code_for_fuel_station_expense_rollup("shop_shrink") == "5210"
    assert coa_account_code_for_fuel_station_expense_rollup("shop_cogs") == "5120"
    assert coa_account_code_for_fuel_station_expense_rollup("licenses_permits") == "7200"
    assert coa_account_code_for_fuel_station_expense_rollup("other") == "6990"


@pytest.mark.django_db
def test_fuel_station_income_rollup_coa_codes(company_tenant):
    assert coa_account_code_for_fuel_station_income_rollup("fuel_revenue") == "4100"
    assert coa_account_code_for_fuel_station_income_rollup("diesel_revenue") == "4110"
    assert coa_account_code_for_fuel_station_income_rollup("premium_fuel_revenue") == "4120"
    assert coa_account_code_for_fuel_station_income_rollup("fleet_revenue") == "4140"
    assert coa_account_code_for_fuel_station_income_rollup("shop_revenue") == "4200"
    assert coa_account_code_for_fuel_station_income_rollup("services_revenue") == "4220"
    assert coa_account_code_for_fuel_station_income_rollup("other") == "4230"


@pytest.mark.django_db
def test_aquaculture_expense_rollup_coa_codes(company_tenant):
    from api.services.aquaculture_constants import coa_account_code_for_aquaculture_expense_category

    assert coa_account_code_for_aquaculture_expense_category("repair_maintenance") == "6722"
    assert coa_account_code_for_aquaculture_expense_category("equipment") == "6718"
    assert coa_account_code_for_aquaculture_expense_category("mortality") == "6726"
    assert coa_account_code_for_aquaculture_expense_category("shop_supplies") == "6725"
    assert coa_account_code_for_aquaculture_expense_category("generator_fuel") == "6717"
    assert coa_account_code_for_aquaculture_expense_category("security") == "6725"
    assert coa_account_code_for_aquaculture_expense_category("sampling_lab") == "6721"
    assert coa_account_code_for_aquaculture_expense_category("depreciation") == "6320"


@pytest.mark.django_db
def test_chart_account_id_resolves_active_company_account(company_tenant):
    acc = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="6100",
        account_name="Utilities — Electricity",
        account_type="expense",
        is_active=True,
    )
    aid = chart_account_id_for_fuel_station_expense_rollup(company_tenant.id, "utilities")
    assert aid == acc.id
