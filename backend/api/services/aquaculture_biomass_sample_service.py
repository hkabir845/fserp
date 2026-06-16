"""Derive pond-level biomass estimates from a net-caught sample and transactional fish stock."""
from __future__ import annotations

from decimal import Decimal

from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _reference_avg_weight_kg(row: dict, tc: int, tw: Decimal) -> Decimal | None:
    """Book mean kg/fish from net position, or gross stocked-in when net kg is non-positive."""
    if tc <= 0:
        return None
    if tw > 0:
        return (tw / Decimal(tc)).quantize(Decimal("0.000001"))
    stocked_c = int(row.get("stocked_fish_count") or 0)
    stocked_w = Decimal(str(row.get("stocked_weight_kg") or "0"))
    if stocked_c > 0 and stocked_w > 0:
        return (stocked_w / Decimal(stocked_c)).quantize(Decimal("0.000001"))
    return None


def apply_aquaculture_biomass_sample_extrapolation(sample) -> None:
    """
    Fill stock reference + extrapolation fields on AquacultureBiomassSample (in-memory).
    Caller saves. Uses same implied net count/kg as the Fish stock page for pond/cycle/species.
    """
    sample.stock_reference_fish_count = None
    sample.stock_reference_net_weight_kg = None
    sample.stock_reference_avg_weight_kg = None
    sample.extrapolated_biomass_kg = None
    sample.biomass_gain_kg = None

    cid = sample.company_id
    sp = (getattr(sample, "fish_species", None) or "tilapia").strip() or "tilapia"
    cy_id = getattr(sample, "production_cycle_id", None)

    rows = compute_fish_stock_position_rows(
        cid,
        pond_id=sample.pond_id,
        production_cycle_id=cy_id,
        fish_species_filter=sp,
        # Samples may reference inactive/historical ponds; still snapshot book position.
        include_inactive_ponds=True,
    )
    if not rows:
        return

    r = rows[0]
    tc = int(r.get("implied_net_fish_count") or 0)
    tw = Decimal(str(r.get("implied_net_weight_kg") or "0"))

    if tc > 0:
        sample.stock_reference_fish_count = tc
    sample.stock_reference_net_weight_kg = tw if tw != 0 else None

    ref_avg = _reference_avg_weight_kg(r, tc, tw)
    if ref_avg is not None:
        sample.stock_reference_avg_weight_kg = ref_avg

    fc = sample.estimated_fish_count
    etw = sample.estimated_total_weight_kg
    if fc is None or fc <= 0 or etw is None or etw <= 0:
        return

    sample_avg = (etw / Decimal(fc)).quantize(Decimal("0.000001"))
    if tc <= 0:
        return

    sample.extrapolated_biomass_kg = (sample_avg * Decimal(tc)).quantize(Decimal("0.0001"))
    if ref_avg is not None:
        sample.biomass_gain_kg = ((sample_avg - ref_avg) * Decimal(tc)).quantize(Decimal("0.0001"))
