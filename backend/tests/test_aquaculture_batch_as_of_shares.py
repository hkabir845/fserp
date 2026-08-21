"""As-of-date batch feed shares respect harvests/sales before allocating consumption."""
from __future__ import annotations

from decimal import Decimal

from api.services.aquaculture_feeding_advice_service import _select_biomass_for_feeding_kg


def test_honor_harvests_prefers_implied_over_stale_sample():
    """After a sale, sample total is stale; as-of allocation must use implied net."""
    row = {
        "latest_sample_estimated_total_weight_kg": "3000",
        "implied_net_weight_kg": "1800",
        "implied_net_fish_count": 9000,
        "latest_sample_avg_weight_kg": "0.25",
    }
    kg_live, src_live = _select_biomass_for_feeding_kg(row, honor_harvests=False)
    assert kg_live == Decimal("3000.00")
    assert "sample" in src_live

    kg_asof, src_asof = _select_biomass_for_feeding_kg(row, honor_harvests=True)
    assert kg_asof == Decimal("1800.00")
    assert "after sales" in src_asof or "implied" in src_asof


def test_honor_harvests_uses_avg_times_remaining_count():
    row = {
        "latest_sample_estimated_total_weight_kg": None,
        "implied_net_weight_kg": "0",
        "implied_net_fish_count": 4000,
        "latest_sample_avg_weight_kg": "0.2",
    }
    kg, src = _select_biomass_for_feeding_kg(row, honor_harvests=True)
    assert kg == Decimal("800.00")
    assert "as-of" in src
