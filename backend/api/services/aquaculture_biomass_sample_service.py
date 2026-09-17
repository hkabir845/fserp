"""Derive pond-level biomass estimates from a net-caught sample and transactional fish stock."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from api.utils.decimal_fields import fit_decimal
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _reference_avg_weight_kg(row: dict, tc: int, tw: Decimal) -> Decimal | None:
    """Book mean kg/fish from net position, or gross stocked-in when net kg is non-positive."""
    if tc <= 0:
        return None
    if tw > 0:
        return (tw / Decimal(tc)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    stocked_c = int(row.get("stocked_fish_count") or 0)
    stocked_w = Decimal(str(row.get("stocked_weight_kg") or "0"))
    if stocked_c > 0 and stocked_w > 0:
        return (stocked_w / Decimal(stocked_c)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    return None


def _prior_standing_sample_avg_kg(sample) -> Decimal | None:
    """Mean kg/fish from the previous standing sample (same pond/cycle/species)."""
    from api.models import AquacultureBiomassSample

    sample_date = getattr(sample, "sample_date", None)
    if sample_date is None:
        return None
    cy_id = getattr(sample, "production_cycle_id", None)
    sp = (getattr(sample, "fish_species", None) or "tilapia").strip() or "tilapia"
    qs = AquacultureBiomassSample.objects.filter(
        company_id=sample.company_id,
        pond_id=sample.pond_id,
        fish_species=sp,
        source_fish_sale__isnull=True,
        source_bill_line__isnull=True,
        source_fish_pond_transfer_line__isnull=True,
        sample_date__lt=sample_date,
    )
    if cy_id is not None:
        qs = qs.filter(production_cycle_id=cy_id)
    else:
        qs = qs.filter(production_cycle_id__isnull=True)
    prev = qs.order_by("-sample_date", "-id").first()
    if prev is None:
        return None
    fc = prev.estimated_fish_count
    etw = prev.estimated_total_weight_kg
    if fc and fc > 0 and etw is not None and Decimal(str(etw)) > 0:
        return (Decimal(str(etw)) / Decimal(int(fc))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    if prev.avg_weight_kg is not None and prev.avg_weight_kg > 0:
        return Decimal(str(prev.avg_weight_kg)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    return None


def apply_aquaculture_biomass_sample_extrapolation(sample) -> None:
    """
    Fill stock reference + extrapolation fields on AquacultureBiomassSample (in-memory).
    Caller saves. Uses same implied net count/kg as the Fish stock page for pond/cycle/species.

    ``biomass_gain_kg`` prefers (this mean − prior standing mean) × heads so a bad
    book kg (negative after market harvest of fry-weight stock) does not invent
    −80 t “gains” on the sampling screen.
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

    book_avg = _reference_avg_weight_kg(r, tc, tw)
    if book_avg is not None:
        sample.stock_reference_avg_weight_kg = book_avg

    fc = sample.estimated_fish_count
    etw = sample.estimated_total_weight_kg
    if fc is None or fc <= 0 or etw is None or etw <= 0:
        return

    sample_avg = (etw / Decimal(fc)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    # Persist the combine mean from the two entered fields so load/FCR/feed never
    # inherit a stale or inverted avg_weight_kg from the client.
    sample.avg_weight_kg = fit_decimal(sample_avg, max_digits=14, decimal_places=6)
    if tc <= 0:
        return

    sample.extrapolated_biomass_kg = fit_decimal(
        (sample_avg * Decimal(tc)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        max_digits=14,
        decimal_places=4,
    )
    prior_avg = _prior_standing_sample_avg_kg(sample)
    gain_ref = prior_avg if prior_avg is not None and prior_avg > 0 else book_avg
    if gain_ref is not None and gain_ref > 0:
        sample.biomass_gain_kg = fit_decimal(
            ((sample_avg - gain_ref) * Decimal(tc)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            max_digits=14,
            decimal_places=4,
        )
