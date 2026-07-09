"""Nursing pond P&L balances to zero when all fingerlings are transferred."""

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
    assert income_types.get("inter_pond_fingerling_transfer", Decimal("0")) > 0
