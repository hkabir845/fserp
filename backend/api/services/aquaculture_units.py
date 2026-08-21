"""
Bangladesh land decimals × feet for pond volume; indicative stocking load bands (management hints).

1 Bangladesh decimal of land = 1/100 acre = 435.6 sq ft (same conversion used country-wide for lease math).

Water volume (when banks are vertical-ish): water_surface_decimals × sq_ft_per_decimal × average_depth_ft → cubic feet.

Load metrics (extension-style, not regulatory law):
  kg/dec  = biomass_kg ÷ water_area_decimal
  pcs/dec = fish_count ÷ water_area_decimal
Bands synthesised from BD DoF / WorldFish-style grow-out practice and recent non-aerated
semi-intensive trials (~150–230 pcs/dec comfort; ~8–12 t/ha ≈ 32–48 kg/dec near harvest).
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.services.aquaculture_constants import POND_ROLE_CODES
from api.services.aquaculture_i18n import (
    load_advice_summary,
    load_reference_note,
    load_set_water_area_summary,
    load_unknown_reference_note,
    load_volume_density_extra,
    normalize_lang,
    _pick,
)

# 1 decimal = 435.6 sq ft (1 acre = 43,560 sq ft; 1 decimal = 1/100 acre).
SQ_FT_PER_BANGLADESH_DECIMAL = Decimal("435.6")

_M_PER_FT = Decimal("0.3048")


def metres_to_feet(m: Decimal) -> Decimal:
    """Convert metres to feet (for legacy API keys)."""
    return (m / _M_PER_FT).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


from api.utils.measured_quantity import (
    format_measured_quantity_for_api as format_two_decimal_places_for_api,
    quantize_measured_quantity as quantize_two_decimal_places,
)


def quantize_pond_area_decimal(d: Decimal | None) -> Decimal | None:
    """Round leased / water surface area (Bangladesh decimals) to 2 fractional digits (half-up)."""
    return quantize_two_decimal_places(d)


def format_pond_area_decimal_for_api(d: Decimal | None) -> str | None:
    """Stable JSON string for pond area fields (always two digits after the decimal point)."""
    return format_two_decimal_places_for_api(d)


def compute_water_surface_sq_ft(water_area_decimal: Decimal | None) -> Decimal | None:
    if water_area_decimal is None or water_area_decimal <= 0:
        return None
    return (water_area_decimal * SQ_FT_PER_BANGLADESH_DECIMAL).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compute_water_volume_cu_ft(
    water_area_decimal: Decimal | None,
    depth_ft: Decimal | None,
) -> Decimal | None:
    """Returns cubic feet when both inputs are positive; else None."""
    if water_area_decimal is None or depth_ft is None:
        return None
    if water_area_decimal <= 0 or depth_ft <= 0:
        return None
    vol = water_area_decimal * SQ_FT_PER_BANGLADESH_DECIMAL * depth_ft
    return vol.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# kg biomass / decimal water surface — grow-out ≈ 8–12 t/ha harvest (≈32–48 kg/dec).
_GROW_LIGHT = Decimal("15")
_GROW_COMFORT = Decimal("40")
_GROW_STRESS = Decimal("55")
# Above this kg/dec on grow-out, water area is often entered in acres (or missing a zero).
_GROW_AREA_UNIT_WARN_KG_DEC = Decimal("80")

# Standing fish / decimal — BD semi-intensive mono-sex tilapia (non-aerated ~150–230 comfort).
_GROW_PCS_LIGHT = Decimal("150")
_GROW_PCS_COMFORT = Decimal("230")
_GROW_PCS_STRESS = Decimal("300")

# (kg_light, kg_comfort, kg_stress, pcs_light, pcs_comfort, pcs_stress)
_ROLE_BANDS: dict[str, tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]] = {
    "grow_out": (
        _GROW_LIGHT,
        _GROW_COMFORT,
        _GROW_STRESS,
        _GROW_PCS_LIGHT,
        _GROW_PCS_COMFORT,
        _GROW_PCS_STRESS,
    ),
    "nursing": (
        Decimal("6"),
        Decimal("18"),
        Decimal("30"),
        Decimal("800"),
        Decimal("2000"),
        Decimal("3500"),
    ),
    "broodstock": (
        Decimal("3"),
        Decimal("10"),
        Decimal("20"),
        Decimal("40"),
        Decimal("80"),
        Decimal("120"),
    ),
    "other": (
        _GROW_LIGHT,
        _GROW_COMFORT,
        _GROW_STRESS,
        _GROW_PCS_LIGHT,
        _GROW_PCS_COMFORT,
        _GROW_PCS_STRESS,
    ),
}


def _bands_for_role(role: str | None) -> tuple[Decimal, Decimal, Decimal]:
    """Backward-compatible (kg_light, kg_comfort, kg_stress) for partial-harvest callers."""
    kg_l, kg_c, kg_s, _p_l, _p_c, _p_s = _full_bands_for_role(role)
    return kg_l, kg_c, kg_s


def _full_bands_for_role(
    role: str | None,
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]:
    r = (role or "grow_out").strip()
    if r not in POND_ROLE_CODES:
        r = "grow_out"
    return _ROLE_BANDS.get(r, _ROLE_BANDS["grow_out"])


def _level_from_metric(value: Decimal, light: Decimal, comfort: Decimal, stress: Decimal) -> str:
    if value < light:
        return "understocked"
    if value < comfort:
        return "moderate"
    if value < stress:
        return "full"
    return "high_risk"


_LEVEL_RANK = {"understocked": 0, "moderate": 1, "full": 2, "high_risk": 3, "unknown": -1}


def _worse_level(a: str, b: str) -> str:
    return a if _LEVEL_RANK.get(a, -1) >= _LEVEL_RANK.get(b, -1) else b


def _fmt_density_num(d: Decimal) -> str:
    """Format calculated density for display (keep 2 dp; drop trailing zeros)."""
    s = format(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def load_level_density_label(
    *,
    kg_per_dec: Decimal | None,
    pcs_per_dec: Decimal | None = None,
    lang: str | None = "en",
) -> str:
    """
    Display label for load badges: the calculated densities (not band ranges / word names).
    Example: '30 kg/dec · 200 pcs/dec'
    """
    lang_n = normalize_lang(lang)
    if kg_per_dec is None:
        return _pick(lang_n, "Set water area", "জলের আয়তন দিন")
    parts = [f"{_fmt_density_num(kg_per_dec)} kg/dec"]
    if pcs_per_dec is not None:
        parts.append(f"{_fmt_density_num(pcs_per_dec)} pcs/dec")
    return " · ".join(parts)


def compute_stocking_load_advice(
    biomass_kg: Decimal,
    *,
    water_area_decimal: Decimal | None,
    water_volume_cu_ft: Decimal | None,
    pond_role: str | None,
    lang: str | None = "en",
    fish_count: int | None = None,
) -> dict:
    """
    Density metrics and load band.

    kg/dec = biomass ÷ water decimals; pcs/dec = heads ÷ water decimals.
    ``load_level`` stays understocked|moderate|full|high_risk|unknown for badge colour /
    feeding bias. ``load_level_label`` shows the **exact calculated** kg/dec (and pcs/dec).
    Overall level is the worse of kg and pcs bands when both are known.
    """
    kg_l, kg_c, kg_s, pcs_l, pcs_c, pcs_s = _full_bands_for_role(pond_role)
    bio = biomass_kg if biomass_kg > 0 else Decimal("0")
    lang_n = normalize_lang(lang)
    try:
        heads = int(fish_count) if fish_count is not None else 0
    except (TypeError, ValueError):
        heads = 0
    if heads < 0:
        heads = 0

    kg_per_dec: Decimal | None = None
    pcs_per_dec: Decimal | None = None
    if water_area_decimal is not None and water_area_decimal > 0:
        kg_per_dec = (bio / water_area_decimal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if heads > 0:
            pcs_per_dec = (Decimal(heads) / water_area_decimal).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

    kg_per_kcuft: Decimal | None = None
    if water_volume_cu_ft is not None and water_volume_cu_ft > 0:
        kg_per_kcuft = ((bio / water_volume_cu_ft) * Decimal("1000")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    band_payload = {
        "load_band_kg_light": str(kg_l),
        "load_band_kg_comfort": str(kg_c),
        "load_band_kg_stress": str(kg_s),
        "load_band_pcs_light": str(pcs_l),
        "load_band_pcs_comfort": str(pcs_c),
        "load_band_pcs_stress": str(pcs_s),
    }

    if kg_per_dec is None:
        return {
            "stock_density_kg_per_decimal": None,
            "stock_density_pcs_per_decimal": None,
            "stock_density_kg_per_1000_cu_ft": str(kg_per_kcuft) if kg_per_kcuft is not None else None,
            "load_level": "unknown",
            "load_level_label": load_level_density_label(kg_per_dec=None, lang=lang_n),
            "load_level_kg": "unknown",
            "load_level_pcs": "unknown",
            "advice_summary": load_set_water_area_summary(lang_n),
            "reference_note": load_unknown_reference_note(lang_n),
            "load_area_unit_warning": None,
            **band_payload,
        }

    level_kg = _level_from_metric(kg_per_dec, kg_l, kg_c, kg_s)
    level_pcs = (
        _level_from_metric(pcs_per_dec, pcs_l, pcs_c, pcs_s) if pcs_per_dec is not None else "unknown"
    )
    level = level_kg if level_pcs == "unknown" else _worse_level(level_kg, level_pcs)

    label = load_level_density_label(
        kg_per_dec=kg_per_dec,
        pcs_per_dec=pcs_per_dec,
        lang=lang_n,
    )
    summary = load_advice_summary(level, kg_per_dec, lang_n)
    if pcs_per_dec is not None:
        summary = _pick(
            lang_n,
            f"{summary} Standing {_fmt_density_num(pcs_per_dec)} pcs/dec.",
            f"{summary} বর্তমান {_fmt_density_num(pcs_per_dec)} pcs/ডেসিমেল।",
        )

    area_unit_warning: str | None = None
    role_n = (pond_role or "grow_out").strip() or "grow_out"
    if kg_per_dec >= _GROW_AREA_UNIT_WARN_KG_DEC and role_n in ("grow_out", "other", "broodstock"):
        area_unit_warning = _pick(
            lang_n,
            "kg/dec is unusually high — check water area units (1 acre = 100 Bangladesh decimals). "
            f"Load is biomass ÷ water decimals (currently {_fmt_density_num(kg_per_dec)} kg/dec).",
            "kg/ডেসিমেল অস্বাভাবিক বেশি — জলের আয়তন একরে না দিয়ে ডেসিমেলে দিন (১ একর = ১০০ ডেসিমেল)। "
            f"লোড = বায়োমাস ÷ জলের ডেসিমেল (এখন {_fmt_density_num(kg_per_dec)} kg/ডেসিমেল)।",
        )
        summary = f"{summary} {area_unit_warning}"

    extra = ""
    if kg_per_kcuft is not None:
        extra = load_volume_density_extra(kg_per_kcuft, lang_n)

    return {
        "stock_density_kg_per_decimal": str(kg_per_dec),
        "stock_density_pcs_per_decimal": str(pcs_per_dec) if pcs_per_dec is not None else None,
        "stock_density_kg_per_1000_cu_ft": str(kg_per_kcuft) if kg_per_kcuft is not None else None,
        "load_level": level,
        "load_level_label": label,
        "load_level_kg": level_kg,
        "load_level_pcs": level_pcs,
        "advice_summary": summary + extra,
        "reference_note": load_reference_note(lang_n),
        "load_area_unit_warning": area_unit_warning,
        **band_payload,
    }
