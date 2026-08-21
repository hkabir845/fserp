"""
Partial harvest suggestions when pond biomass load (kg per decimal) exceeds comfort bands.

Suggestions are advisory — managers may harvest more or less than recommended.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.services.aquaculture_i18n import (
    company_language,
    fish_per_kg_source,
    normalize_lang,
    owner_decision_grow,
    owner_decision_monitor,
    owner_decision_partial_harvest,
    owner_decision_set_pond_area_fallback,
    partial_harvest_no_thin_rationale,
    partial_harvest_rationale,
)
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
    Returns (pcs_per_kg, source_key for i18n).
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
                    "latest_biomass_sample",
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
                    "latest_sample_avg_weight",
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
            "implied_net_stock",
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
    lang: str | None = "en",
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

    lang_n = normalize_lang(lang)
    _light, comfort, _stress = _bands_for_role(pond_role)
    kg_per_dec = (bio / water_area_decimal).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    level = (load_level or "").strip()
    if not level:
        advice = compute_stocking_load_advice(
            bio,
            water_area_decimal=water_area_decimal,
            water_volume_cu_ft=None,
            pond_role=pond_role,
            lang=lang_n,
        )
        level = advice.get("load_level") or ""

    if level not in ("full", "high_risk"):
        return {
            **empty,
            "partial_harvest_target_kg_per_decimal": str(comfort),
            "partial_harvest_rationale": partial_harvest_no_thin_rationale(
                kg_per_dec, level, comfort, lang_n
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
    rationale = partial_harvest_rationale(
        level=level,
        kg_per_dec=kg_per_dec,
        comfort=comfort,
        remove_kg=remove_kg,
        remove_heads=remove_heads,
        post_kpd=post_kpd,
        lang=lang_n,
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


def pond_biomass_alert_summary(row: dict | None) -> dict:
    """
    Farm-floor alert for pond load, derived from the biomass advice row.

    Deliberately driven by biomass per decimal rather than head count: a pond is stressed by the
    weight it carries, not by how many fish that weight is spread across.

    ``severity`` is always one of green / yellow / red so a caller can switch on it exhaustively.
    Expects a row from :func:`compute_biomass_load_advice_dict` (load_level vocabulary:
    understocked | moderate | full | high_risk | unknown).
    """
    if not row:
        return {
            "severity": "green",
            "action": "monitor",
            "reason": "No pond data available.",
            "suggested_reduction_kg": None,
        }

    load_level = str(row.get("load_level") or "").strip().lower()
    density = row.get("stock_density_kg_per_decimal")
    water_area_decimal = row.get("water_area_decimal")
    suggested_kg = row.get("partial_harvest_suggested_kg")
    reduction = str(suggested_kg) if suggested_kg not in (None, "") else None
    rationale = str(row.get("partial_harvest_rationale") or row.get("owner_decision_summary") or "").strip()

    # Pond area drives every band, so without it no load statement is trustworthy.
    if water_area_decimal in (None, "") or str(water_area_decimal).strip() in ("0", "0.0"):
        return {
            "severity": "yellow",
            "action": "Set the pond water area so biomass load can be checked against capacity.",
            "reason": "Pond area is missing, so kg per decimal cannot be calculated.",
            "suggested_reduction_kg": None,
        }

    if load_level == "high_risk":
        return {
            "severity": "red",
            "action": "Reduce fish biomass with transfer or partial harvest before the pond exceeds safe capacity.",
            "reason": (
                f"Biomass load is {density} kg/decimal, above the pond's safe comfort band. "
                f"{rationale or 'Pond is above the recommended load range.'}"
            ).strip(),
            "suggested_reduction_kg": reduction,
        }

    if load_level == "full" or (not load_level and row.get("partial_harvest_applicable") is True):
        return {
            "severity": "yellow",
            "action": "Increase aeration and prepare a partial harvest or transfer to lower biomass.",
            "reason": (
                f"Pond is at full biomass capacity ({density} kg/decimal) and should not receive more fish."
            ),
            "suggested_reduction_kg": reduction,
        }

    if load_level == "moderate":
        return {
            "severity": "yellow",
            "action": "Monitor closely and hold feeding to the current biomass level.",
            "reason": f"Pond load ({density} kg/decimal) is within the moderate range but needs active monitoring.",
            "suggested_reduction_kg": reduction,
        }

    if load_level == "understocked":
        return {
            "severity": "green",
            "action": "Continue growing; the pond has headroom for more biomass.",
            "reason": f"Pond load ({density} kg/decimal) is below the comfort band.",
            "suggested_reduction_kg": None,
        }

    return {
        "severity": "green",
        "action": "Continue normal feeding and monitoring; keep biomass within pond-specific capacity.",
        "reason": "Pond load is acceptable for routine management.",
        "suggested_reduction_kg": None,
    }


def compute_biomass_load_advice_dict(
    *,
    biomass_kg: Decimal,
    fish_count: int,
    water_area_decimal: Decimal | None,
    pond_role: str | None,
    water_volume_cu_ft: Decimal | None = None,
    fish_per_kg: Decimal | None = None,
    lang: str | None = "en",
) -> dict:
    """
    Load level and partial-harvest hint from biomass kg and head count (e.g. sample extrapolation).

    owner_decision_recommended is True when load is full or high_risk — manager should consider thinning.
    """
    lang_n = normalize_lang(lang)
    bio = biomass_kg if biomass_kg > 0 else Decimal("0")
    advice = compute_stocking_load_advice(
        bio,
        water_area_decimal=water_area_decimal,
        water_volume_cu_ft=water_volume_cu_ft,
        pond_role=pond_role,
        lang=lang_n,
        fish_count=max(fish_count, 0),
    )
    harvest = compute_partial_harvest_suggestion(
        bio,
        fish_count,
        water_area_decimal=water_area_decimal,
        pond_role=pond_role,
        current_fish_per_kg=fish_per_kg,
        load_level=advice.get("load_level"),
        lang=lang_n,
    )
    level = (advice.get("load_level") or "").strip()
    decision = level in ("full", "high_risk")
    _light, comfort, _stress = _bands_for_role(pond_role)

    if water_area_decimal is None or water_area_decimal <= 0:
        summary = advice.get("advice_summary") or owner_decision_set_pond_area_fallback(lang_n)
        action = "set_pond_area"
    elif decision and harvest.get("partial_harvest_applicable"):
        sk = harvest.get("partial_harvest_suggested_kg")
        sh = harvest.get("partial_harvest_suggested_fish_count")
        kpd = advice.get("stock_density_kg_per_decimal")
        summary = owner_decision_partial_harvest(
            load_label=advice.get("load_level_label") or level,
            level=level,
            kpd=kpd,
            sk=sk,
            sh=int(sh) if sh else None,
            comfort=comfort,
            lang=lang_n,
        )
        action = "partial_harvest"
    elif level == "understocked":
        summary = owner_decision_grow(advice.get("stock_density_kg_per_decimal"), comfort, lang_n)
        action = "grow"
    elif level == "moderate":
        summary = owner_decision_monitor(advice.get("stock_density_kg_per_decimal"), lang_n)
        action = "monitor"
    else:
        summary = advice.get("advice_summary") or ""
        action = "monitor"

    out = {
        **advice,
        **harvest,
        "water_area_decimal": str(water_area_decimal) if water_area_decimal and water_area_decimal > 0 else None,
        "comfort_kg_per_decimal": str(comfort),
        "owner_decision_recommended": decision,
        "owner_decision_summary": summary,
        "owner_action": action,
        "biomass_kg_for_load": str(bio),
        "fish_count_for_load": fish_count,
    }
    out["biomass_alert"] = pond_biomass_alert_summary(out)
    return out


def sample_load_advice_from_sample(sample, *, pond=None) -> dict:
    """Load / partial-harvest fields for a saved biomass sample row."""
    pond_obj = pond or getattr(sample, "pond", None)
    if pond_obj is None:
        return {}
    bio_raw = getattr(sample, "extrapolated_biomass_kg", None)
    if bio_raw is None:
        return {}
    bio = _d(bio_raw)
    if bio <= 0:
        return {}
    try:
        fish_n = int(getattr(sample, "stock_reference_fish_count", None) or 0)
    except (TypeError, ValueError):
        fish_n = 0
    if fish_n <= 0:
        return {}
    wa_dec = getattr(pond_obj, "water_area_decimal", None)
    depth_ft = getattr(pond_obj, "pond_depth_ft", None)
    from api.services.aquaculture_units import compute_water_volume_cu_ft

    vol = compute_water_volume_cu_ft(wa_dec, depth_ft)
    role = getattr(pond_obj, "pond_role", None) or "grow_out"
    pcs: Decimal | None = None
    sfc = getattr(sample, "estimated_fish_count", None)
    stw = getattr(sample, "estimated_total_weight_kg", None)
    if sfc and stw:
        try:
            tw = _d(stw)
            fc = int(sfc)
            if fc > 0 and tw > 0:
                pcs = (Decimal(fc) / tw).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        except (TypeError, ValueError):
            pass
    return compute_biomass_load_advice_dict(
        biomass_kg=bio,
        fish_count=fish_n,
        water_area_decimal=wa_dec,
        pond_role=role,
        water_volume_cu_ft=vol,
        fish_per_kg=pcs,
        lang=company_language(getattr(pond_obj, "company_id", None)),
    )


def enrich_position_row_with_fish_metrics(row: dict, *, water_area_decimal, lang: str | None = "en") -> dict:
    """Add current pcs/kg and partial-harvest suggestion fields to a stock position dict."""
    lang_n = normalize_lang(lang)
    pcs, pcs_src_key = current_fish_per_kg_from_position_row(row)
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

    vol_raw = row.get("water_volume_cu_ft")
    vol = _d(vol_raw) if vol_raw not in (None, "") else None
    # Density / load badges must use estimated biomass, not fry-book kg (often negative on nursing).
    load_advice = compute_biomass_load_advice_dict(
        biomass_kg=bio if bio > 0 else Decimal("0"),
        fish_count=max(fish_n, 0),
        water_area_decimal=water_area_decimal,
        pond_role=row.get("pond_role"),
        water_volume_cu_ft=vol,
        fish_per_kg=pcs,
        lang=lang_n,
    )

    out = {**row}
    out["current_fish_per_kg"] = str(pcs) if pcs is not None else None
    out["current_fish_per_kg_source"] = fish_per_kg_source(pcs_src_key, lang_n) if pcs_src_key else None
    out["current_avg_weight_kg"] = avg_kg
    out["effective_net_weight_kg"] = str(bio)
    out["book_net_weight_kg"] = str(txn_bio)
    for key in (
        "stock_density_kg_per_decimal",
        "stock_density_pcs_per_decimal",
        "stock_density_kg_per_1000_cu_ft",
        "load_level",
        "load_level_label",
        "load_level_kg",
        "load_level_pcs",
        "advice_summary",
        "partial_harvest_applicable",
        "partial_harvest_suggested_kg",
        "partial_harvest_suggested_fish_count",
        "partial_harvest_target_kg_per_decimal",
        "partial_harvest_post_load_kg_per_decimal",
        "partial_harvest_rationale",
        "owner_decision_recommended",
        "owner_decision_summary",
        "owner_action",
        "biomass_kg_for_load",
        "fish_count_for_load",
        "comfort_kg_per_decimal",
        "load_band_kg_light",
        "load_band_kg_comfort",
        "load_band_kg_stress",
        "load_band_pcs_light",
        "load_band_pcs_comfort",
        "load_band_pcs_stress",
    ):
        if key in load_advice:
            out[key] = load_advice[key]
    return out
