"""Biological asset valuation: fry + feed + labour accumulate; mortality retains cost on survivors."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_biological_asset_service import (
    compute_pond_biological_asset_summary,
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_biological_asset_includes_fry_and_feed(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 3, 1),
        expense_category="fry_stocking",
        amount=Decimal("1100000.00"),
        memo="Tilapia fry 500k pcs",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 3, 15),
        expense_category="feed_purchase",
        amount=Decimal("250000.00"),
        memo="Nursing feed",
    )
    summary = compute_pond_biological_asset_summary(
        cid, pond_id=pond.id, as_of_date=date(2026, 4, 1)
    )
    total = Decimal(summary["total_biological_asset_value"])
    assert total == Decimal("1350000.00")
    buckets = {b["cost_bucket"]: Decimal(b["amount"]) for b in summary["cost_buckets"]}
    assert buckets.get("fry_stocking") == Decimal("1100000.00")
    assert buckets.get("feed") == Decimal("250000.00")


@pytest.mark.django_db
def test_mortality_does_not_reduce_accumulated_cost(company_tenant):
    """Mortality reduces live count but total biological asset value stays on survivors."""
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 3, 1),
        expense_category="fry_stocking",
        amount=Decimal("1000000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 3, 10),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("250.0000"),
        memo="Opening stock for mortality test",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 3, 20),
        entry_kind="loss",
        loss_reason="mortality",
        fish_count_delta=-50000,
        weight_kg_delta=Decimal("-25.0000"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="Mortality — cost retained on survivors",
    )
    before = compute_pond_biological_asset_summary(
        cid, pond_id=pond.id, as_of_date=date(2026, 3, 19)
    )
    after = compute_pond_biological_asset_summary(
        cid, pond_id=pond.id, as_of_date=date(2026, 3, 21)
    )
    assert Decimal(before["total_biological_asset_value"]) == Decimal("1000000.00")
    assert Decimal(after["total_biological_asset_value"]) == Decimal("1000000.00")
    assert after["cost_redistribution_note"] is not None


@pytest.mark.django_db
def test_transfer_moves_cost_between_ponds(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing", pond_role="nursing", is_active=True
    )
    growout = AquaculturePond.objects.create(
        company_id=cid, name="Growout A", pond_role="grow_out", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 3, 1),
        expense_category="fry_stocking",
        amount=Decimal("273000.00"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 4, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=growout,
        weight_kg=Decimal("100.0000"),
        fish_count=100000,
        cost_amount=Decimal("273000.00"),
    )
    n_summary = compute_pond_biological_asset_summary(
        cid, pond_id=nursing.id, as_of_date=date(2026, 4, 2)
    )
    g_summary = compute_pond_biological_asset_summary(
        cid, pond_id=growout.id, as_of_date=date(2026, 4, 2)
    )
    assert Decimal(n_summary["transfer_cost_out"]) == Decimal("273000.00")
    assert Decimal(g_summary["transfer_cost_in"]) == Decimal("273000.00")
    assert Decimal(g_summary["total_biological_asset_value"]) == Decimal("273000.00")
    assert g_summary["cost_per_fish"] == "2.73"
