"""
Partial harvest suggestions when pond biomass load (kg per decimal) exceeds comfort bands.

Suggestions are advisory — managers may harvest more or less than recommended.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.services.aquaculture_units import _bands_for_role, compute_stocking_load_advice


def _d(val) -> Decimal:
    if val is None or val == "":
        return Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def current_fish_per_kg_from_position_row(row: dict) -> tuple[Decimal | None, str]:
    """
    Best available pcs/kg for a stock position row.
    Returns (pcs_per_kg, source_label).
    """
    samp_fc = row.get("latest_sample_estimated_fish_count")
    samp_tw = row.get("latest_sample_estimated_total_weight_kg")
    if samp_fc is not None and samp_tw:
        try:
            fc = int(samp_fc)
            tw = _d(samp_tw)
            if fc > 0 and tw > 0:
                return (
                    (Decimal(fc) / tw).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
                    "latest biomass sample",
                )
        except (TypeError, ValueError):
            pass

    avg_raw = row.get("latest_sample_avg_weight_kg")
    if avg_raw not in (None, ""):
        try:
            avg = _d(avg_raw)
            if avg > 0:
                return (
                    (Decimal("1") / avg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
                    "latest sample avg weight",
                )
        except Exception:
            pass

    tc = row.get("implied_net_fish_count")
    tw_raw = row.get("implied_net_weight_kg")
    try:
        n = int(tc) if tc is not None else 0
    except (TypeError, ValueError):
        n = 0
    tw = _d(tw_raw)
    if n > 0 and tw > 0:
        return (
            (Decimal(n) / tw).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
            "implied net stock",
        )
    return None, ""


def compute_partial_harvest_suggestion(
    biomass_kg: Decimal,
    fish_count: int,
    *,
    water_area_decimal: Decimal | None,
    pond_role: str | None,
    current_fish_per_kg: Decimal | None = None,
    load_level: str | None = None,
) -> dict:
    """
    When load is full or high_risk, suggest kg and heads to remove to reach the comfort band.

    Returns keys:
      partial_harvest_applicable, partial_harvest_suggested_kg, partial_harvest_suggested_fish_count,
      partial_harvest_target_kg_per_decimal, partial_harvest_post_load_kg_per_decimal,
      partial_harvest_rationale
    """
    empty = {
        "partial_harvest_applicable": False,
        "partial_harvest_suggested_kg": None,
        "partial_harvest_suggested_fish_count": None,
        "partial_harvest_target_kg_per_decimal": None,
        "partial_harvest_post_load_kg_per_decimal": None,
        "partial_harvest_rationale": "",
    }
    bio = biomass_kg if biomass_kg > 0 else Decimal("0")
    if bio <= 0 or water_area_decimal is None or water_area_decimal <= 0:
        return empty

    _light, comfort, _stress = _bands_for_role(pond_role)
    kg_per_dec = (bio / water_area_decimal).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    level = (load_level or "").strip()
    if not level:
        advice = compute_stocking_load_advice(
            bio,
            water_area_decimal=water_area_decimal,
            water_volume_cu_ft=None,
            pond_role=pond_role,
        )
        level = advice.get("load_level") or ""

    if level not in ("full", "high_risk"):
        return {
            **empty,
            "partial_harvest_target_kg_per_decimal": str(comfort),
            "partial_harvest_rationale": (
                f"Load is {kg_per_dec} kg/decimal ({level or 'within range'}). "
                f"No thinning suggested; comfort target is about {comfort} kg/decimal."
            ),
        }

    target_bio = (comfort * water_area_decimal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    remove_kg = (bio - target_bio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if remove_kg <= 0:
        return empty

    remove_heads: int | None = None
    if current_fish_per_kg is not None and current_fish_per_kg > 0:
        remove_heads = int(
            (remove_kg * current_fish_per_kg).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        if remove_heads <= 0:
            remove_heads = None
    elif fish_count > 0 and bio > 0:
        frac = remove_kg / bio
        remove_heads = max(1, int((Decimal(fish_count) * frac).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))

    post_kpd = (target_bio / water_area_decimal).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    level_lbl = "high load" if level == "high_risk" else "full load"
    heads_note = f" (~{remove_heads:,} fish)" if remove_heads else ""
    rationale = (
        f"Pond is at {level_lbl} ({kg_per_dec} kg/decimal). "
        f"To reach the comfort band (~{comfort} kg/decimal), consider removing about "
        f"{remove_kg} kg{heads_note}. Post-harvest load would be ~{post_kpd} kg/decimal. "
        "You may adjust the harvest amount based on field conditions."
    )

    return {
        "partial_harvest_applicable": True,
        "partial_harvest_suggested_kg": str(remove_kg),
        "partial_harvest_suggested_fish_count": remove_heads,
        "partial_harvest_target_kg_per_decimal": str(comfort),
        "partial_harvest_post_load_kg_per_decimal": str(post_kpd),
        "partial_harvest_rationale": rationale,
    }


def effective_biomass_kg_from_position_row(row: dict) -> Decimal:
    """
    Biomass kg for outbound checks and UI when transaction book weight still reflects fry
    stocking but a biomass sample shows fingerlings have grown (pcs/kg from seine sampling).
    """
    implied_w = _d(row.get("implied_net_weight_kg"))
    try:
        fish_n = int(row.get("implied_net_fish_count") or 0)
    except (TypeError, ValueError):
        fish_n = 0
    if fish_n <= 0:
        return implied_w

    avg_kg = Decimal("0")
    raw_avg = row.get("latest_sample_avg_weight_kg")
    if raw_avg not in (None, ""):
        avg_kg = _d(raw_avg)
    if avg_kg <= 0:
        pcs, _ = current_fish_per_kg_from_position_row(row)
        if pcs is not None and pcs > 0:
            avg_kg = (Decimal("1") / pcs).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    if avg_kg > 0:
        sample_based = (avg_kg * Decimal(fish_n)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        return max(implied_w, sample_based)
    return implied_w


def enrich_position_row_with_fish_metrics(row: dict, *, water_area_decimal) -> dict:
    """Add current pcs/kg and partial-harvest suggestion fields to a stock position dict."""
    pcs, pcs_src = current_fish_per_kg_from_position_row(row)
    avg_kg: str | None = None
    if pcs is not None and pcs > 0:
        avg_kg = str((Decimal("1") / pcs).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP))
    elif row.get("latest_sample_avg_weight_kg"):
        avg_kg = str(row.get("latest_sample_avg_weight_kg"))

    try:
        fish_n = int(row.get("implied_net_fish_count") or 0)
    except (TypeError, ValueError):
        fish_n = 0
    bio = effective_biomass_kg_from_position_row(row)
    txn_bio = _d(row.get("implied_net_weight_kg"))

    harvest = compute_partial_harvest_suggestion(
        bio,
        fish_n,
        water_area_decimal=water_area_decimal,
        pond_role=row.get("pond_role"),
        current_fish_per_kg=pcs,
        load_level=row.get("load_level"),
    )

    out = {**row}
    out["current_fish_per_kg"] = str(pcs) if pcs is not None else None
    out["current_fish_per_kg_source"] = pcs_src or None
    out["current_avg_weight_kg"] = avg_kg
    out["effective_net_weight_kg"] = str(bio)
    out["book_net_weight_kg"] = str(txn_bio)
    out.update(harvest)
    return out
