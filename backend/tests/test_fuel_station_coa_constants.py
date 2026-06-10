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
    assert coa_account_code_for_fuel_station_expense_rollup("utilities") == "6100"
    assert coa_account_code_for_fuel_station_expense_rollup("maintenance") == "6300"
    assert coa_account_code_for_fuel_station_expense_rollup("cost_of_sales") == "5200"
    assert coa_account_code_for_fuel_station_expense_rollup("other") == "6990"


@pytest.mark.django_db
def test_fuel_station_income_rollup_coa_codes(company_tenant):
    assert coa_account_code_for_fuel_station_income_rollup("fuel_revenue") == "4100"
    assert coa_account_code_for_fuel_station_income_rollup("shop_revenue") == "4200"
    assert coa_account_code_for_fuel_station_income_rollup("services_revenue") == "4220"
    assert coa_account_code_for_fuel_station_income_rollup("other") == "4230"


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
