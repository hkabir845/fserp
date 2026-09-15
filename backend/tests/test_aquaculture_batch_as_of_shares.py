"""As-of-date batch feed shares respect harvests/sales before allocating consumption."""
from __future__ import annotations

from decimal import Decimal

from api.services.aquaculture_feeding_advice_service import _select_biomass_for_feeding_kg


def test_honor_harvests_uses_combined_mean_x_remaining_heads():
    """After a sale, as-of heads are already reduced; still combine mean × those heads."""
    row = {
        "latest_sample_estimated_total_weight_kg": "12.5",
        "latest_sample_estimated_fish_count": 50,
        "implied_net_weight_kg": "1800",
        "implied_net_fish_count": 9000,
        "latest_sample_avg_weight_kg": "0.25",
    }
    kg_live, src_live = _select_biomass_for_feeding_kg(row, honor_harvests=False)
    assert kg_live == Decimal("2250.00")  # 0.25 × 9000 combined
    assert "combined" in src_live or "book head" in src_live

    kg_asof, src_asof = _select_biomass_for_feeding_kg(row, honor_harvests=True)
    assert kg_asof == Decimal("2250.00")
    assert "as-of" in src_asof or "combined" in src_asof or "harvest" in src_asof


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
