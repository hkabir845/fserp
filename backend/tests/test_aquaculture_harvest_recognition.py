"""The same completed-sale basis must drive physical stock, FCR and costing."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishSale, AquacultureFishStockLedger, AquaculturePond, Customer, Invoice
from api.services.aquaculture_cost_per_kg import harvest_weight_denominator_kg
from api.services.aquaculture_fcr_service import _same_day_harvest_fish_count, sum_harvest_kg_for_period
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_reports_registry import _fcr_data_coverage


@pytest.mark.django_db
@pytest.mark.parametrize("status", [None, "draft", "void", "sent", "paid", "partial", "overdue"])
def test_invoice_lifecycle_keeps_stock_fcr_and_costing_in_agreement(company_tenant, status):
    cid = company_tenant.id
    day = date(2026, 4, 20)
    pond = AquaculturePond.objects.create(company_id=cid, name="Recognition pond")
    AquacultureFishStockLedger.objects.create(
        company_id=cid, pond=pond, entry_date=date(2026, 4, 1),
        entry_kind="adjustment", fish_species="tilapia",
        fish_count_delta=100, weight_kg_delta=Decimal("100"),
    )
    invoice = None
    if status is not None:
        customer = Customer.objects.create(company_id=cid, display_name="Harvest buyer")
        invoice = Invoice.objects.create(
            company_id=cid, customer=customer, invoice_number="HARVEST-1",
            invoice_date=day, status=status, subtotal=1000, total=1000,
        )
    AquacultureFishSale.objects.create(
        company_id=cid, pond=pond, invoice=invoice, sale_date=day,
        income_type="fish_harvest_sale", fish_species="tilapia",
        fish_count=10, weight_kg=Decimal("10"), total_amount=1000,
    )
    expected = 0 if status in (None, "draft", "void") else 10
    assert sum_harvest_kg_for_period(cid, day, day, pond_id=pond.id) == Decimal(expected)
    assert _same_day_harvest_fish_count(cid, pond.id, day) == expected
    primary, fallback, basis = harvest_weight_denominator_kg(
        company_id=cid, pond_id=pond.id, start=day, end=day, cycle_filter_id=None,
    )
    assert primary == fallback == Decimal(expected)
    assert basis == ("harvest_sale" if expected else "none")
    row = compute_fish_stock_position_rows(cid, pond_id=pond.id, as_of_date=day)[0]
    assert row["sale_fish_count"] == expected
    assert Decimal(row["sale_weight_kg"]) == Decimal(expected)
    assert row["implied_net_fish_count"] == 100 - expected
    coverage = _fcr_data_coverage(cid, day, day, pond_id=pond.id)
    assert coverage["harvest_sale_rows_in_period"] == int(expected > 0)
    assert coverage["uninvoiced_harvest_rows_in_period"] == int(status is None)
    assert coverage["draft_or_void_invoice_harvest_rows_in_period"] == int(status in ("draft", "void"))
