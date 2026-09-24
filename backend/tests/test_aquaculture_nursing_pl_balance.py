"""Nursing pond P&L balances to zero when all fingerlings are transferred."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishStockLedger,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_nursing_pond_income_equals_expense_when_batch_emptied(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid,
        name="Balance Nursing",
        pond_role="nursing",
        is_active=True,
    )
    grow = AquaculturePond.objects.create(
        company_id=cid,
        name="Balance Grow",
        pond_role="grow_out",
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("500000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 15),
        expense_category="feed_purchase",
        amount=Decimal("80000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 10),
        expense_category="electricity",
        amount=Decimal("20000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=200000,
        weight_kg_delta=Decimal("400"),
        memo="Fingerlings",
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 5, 17),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=grow,
        weight_kg=Decimal("400"),
        fish_count=200000,
        cost_amount=Decimal("0"),
    )
    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=nursing.id,
        from_production_cycle_id=None,
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 4, 1),
        date(2026, 5, 31),
        nursing.id,
        None,
        None,
        include_cycle_breakdown=False,
    )
    pond_row = next(p for p in payload["ponds"] if p["pond_id"] == nursing.id)
    income = Decimal(pond_row["income_total"])
    expense = Decimal(pond_row["expense_total"])
    net = Decimal(pond_row["net_profit"])
    assert income > 0
    assert expense > 0
    assert income == expense
    assert net == Decimal("0.00")

    income_types = {r["income_type"]: Decimal(r["amount"]) for r in pond_row["revenue_by_income_type"]}
    assert income_types.get("fingerling_sale", Decimal("0")) > 0


@pytest.mark.django_db
def test_nursing_empty_transfer_ignores_stale_biomass_sample_in_denominator(company_tenant):
    """
    After all fish leave, a leftover biomass sample must not inflate the survivor pool
    (that would leave nursing income < expenses → negative profit).
    """
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid,
        name="Sample Inflate Nursing",
        pond_role="nursing",
        is_active=True,
    )
    grow = AquaculturePond.objects.create(
        company_id=cid,
        name="Sample Inflate Grow",
        pond_role="grow_out",
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("100000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=100000,
        weight_kg_delta=Decimal("200"),
        memo="Stock",
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=nursing,
        sample_date=date(2026, 5, 1),
        fish_species="tilapia",
        stock_reference_fish_count=100000,
        estimated_fish_count=100000,
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 5, 17),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=grow,
        weight_kg=Decimal("200"),
        fish_count=100000,
        cost_amount=Decimal("0"),
    )
    # Ledger emptied by transfer posting path may not run in this unit test — simulate empty.
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 5, 17),
        entry_kind="transfer_out",
        fish_species="tilapia",
        fish_count_delta=-100000,
        weight_kg_delta=Decimal("-200"),
        memo="All out",
    )
    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=nursing.id,
        from_production_cycle_id=None,
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 4, 1),
        date(2026, 5, 31),
        nursing.id,
        None,
        None,
        include_cycle_breakdown=False,
    )
    pond_row = next(p for p in payload["ponds"] if p["pond_id"] == nursing.id)
    assert Decimal(pond_row["income_total"]) == Decimal(pond_row["expense_total"])
    assert Decimal(pond_row["net_profit"]) == Decimal("0.00")


@pytest.mark.django_db
def test_nursing_resync_includes_expense_after_last_transfer(company_tenant):
    """Feed posted after the last transfer still re-spreads onto transfer income on resync."""
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid,
        name="Late Feed Nursing",
        pond_role="nursing",
        is_active=True,
    )
    grow = AquaculturePond.objects.create(
        company_id=cid,
        name="Late Feed Grow",
        pond_role="grow_out",
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("500000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=100000,
        weight_kg_delta=Decimal("200"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 5, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=grow,
        weight_kg=Decimal("200"),
        fish_count=100000,
        cost_amount=Decimal("0"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 5, 10),
        entry_kind="transfer_out",
        fish_species="tilapia",
        fish_count_delta=-100000,
        weight_kg_delta=Decimal("-200"),
    )
    # Posted after fish left — must still move with the batch on resync.
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 5, 17),
        expense_category="feed_consumed",
        amount=Decimal("75000.00"),
    )
    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=nursing.id,
        from_production_cycle_id=None,
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 4, 1),
        date(2026, 5, 31),
        nursing.id,
        None,
        None,
        include_cycle_breakdown=False,
    )
    pond_row = next(p for p in payload["ponds"] if p["pond_id"] == nursing.id)
    assert Decimal(pond_row["income_total"]) == Decimal("575000.00")
    assert Decimal(pond_row["expense_total"]) == Decimal("575000.00")
    assert Decimal(pond_row["net_profit"]) == Decimal("0.00")


@pytest.mark.django_db
def test_reconcile_nursing_pl_raises_sale_amount_not_only_cost(company_tenant):
    """
    When lines are IPT-priced (sale_amount set), P&L income follows sale — not cost.
    Reconcile must bump sale_amount (and refresh the mirror) or the gap never closes.
    """
    from django.core.management import call_command

    from api.services.aquaculture_fish_transfer_as_sale import ensure_fish_sale_for_transfer_line

    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid,
        name="SaleLock Nursing",
        code="PN-SL",
        pond_role="nursing",
        is_active=True,
    )
    grow = AquaculturePond.objects.create(
        company_id=cid,
        name="SaleLock Grow",
        code="PG-SL",
        pond_role="grow_out",
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("100000.00"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 5, 1),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=grow,
        weight_kg=Decimal("100"),
        fish_count=50000,
        cost_amount=Decimal("40000.00"),
        sale_amount=Decimal("40000.00"),
    )
    ensure_fish_sale_for_transfer_line(line, transfer=tr)

    before = compute_aquaculture_pl_summary_dict(
        cid, date(2026, 4, 1), date(2026, 5, 31), nursing.id, None, None, include_cycle_breakdown=False
    )
    before_row = next(p for p in before["ponds"] if p["pond_id"] == nursing.id)
    assert Decimal(before_row["net_profit"]) < Decimal("-500")

    call_command(
        "reconcile_nursing_pond_pl_balance",
        company_id=cid,
        pond_code="PN-SL",
        period_start="2026-04-01",
        period_end="2026-05-31",
        skip_resync=True,
    )

    line.refresh_from_db()
    assert line.cost_amount == Decimal("100000.00")
    # Sale must move with the gap; GL/internal pricing may then add margin on top.
    assert line.sale_amount >= Decimal("100000.00")

    after = compute_aquaculture_pl_summary_dict(
        cid, date(2026, 4, 1), date(2026, 5, 31), nursing.id, None, None, include_cycle_breakdown=False
    )
    after_row = next(p for p in after["ponds"] if p["pond_id"] == nursing.id)
    # Gap closed (income caught expense); tiny surplus OK if margin reprice ran after bump.
    assert Decimal(after_row["income_total"]) >= Decimal(after_row["expense_total"])
    assert Decimal(after_row["net_profit"]) >= Decimal("0.00")
