"""Pond economics snapshot API — live fish, biomass, cost, transfer cost/head."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquacultureFishStockLedger, AquaculturePond, Company
from api.services.aquaculture_pond_economics_service import (
    compute_pond_economics_portfolio,
    compute_pond_economics_snapshot,
)

pytestmark = pytest.mark.django_db


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_pond_economics_snapshot_live_heads_and_transfer_cost(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Econ", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("1100000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 4, 10),
        expense_category="feed_purchase",
        amount=Decimal("500000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 4, 20),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=450000,
        weight_kg_delta=Decimal("225"),
        memo="Survivors",
    )

    snap = compute_pond_economics_snapshot(
        cid, pond.id, as_of_date=date(2026, 5, 1), include_last_sale=False
    )
    assert snap is not None
    assert snap["live_fish_count"] == 450000
    assert Decimal(snap["total_biological_asset_value"]) == Decimal("1600000.00")
    assert Decimal(snap["transfer_cost_per_head"]) == Decimal("3.56")
    assert snap["pond_role"] == "nursing"


@pytest.mark.django_db
def test_pond_economics_portfolio_lists_active_ponds(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    AquaculturePond.objects.create(company_id=cid, name="P-A", is_active=True)
    AquaculturePond.objects.create(company_id=cid, name="P-B", is_active=True)
    payload = compute_pond_economics_portfolio(cid, as_of_date=date(2026, 5, 1))
    assert payload["pond_count"] == 2
    assert len(payload["ponds"]) == 2
