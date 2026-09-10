"""Biological cost per kg: the right divisor, over the right window.

Two defects that were really one — the cost/kg basis (A0-3, A0-4 in
`docs/ACCOUNTING_AUDIT_BACKLOG.md`):

* The denominator took ``max()`` of the candidate bases (period sale kg, on-hand kg, this
  movement's kg) instead of the kg the cost actually produced, which is sold **plus** still
  held. A pond that spent 100,000 on 900 kg sold and 1,000 kg still held relieved 90,000
  against the 900 kg and carried 1,000 kg at a tenth of its cost.
* Without a production cycle the costing window opened on 1 January, so a March harvest of
  fish fed since October was priced from January's costs alone.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def test_the_denominator_is_kg_sold_plus_kg_still_held():
    """100,000 of cost over 900 kg sold + 1,000 kg held is 52.63/kg, not 100/kg."""
    from api.services.aquaculture_transfer_cost import production_denominator_kg

    denom, note = production_denominator_kg(
        Decimal("900"), Decimal("1000"), None
    )
    assert denom == Decimal("1900.00"), (
        "taking the largest single basis (1,000) instead of sold + held (1,900) over-relieved "
        "COGS by nearly half"
    )
    assert "on-hand" in note
    # The relief that follows from it, for the avoidance of doubt.
    cost_per_kg = (Decimal("100000") / denom).quantize(Decimal("0.0001"))
    assert cost_per_kg == Decimal("52.6316")


def test_a_movement_larger_than_recorded_production_does_not_inflate_cost_per_kg():
    from api.services.aquaculture_transfer_cost import production_denominator_kg

    denom, note = production_denominator_kg(Decimal("0"), Decimal("100"), Decimal("500"))
    assert denom == Decimal("500.00")
    assert "exceeds" in note


def test_the_denominator_defers_when_there_is_nothing_to_divide_by():
    from api.services.aquaculture_transfer_cost import production_denominator_kg

    assert production_denominator_kg(Decimal("0"), Decimal("0"), None) == (Decimal("0"), "")


def test_the_costing_window_opens_at_the_ponds_first_cost_not_1_january(company_tenant):
    """A pond fed since October must not be priced from January onwards."""
    from api.models import AquaculturePond, Bill, BillLine, Vendor
    from api.services.aquaculture_transfer_cost import pl_window_for_transfer_date

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Overwinter Pond", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Feed Supplier")
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="B-FEED-OCT",
        bill_date=date(2025, 10, 5),
        status="open",
        total=Decimal("40000"),
    )
    BillLine.objects.create(
        bill=bill,
        description="Grow-out feed",
        quantity=Decimal("1"),
        amount=Decimal("40000"),
        aquaculture_pond=pond,
    )

    harvest_day = date(2026, 3, 20)
    start, end = pl_window_for_transfer_date(
        harvest_day, None, company_id=cid, pond_id=pond.id
    )
    assert start == date(2025, 10, 5), (
        "the window must reach back to the pond's first production cost; opening it at "
        "1 January threw away the whole autumn feed bill"
    )
    assert end == harvest_day


def test_the_window_still_falls_back_to_the_year_for_a_pond_with_no_costs(company_tenant):
    from api.models import AquaculturePond
    from api.services.aquaculture_transfer_cost import pl_window_for_transfer_date

    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Fresh Pond", pond_role="grow_out", is_active=True
    )
    start, end = pl_window_for_transfer_date(
        date(2026, 3, 20), None, company_id=company_tenant.id, pond_id=pond.id
    )
    assert (start, end) == (date(2026, 1, 1), date(2026, 3, 20))


def test_a_production_cycle_still_wins_over_the_pond_history(company_tenant):
    from api.models import AquaculturePond, AquacultureProductionCycle
    from api.services.aquaculture_transfer_cost import pl_window_for_transfer_date

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Cycle Pond", pond_role="grow_out", is_active=True
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=cid, pond=pond, name="C03", start_date=date(2026, 2, 1), is_active=True
    )
    start, end = pl_window_for_transfer_date(
        date(2026, 3, 20), cycle, company_id=cid, pond_id=pond.id
    )
    assert start == date(2026, 2, 1)
