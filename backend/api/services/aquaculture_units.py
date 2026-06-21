"""
Bangladesh land decimals × feet for pond volume; indicative stocking load bands (management hints).

1 Bangladesh decimal of land = 1/100 acre = 435.6 sq ft (same conversion used country-wide for lease math).

Water volume (when banks are vertical-ish): water_surface_decimals × sq_ft_per_decimal × average_depth_ft → cubic feet.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.services.aquaculture_constants import POND_ROLE_CODES
from api.services.aquaculture_i18n import (
    load_advice_summary,
    load_level_label,
    load_reference_note,
    load_set_water_area_summary,
    load_unknown_reference_note,
    load_volume_density_extra,
    normalize_lang,
)

# 1 decimal = 435.6 sq ft (1 acre = 43,560 sq ft; 1 decimal = 1/100 acre).
SQ_FT_PER_BANGLADESH_DECIMAL = Decimal("435.6")

_M_PER_FT = Decimal("0.3048")


def metres_to_feet(m: Decimal) -> Decimal:
    """Convert metres to feet (for legacy API keys)."""
    return (m / _M_PER_FT).quantize(Decimal("0.001"))


def quantize_two_decimal_places(d: Decimal | None) -> Decimal | None:
    """Half-up rounding to 2 fractional digits (pond areas, depth ft, lease price per decimal, etc.)."""
    if d is None:
        return None
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def format_two_decimal_places_for_api(d: Decimal | None) -> str | None:
    """Stable JSON string with exactly two digits after the decimal point."""
    if d is None:
        return None
    q = quantize_two_decimal_places(d)
    return f"{q:.2f}"


def quantize_pond_area_decimal(d: Decimal | None) -> Decimal | None:
    """Round leased / water surface area (Bangladesh decimals) to 2 fractional digits (half-up)."""
    return quantize_two_decimal_places(d)


def format_pond_area_decimal_for_api(d: Decimal | None) -> str | None:
    """Stable JSON string for pond area fields (always two digits after the decimal point)."""
    return format_two_decimal_places_for_api(d)


def compute_water_surface_sq_ft(water_area_decimal: Decimal | None) -> Decimal | None:
    if water_area_decimal is None or water_area_decimal <= 0:
        return None
    return (water_area_decimal * SQ_FT_PER_BANGLADESH_DECIMAL).quantize(Decimal("0.01"))


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


# Indicative kg biomass per decimal of *water surface* for intensive tropical pond culture (management only).
# Grow-out bands align with Bangladesh GIFT monoculture harvest targets (~8–12 t/ha ≈ 32–48 kg/decimal).
# 1 ha ≈ 247 decimals; bands differ slightly by pond_role.
_GROW_LIGHT = Decimal("15")
_GROW_COMFORT = Decimal("40")
_GROW_STRESS = Decimal("55")

_ROLE_BANDS: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "grow_out": (_GROW_LIGHT, _GROW_COMFORT, _GROW_STRESS),
    "nursing": (Decimal("6"), Decimal("18"), Decimal("30")),
    "broodstock": (Decimal("3"), Decimal("10"), Decimal("20")),
    "other": (_GROW_LIGHT, _GROW_COMFORT, _GROW_STRESS),
}


def _bands_for_role(role: str | None) -> tuple[Decimal, Decimal, Decimal]:
    r = (role or "grow_out").strip()
    if r not in POND_ROLE_CODES:
        r = "grow_out"
    return _ROLE_BANDS.get(r, _ROLE_BANDS["grow_out"])


def compute_stocking_load_advice(
    biomass_kg: Decimal,
    *,
    water_area_decimal: Decimal | None,
    water_volume_cu_ft: Decimal | None,
    pond_role: str | None,
    lang: str | None = "en",
) -> dict:
    """
    Returns density metrics and a coarse load_level + short narrative (not a substitute for field advice).

    load_level: understocked | moderate | full | high_risk | unknown
    """
    light, comfort, stress = _bands_for_role(pond_role)
    bio = biomass_kg if biomass_kg > 0 else Decimal("0")
    lang_n = normalize_lang(lang)

    kg_per_dec: Decimal | None = None
    if water_area_decimal is not None and water_area_decimal > 0:
        kg_per_dec = (bio / water_area_decimal).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)

    kg_per_kcuft: Decimal | None = None
    if water_volume_cu_ft is not None and water_volume_cu_ft > 0:
        kg_per_kcuft = ((bio / water_volume_cu_ft) * Decimal("1000")).quantize(
            Decimal("0.001"), rounding=ROUND_HALF_UP
        )

    if kg_per_dec is None:
        return {
            "stock_density_kg_per_decimal": None,
            "stock_density_kg_per_1000_cu_ft": str(kg_per_kcuft) if kg_per_kcuft is not None else None,
            "load_level": "unknown",
            "load_level_label": load_level_label("unknown", lang_n),
            "advice_summary": load_set_water_area_summary(lang_n),
            "reference_note": load_unknown_reference_note(lang_n),
        }

    kpd = kg_per_dec
    if kpd < light:
        level = "understocked"
    elif kpd < comfort:
        level = "moderate"
    elif kpd < stress:
        level = "full"
    else:
        level = "high_risk"

    label = load_level_label(level, lang_n)
    summary = load_advice_summary(level, kpd, lang_n)

    extra = ""
    if kg_per_kcuft is not None:
        extra = load_volume_density_extra(kg_per_kcuft, lang_n)

    return {
        "stock_density_kg_per_decimal": str(kg_per_dec),
        "stock_density_kg_per_1000_cu_ft": str(kg_per_kcuft) if kg_per_kcuft is not None else None,
        "load_level": level,
        "load_level_label": label,
        "advice_summary": summary + extra,
        "reference_note": load_reference_note(lang_n),
    }
