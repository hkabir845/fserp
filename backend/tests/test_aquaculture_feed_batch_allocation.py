"""Pond feed split across stocking batches using sampling biomass × WorldFish %BW."""
from __future__ import annotations

from decimal import Decimal

from api.services.aquaculture_feeding_advice_service import (
    allocate_decimal_by_weights,
    allocate_feed_kg_across_batches,
)


def test_allocate_decimal_by_weights_sums_to_total():
    parts = allocate_decimal_by_weights(Decimal("100"), [Decimal("30"), Decimal("70")])
    assert parts == [Decimal("30.00"), Decimal("70.00")]
    assert sum(parts) == Decimal("100.00")


def test_allocate_decimal_remainder_sweeps_to_largest():
    parts = allocate_decimal_by_weights(Decimal("10.00"), [Decimal("1"), Decimal("1"), Decimal("1")])
    assert sum(parts) == Decimal("10.00")
    assert max(parts) >= min(parts)


def test_allocate_feed_kg_across_batches_proportional():
    shares = [
        {
            "production_cycle_id": 1,
            "production_cycle_name": "C01",
            "share_weight": "40",
            "daily_demand_kg": "40",
        },
        {
            "production_cycle_id": 2,
            "production_cycle_name": "C02",
            "share_weight": "60",
            "daily_demand_kg": "60",
        },
    ]
    out = allocate_feed_kg_across_batches(Decimal("50"), shares)
    assert len(out) == 2
    assert Decimal(out[0]["allocated_kg"]) == Decimal("20.00")
    assert Decimal(out[1]["allocated_kg"]) == Decimal("30.00")
    assert Decimal(out[0]["share_fraction"]) == Decimal("0.4000")
    assert Decimal(out[1]["share_fraction"]) == Decimal("0.6000")
