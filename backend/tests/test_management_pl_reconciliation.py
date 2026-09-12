"""Management adjustments must preserve category policy and report arithmetic."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquaculturePond, TenantReportingCategory
from api.services.reporting import _fold_aquaculture_register_into_pl_sections, report_income_statement


@pytest.mark.django_db
@pytest.mark.parametrize("capitalize", [True, False])
@pytest.mark.parametrize("active", [True, False])
def test_custom_categories_follow_their_capitalization_mapping(company_tenant, capitalize, active):
    company_tenant.aquaculture_capitalize_pond_consumption_to_bioasset = capitalize
    company_tenant.save(update_fields=["aquaculture_capitalize_pond_consumption_to_bioasset"])
    pond = AquaculturePond.objects.create(company=company_tenant, name="Category policy pond")
    category = TenantReportingCategory.objects.create(
        company=company_tenant, application="aquaculture", kind="expense", code="aqe001",
        label="Aeration equipment", maps_to_code="equipment", is_active=active,
    )
    AquacultureExpense.objects.create(
        company=company_tenant, pond=pond, expense_date=date(2026, 6, 1),
        expense_category=category.code, amount=Decimal("9000"),
    )
    pl = report_income_statement(company_tenant.id, date(2026, 6, 1), date(2026, 6, 30))
    assert Decimal(pl["expenses"]["total"]) == (Decimal("0") if capitalize else Decimal("9000"))
    assert Decimal(pl["net_income"]) == -Decimal(pl["expenses"]["total"])


@pytest.mark.django_db
def test_management_adjustment_preserves_negative_non_pond_income(company_tenant):
    out = {
        "income": {"accounts": [
            {"account_code": "4100", "balance": "-100.00"},
            {"account_code": "4240", "balance": "200.00"},
        ], "total": "100.00"},
        "expenses": {"accounts": [], "total": "0.00"},
        "gross_profit": "100.00", "net_income": "100.00",
        "aquaculture_management": {"totals": {"income": "200.00"},
            "income_by_category": [{"category": "fish_harvest_sale", "amount": "200.00"}]},
    }
    _fold_aquaculture_register_into_pl_sections(out, company_tenant.id, date(2026, 6, 1), date(2026, 6, 30))
    assert Decimal(out["income"]["total"]) == Decimal("100.00")
    assert Decimal(out["net_income"]) == Decimal("100.00")


@pytest.mark.django_db
def test_management_recalculates_profit_when_adjustments_only_remove_rows(company_tenant):
    out = {
        "income": {"accounts": [{"account_code": "4240", "balance": "100.00"}], "total": "100.00"},
        "expenses": {"accounts": [], "total": "0.00"},
        "gross_profit": "100.00", "net_income": "100.00",
        "aquaculture_management": {"totals": {"income": "0.00"}},
    }
    _fold_aquaculture_register_into_pl_sections(out, company_tenant.id, date(2026, 6, 1), date(2026, 6, 30))
    assert Decimal(out["income"]["total"]) == Decimal("0.00")
    assert Decimal(out["gross_profit"]) == Decimal("0.00")
    assert Decimal(out["net_income"]) == Decimal("0.00")
