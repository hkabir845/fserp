"""Unit tests for historical batch consumption reconcile helpers."""
from __future__ import annotations

from decimal import Decimal

from api.services.aquaculture_feeding_advice_service import (
    allocate_decimal_by_weights,
    allocate_feed_kg_across_batches,
)


def test_reconcile_weights_match_live_feed_split():
    shares = [
        {"production_cycle_id": 1, "share_weight": "25", "daily_demand_kg": "25"},
        {"production_cycle_id": 2, "share_weight": "75", "daily_demand_kg": "75"},
    ]
    out = allocate_feed_kg_across_batches(Decimal("40"), shares)
    assert Decimal(out[0]["allocated_kg"]) == Decimal("10.00")
    assert Decimal(out[1]["allocated_kg"]) == Decimal("30.00")
    amts = allocate_decimal_by_weights(Decimal("1000.00"), [Decimal("10"), Decimal("30")])
    assert sum(amts) == Decimal("1000.00")
