"""
Heuristic feeding advisory from pond stock position and recent feed records (management only).

Uses **WorldFish / extension-style** Nile tilapia feeding bands (% body weight / day by mean fish size,
meal frequency, pellet guidance) aligned with commonly cited training-manual tables (~28 °C baseline),
then adjusts for stocking load and optional water temperature. This is rule-based (not a live LLM);
the narrative is written so a future model could replace `_build_narrative` while keeping the snapshot.

Reference hub: https://digitalarchive.worldfishcenter.org/ (WorldFish publications & manuals).
See also FAO Cultured Aquatic Species — *Oreochromis niloticus* for complementary feeding tables.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.utils import timezone as django_timezone

from api.models import AquacultureExpense, AquaculturePond, AquacultureProductionCycle
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_constants import POND_ROLE_LABELS
from api.services.aquaculture_units import format_pond_area_decimal_for_api, format_two_decimal_places_for_api

# Public citation string stored in JSON snapshots for auditors.
WORLDFISH_FEEDING_REFERENCE = (
    "WorldFish / CGIAR extension guidance for Nile tilapia grow-out: feeding rate as % of body weight "
    "per day depends on mean fish weight and water temperature (tables often quoted at ~28 °C); "
    "reduce rations when cold, cloudy, or when water quality is stressed. "
    "Source collection: https://digitalarchive.worldfishcenter.org/"
)


def _d(val) -> Decimal:
    if val is None:
        return Decimal("0")
    return Decimal(str(val))


@dataclass(frozen=True)
class _WorldFishSizeBand:
    label: str
    min_g: Decimal
    max_g: Decimal | None  # None = no upper cap
    bw_high_pct: Decimal  # % body weight / day — upper end of published range
    bw_low_pct: Decimal  # lower end
    meals_hint: str
    feed_form_hint: str


# Bands synthesised from widely reproduced WorldFish / FAO tilapia pond-culture tables (mean weight, ~28 °C).
_WORLDFISH_BANDS: tuple[_WorldFishSizeBand, ...] = (
    _WorldFishSizeBand("Fry", Decimal("1"), Decimal("5"), Decimal("10"), Decimal("6"), "4× / day", "Powder / crumble 0.5–1 mm"),
    _WorldFishSizeBand("Fingerling", Decimal("5"), Decimal("20"), Decimal("6"), Decimal("4"), "3–4× / day", "Crumbles 1–2 mm"),
    _WorldFishSizeBand("Juvenile", Decimal("20"), Decimal("100"), Decimal("4"), Decimal("3"), "2× / day", "Small pellet 2 mm"),
    _WorldFishSizeBand("Grower", Decimal("100"), Decimal("250"), Decimal("3"), Decimal("2"), "1.5–2× / day", "Floating pellet 3–4 mm"),
    _WorldFishSizeBand("Finisher", Decimal("250"), None, Decimal("2"), Decimal("1.5"), "1–1.5× / day", "Finisher pellet 4–6 mm"),
)


def _band_for_mean_weight_g(mean_g: Decimal) -> _WorldFishSizeBand:
    g = mean_g if mean_g > 0 else Decimal("0")
    if g < Decimal("1"):
        # Nursery / very small fry — high %BW in manuals; managers usually use on-farm fry protocols.
        return _WorldFishSizeBand("Fry (nursery)", Decimal("0"), Decimal("1"), Decimal("20"), Decimal("10"), "6–8× / day", "Starter powder / fine crumble")
    for b in _WORLDFISH_BANDS:
        cap = b.max_g
        if cap is None:
            if g >= b.min_g:
                return b
        elif b.min_g <= g < cap:
            return b
    return _WORLDFISH_BANDS[-1]


def _mean_fish_weight_g_from_stock_row(stock_row: dict) -> tuple[Decimal | None, str]:
    """
    Returns (mean_weight_g, provenance) for tilapia cohort; None if unknown.
    """
    samp = stock_row.get("latest_sample_avg_weight_kg")
    if samp is not None and samp != "":
        try:
            kg = _d(samp)
            if kg > 0:
                return (kg * Decimal("1000")).quantize(Decimal("0.01")), "latest biomass sample (avg weight)"
        except Exception:
            pass
    bio = _d(stock_row.get("implied_net_weight_kg"))
    cnt = stock_row.get("implied_net_fish_count")
    try:
        n = int(cnt) if cnt is not None else 0
    except (TypeError, ValueError):
        n = 0
    if bio > 0 and n > 0:
        kg_each = bio / Decimal(n)
        return (kg_each * Decimal("1000")).quantize(Decimal("0.01")), "implied net biomass ÷ fish count"
    return None, ""


def _select_biomass_for_feeding_kg(stock_row: dict) -> tuple[Decimal, str]:
    """
    Pick the most reliable biomass to scale daily feed kg, mirroring how mean weight is chosen.

    Order of preference:
    1. Latest biomass sample's `estimated_total_weight_kg` (manager observation; reflects current growth).
    2. `implied_net_weight_kg` from transfers/sales/ledger when positive.
    3. `latest_sample_avg_weight_kg × max(implied_net_fish_count, latest_sample_estimated_fish_count)`
       — recover when transactions show a net negative (e.g., ledger entries lacking a cycle tag).

    Returns (kg, source_label). Empty source label when no usable biomass.
    """
    samp_total = stock_row.get("latest_sample_estimated_total_weight_kg")
    if samp_total is not None and str(samp_total).strip() != "":
        try:
            v = _d(samp_total)
            if v > 0:
                return (
                    v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    "latest biomass sample (manager-recorded total kg)",
                )
        except Exception:
            pass

    implied_kg = _d(stock_row.get("implied_net_weight_kg"))
    if implied_kg > 0:
        return (
            implied_kg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "implied net biomass from transfers / sales / ledger",
        )

    avg_kg_raw = stock_row.get("latest_sample_avg_weight_kg")
    avg_kg = Decimal("0")
    if avg_kg_raw is not None and str(avg_kg_raw).strip() != "":
        try:
            avg_kg = _d(avg_kg_raw)
        except Exception:
            avg_kg = Decimal("0")
    if avg_kg > 0:
        try:
            implied_n = int(stock_row.get("implied_net_fish_count") or 0)
        except (TypeError, ValueError):
            implied_n = 0
        try:
            samp_n = int(stock_row.get("latest_sample_estimated_fish_count") or 0)
        except (TypeError, ValueError):
            samp_n = 0
        n = max(implied_n, samp_n)
        if n > 0:
            est = (avg_kg * Decimal(n)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if est > 0:
                return est, "sampled mean weight × fish count (transactions inconsistent)"

    return Decimal("0"), ""


def _temp_factor(water_temp_c: Decimal | None) -> tuple[Decimal, str]:
    """Simple extension-style appetite scalar vs ~28 °C optimum."""
    if water_temp_c is None:
        return Decimal("1"), "temperature not provided — assuming favourable grow-out conditions (~26–30 °C)"
    t = water_temp_c
    if t < Decimal("18"):
        return Decimal("0.45"), f"cool water ({t} °C) — strong ration cut; verify fish are feeding"
    if t < Decimal("22"):
        return Decimal("0.65"), f"sub-optimal temperature ({t} °C) — reduce ration"
    if t < Decimal("26"):
        return Decimal("0.85"), f"moderate temperature ({t} °C) — slight reduction vs peak appetite"
    if t <= Decimal("30"):
        return Decimal("1.0"), f"near-optimal band ({t} °C) — tables align with ~28 °C references"
    if t <= Decimal("32"):
        return Decimal("0.9"), f"warm ({t} °C) — watch DO; avoid over-feeding"
    return Decimal("0.75"), f"hot ({t} °C) — heat stress risk; feed conservatively"


def _load_bias(load_level: str | None) -> Decimal:
    """Shift chosen %BW toward conservative end when pond is crowded."""
    lv = (load_level or "unknown").strip()
    if lv == "high_risk":
        return Decimal("-0.25")
    if lv == "full":
        return Decimal("-0.15")
    if lv == "moderate":
        return Decimal("0")
    if lv == "understocked":
        return Decimal("0.1")
    return Decimal("-0.05")


def worldfish_daily_bw_percent(
    stock_row: dict,
    *,
    water_temp_c: Decimal | None,
) -> dict:
    """
    Picks a single % body weight / day from WorldFish-style bands + load + temperature guards.
    """
    mean_g, prov = _mean_fish_weight_g_from_stock_row(stock_row)
    load_level = stock_row.get("load_level") if isinstance(stock_row.get("load_level"), str) else None
    tf, temp_note = _temp_factor(water_temp_c)

    if mean_g is None:
        pct = _rate_pct_for_load(load_level)
        return {
            "method": "load_heuristic_only",
            "mean_fish_weight_g": None,
            "mean_weight_source": prov,
            "worldfish_stage": None,
            "bw_pct_low": None,
            "bw_pct_high": None,
            "chosen_bw_pct_per_day": str(pct),
            "meals_hint": "2–3× / day if fish actively eat; align with farm SOP",
            "feed_form_hint": "Match pellet size to mouth gape",
            "temperature_factor": str(tf),
            "temperature_note": temp_note,
            "reference": WORLDFISH_FEEDING_REFERENCE,
        }

    band = _band_for_mean_weight_g(mean_g)
    mid = (band.bw_high_pct + band.bw_low_pct) / Decimal("2")
    biased = mid + _load_bias(load_level)
    # Stay within published band, expanded slightly for understocked ponds.
    lo = min(band.bw_low_pct, band.bw_high_pct)
    hi = max(band.bw_low_pct, band.bw_high_pct)
    biased = max(lo, min(hi, biased))
    after_temp = (biased * tf).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    after_temp = max(Decimal("0.5"), after_temp)

    return {
        "method": "worldfish_table_adjusted",
        "mean_fish_weight_g": str(mean_g),
        "mean_weight_source": prov,
        "worldfish_stage": band.label,
        "bw_pct_low": str(band.bw_low_pct),
        "bw_pct_high": str(band.bw_high_pct),
        "chosen_bw_pct_per_day": str(after_temp),
        "meals_hint": band.meals_hint,
        "feed_form_hint": band.feed_form_hint,
        "temperature_factor": str(tf),
        "temperature_note": temp_note,
        "reference": WORLDFISH_FEEDING_REFERENCE,
    }


def _rate_pct_for_load(load_level: str | None) -> Decimal:
    lv = (load_level or "unknown").strip()
    # Fallback body-weight % per day when mean fish size is unknown.
    if lv == "understocked":
        return Decimal("3.0")
    if lv == "moderate":
        return Decimal("3.0")
    if lv == "full":
        return Decimal("2.5")
    if lv == "high_risk":
        return Decimal("2.0")
    return Decimal("2.5")


def _weather_tier_from_temp(water_temp_c: Decimal | None) -> tuple[str, str]:
    """Returns (tier_key, short_label) — tier drives clock windows and frequency hints."""
    if water_temp_c is None:
        return ("unknown", "Weather (water): not recorded — enter °C when generating advice")
    wt = water_temp_c
    if wt < Decimal("18"):
        return ("very_cold", f"Weather (water): very cold (~{wt} °C) — strong appetite reduction")
    if wt < Decimal("20"):
        return ("cold", f"Weather (water): cold (~{wt} °C) — low appetite")
    if wt < Decimal("24"):
        return ("cool", f"Weather (water): cool (~{wt} °C) — moderate appetite")
    if wt <= Decimal("28"):
        return ("optimal", f"Weather (water): favourable (~{wt} °C) — good feeding window")
    if wt <= Decimal("31"):
        return ("warm", f"Weather (water): warm (~{wt} °C) — watch DO; avoid harsh mid-day")
    return ("very_hot", f"Weather (water): hot (~{wt} °C) — feed only in coolest hours")


def _infer_meals_per_day(times_line: str, base_meals: str) -> int:
    """Rough meal count for splitting kg and clock hints (2–4)."""
    tl = (times_line or "").lower()
    bm = (base_meals or "").lower()
    if "1–2×" in times_line or "1-2x" in tl:
        return 2
    if "2× / day" in times_line or tl.startswith("2×") or "2x / day" in tl:
        return 2
    if "4×" in base_meals or "4x" in bm or "6–8×" in base_meals:
        return 4
    if "3–4×" in base_meals or "3-4x" in bm:
        return 4
    if "2–3×" in base_meals or "2-3x" in bm:
        return 3
    return 2


def _feeding_clock_windows(weather_tier: str, meals_n: int) -> list[str]:
    """
    Illustrative local clock windows (farm adjusts to sunrise and cloud cover).
    Hot/cold tiers bias away from mid-day surface heating or toward warmest water.
    """
    if meals_n <= 1:
        return [
            "**One feed:** offer a **small ration** when fish are most active — often **~10:00 a.m.–12:30 p.m.** "
            "after water has warmed slightly (cold weather), or your usual active period."
        ]
    if weather_tier in ("very_hot", "warm"):
        if meals_n == 2:
            return [
                "**Meal 1:** **~6:00–7:45 a.m.** (finish before strong sun / peak surface heat).",
                "**Meal 2:** **~5:00–6:45 p.m.** (cooler air; **avoid 11:00 a.m.–3:00 p.m.**).",
            ]
        if meals_n == 3:
            return [
                "**Meal 1:** **~6:30–7:30 a.m.**",
                "**Meal 2:** **~9:30–10:30 a.m.** (light; skip if mid-day will be hot).",
                "**Meal 3:** **~5:00–6:00 p.m.**",
            ]
        return [
            "**Hot weather:** keep all feeds in **early morning** and **late afternoon**; "
            "**never** the hottest mid-day hours.",
            "**Meal spread:** ~6:00–7:30 a.m., ~9:30–10:15 a.m. (small), ~5:00–6:15 p.m., final light top-up ~6:30 p.m. if band calls for 4×.",
        ]
    if weather_tier in ("very_cold", "cold"):
        if meals_n == 2:
            return [
                "**Meal 1:** **~10:00–11:30 a.m.** (water warming; small portion).",
                "**Meal 2:** **~2:30–4:00 p.m.** only if fish actively eat; otherwise skip.",
            ]
        return [
            "**Very cold / cold weather:** short active window — **~10:00 a.m.–3:00 p.m.** split into **small** feeds; "
            "no dawn/dusk requirement.",
        ]
    if weather_tier == "cool":
        if meals_n == 2:
            return ["**Meal 1:** **~8:30–10:00 a.m.**", "**Meal 2:** **~3:00–4:30 p.m.**"]
        if meals_n >= 3:
            return [
                "**Meal 1:** **~8:00–9:00 a.m.**",
                "**Meal 2:** **~11:30 a.m.–12:30 p.m.** (moderate).",
                "**Meal 3:** **~4:00–5:00 p.m.**",
            ]
    # optimal / unknown — standard grow-out spacing
    if meals_n == 2:
        return ["**Meal 1:** **~8:00–9:30 a.m.**", "**Meal 2:** **~4:00–5:30 p.m.**"]
    if meals_n == 3:
        return [
            "**Meal 1:** **~7:30–8:30 a.m.**",
            "**Meal 2:** **~12:00–1:00 p.m.**",
            "**Meal 3:** **~4:30–5:30 p.m.**",
        ]
    return [
        "**Meal 1:** **~7:00–7:45 a.m.**",
        "**Meal 2:** **~10:30–11:15 a.m.**",
        "**Meal 3:** **~2:00–2:45 p.m.** (small).",
        "**Meal 4:** **~5:15–6:00 p.m.**",
    ]


def feeding_schedule_recommendation(
    stock_row: dict,
    worldfish: dict,
    water_temp_c: Decimal | None,
    *,
    suggested_daily_feed_kg: Decimal | None = None,
    body_weight_percent_per_day: Decimal | None = None,
) -> dict:
    """
    How much feed (kg), how often, and clock windows — from water temperature (weather proxy),
    pond stocking, fish stage, and biomass outlook.
    """
    base_meals = (worldfish.get("meals_hint") or "2–3× / day").strip()
    load_level = (stock_row.get("load_level") or "unknown").strip()
    load_lbl = (stock_row.get("load_level_label") or "").strip()
    stage = worldfish.get("worldfish_stage")
    mean_g = worldfish.get("mean_fish_weight_g")
    temp_note = (worldfish.get("temperature_note") or "").strip()
    advice_summary = (stock_row.get("advice_summary") or "").strip()
    samp_date = stock_row.get("latest_sample_date")

    weather_tier, weather_label = _weather_tier_from_temp(water_temp_c)

    times_line = base_meals
    bullets: list[str] = []

    # Weather / water temperature → meal frequency & timing
    if water_temp_c is not None:
        wt = water_temp_c
        if wt < Decimal("20"):
            times_line = "1–2× / day (small meals; cool water)"
            bullets.append(
                f"**Weather / water ~{wt} °C (cool):** low appetite — **smaller daily amount**; feed only what fish finish in ~15 minutes."
            )
        elif wt < Decimal("24"):
            times_line = "2× / day (moderate portions)"
            bullets.append(
                f"**Weather / water ~{wt} °C:** sub-optimal warmth — **moderate total ration** in two feeds; skip extra meals if uptake is poor."
            )
        elif wt > Decimal("31"):
            times_line = "2× / day (early morning + late afternoon)"
            bullets.append(
                f"**Weather / water ~{wt} °C (hot):** **reduce risk of over-feeding in heat** — avoid mid-day; use cooler periods only."
            )
        elif wt > Decimal("28"):
            times_line = f"{base_meals} (bias to morning/evening if mid-day is harsh)"
            bullets.append(
                f"**Weather / water ~{wt} °C (warm):** keep **total kg** from the ration table but **shift times** away from peak heat."
            )
        else:
            times_line = base_meals
            bullets.append(
                f"**Weather / water ~{wt} °C:** favourable — use **full suggested kg** if fish clean up; {temp_note}".strip()
            )
    else:
        bullets.append(
            "**Weather:** water °C **not entered** — **amount** still uses biomass × %BW; **times/frequency** follow extension tables only. "
            "Re-generate with temperature for hot/cold-adjusted **feeding times**."
        )
        if temp_note:
            bullets.append(temp_note)

    # Pond stocking / carrying capacity
    if load_level == "high_risk":
        bullets.append(
            f"**Pond status ({load_lbl or 'high-risk load'}):** very full — **several smaller feeds** "
            "beat one large dump; pause if fish gulp at surface or feed is left over."
        )
    elif load_level == "full":
        bullets.append(
            f"**Pond status ({load_lbl or 'full load'}):** split the daily ration; watch dissolved oxygen after feeding."
        )
    elif load_level == "understocked":
        bullets.append(
            "**Pond status (lighter biomass):** standard meal pattern is fine — avoid over-feeding unused ration."
        )
    elif load_lbl:
        bullets.append(f"**Pond status:** {load_lbl}.")

    # Fish condition / life stage (from mean weight band)
    if stage and mean_g is not None:
        bullets.append(
            f"**Fish condition:** **{stage}** stage, mean ~**{mean_g}** g — guides suggest **{base_meals}** under good water."
        )
    else:
        bullets.append(
            "**Fish condition / size:** mean weight not well known — use **2× / day** conservatively until sampling improves."
        )

    if samp_date:
        bullets.append(
            f"**Biomass records:** latest sample date **{samp_date}** on file — re-sample if weather or growth changed sharply."
        )

    if advice_summary:
        bullets.append(f"**Stock outlook (system summary):** {advice_summary}")

    meals_n = _infer_meals_per_day(times_line, base_meals)
    if weather_tier in ("very_cold", "cold") and meals_n > 2:
        meals_n = 2
    if weather_tier in ("very_hot", "warm") and meals_n > 3:
        meals_n = 3

    clock_windows = _feeding_clock_windows(weather_tier, meals_n)

    daily_kg_str: str | None = None
    per_meal_kg: list[str] = []
    per_meal_summary: str | None = None
    if suggested_daily_feed_kg is not None and suggested_daily_feed_kg > 0:
        daily_kg_str = str(suggested_daily_feed_kg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        each = (suggested_daily_feed_kg / Decimal(meals_n)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        per_meal_kg = [str(each) for _ in range(meals_n)]
        per_meal_summary = (
            f"~{each} kg × **{meals_n}** meals (equal split for planning; reduce last meal if feed remains)."
        )

    return {
        "weather_tier": weather_tier,
        "weather_condition_label": weather_label,
        "times_per_day": times_line,
        "frequency_meals_per_day": meals_n,
        "extension_table_meals_hint": base_meals,
        "daily_feed_amount_kg": daily_kg_str,
        "per_meal_feed_kg_approx": per_meal_kg,
        "per_meal_amount_summary": per_meal_summary,
        "recommended_feeding_times": clock_windows,
        "factors": {
            "water_temp_c": str(water_temp_c) if water_temp_c is not None else None,
            "pond_load_level": load_level,
            "pond_load_label": load_lbl or None,
            "fish_stage": str(stage) if stage else None,
            "mean_fish_weight_g": str(mean_g) if mean_g is not None else None,
        },
        "rationale_bullets": bullets,
    }


def recent_direct_feed_kg_sum(
    company_id: int,
    pond_id: int,
    *,
    end_date: date,
    days: int = 7,
) -> Decimal:
    """Sum feed_weight_kg on direct pond expenses (purchases + pond-warehouse consumption) in an inclusive window."""
    if days < 1:
        days = 1
    start = end_date - timedelta(days=days - 1)
    agg = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            expense_category__in=["feed_purchase", "feed_consumed"],
            expense_date__gte=start,
            expense_date__lte=end_date,
        ).aggregate(total=Sum("feed_weight_kg"))
    )
    raw = agg.get("total")
    return _d(raw) if raw is not None else Decimal("0")


def _json_safe_stock_row(row: dict) -> dict:
    """Subset of stock position row for JSON snapshot (strings for decimals)."""
    keys = (
        "pond_role",
        "water_area_decimal",
        "pond_depth_ft",
        "water_volume_cu_ft",
        "implied_net_weight_kg",
        "implied_net_fish_count",
        "latest_sample_date",
        "latest_sample_estimated_fish_count",
        "latest_sample_estimated_total_weight_kg",
        "latest_sample_avg_weight_kg",
        "latest_sample_fish_species_label",
        "stock_density_kg_per_decimal",
        "stock_density_kg_per_1000_cu_ft",
        "load_level",
        "load_level_label",
        "advice_summary",
        "reference_note",
        "production_cycle_id",
    )
    out: dict = {}
    for k in keys:
        if k not in row:
            continue
        v = row[k]
        if v is None:
            out[k] = None
        elif isinstance(v, (str, int, bool)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def _build_narrative(
    *,
    pond: AquaculturePond,
    target_date: date,
    cycle: AquacultureProductionCycle | None,
    stock_row: dict,
    suggested_kg: Decimal | None,
    rate_pct: Decimal,
    recent_feed_kg: Decimal,
    worldfish: dict,
    feeding_schedule: dict | None = None,
    biomass_basis_kg: Decimal | None = None,
    biomass_basis_source: str = "",
) -> str:
    pname = (pond.name or "").strip() or f"Pond #{pond.id}"
    role_lbl = POND_ROLE_LABELS.get(getattr(pond, "pond_role", None) or "grow_out", "Grow-out")
    bio = _d(stock_row.get("implied_net_weight_kg"))
    load_lbl = stock_row.get("load_level_label") or "Unknown"
    density = stock_row.get("stock_density_kg_per_decimal")
    samp_date = stock_row.get("latest_sample_date") or "—"
    species = stock_row.get("latest_sample_fish_species_label") or "tilapia"

    paras: list[str] = []
    paras.append(
        f"**{pname}** ({role_lbl}) — suggested feeding focus for **{target_date.isoformat()}**."
        + (f" Production cycle: **{cycle.name}**." if cycle else "")
    )
    paras.append(
        "**Pond status (from records):** "
        f"estimated biomass ≈ **{bio} kg**; load **{load_lbl}**"
        + (f" (~{density} kg/dec water)" if density else "")
        + f"; latest biomass sample date **{samp_date}** ({species})."
    )
    paras.append(f"**Stocking hint:** {stock_row.get('advice_summary') or '—'}")

    wf_stage = worldfish.get("worldfish_stage")
    mean_g = worldfish.get("mean_fish_weight_g")
    msrc = worldfish.get("mean_weight_source") or ""
    meals = worldfish.get("meals_hint") or ""
    form_hint = worldfish.get("feed_form_hint") or ""
    temp_note = worldfish.get("temperature_note") or ""
    if wf_stage:
        paras.append(
            "**WorldFish-style tilapia guide (Nile tilapia, semi-intensive pond):** "
            f"mean fish ≈ **{mean_g} g** ({msrc}) → **{wf_stage}** stage; "
            f"published tables suggest roughly **{worldfish.get('bw_pct_low')}%–{worldfish.get('bw_pct_high')}%** "
            "of body weight per day at favourable temperature, adjusted here for **stocking load** and **water temperature**. "
            f"**Meals:** {meals}. **Feed type:** {form_hint}. "
            f"_{temp_note}_"
        )
    else:
        paras.append(
            "**WorldFish-style tilapia guide:** mean fish weight is **unknown** — update **sampling** or ensure **fish count** "
            "with biomass so the system can pick fry / fingerling / grower bands from extension tables. "
            f"For now, daily rate uses **stocking load** only (~**{rate_pct}%** BW/day baseline). "
            f"_{temp_note}_"
        )

    if feeding_schedule:
        tp = (feeding_schedule.get("times_per_day") or "").strip()
        if tp:
            paras.append(
                "**How often to feed (today):** "
                f"**{tp}** — considers **weather (water °C)**, pond stocking/load, fish stage/size, and biomass outlook "
                "(clock windows and kg split are in `feeding_schedule`)."
            )
            amt = feeding_schedule.get("daily_feed_amount_kg")
            if amt:
                paras.append(
                    f"**Target feed amount for the day:** **{amt} kg** total — split across the recommended meals/times "
                    "(see `per_meal_feed_kg_approx` and `recommended_feeding_times`)."
                )

    if recent_feed_kg > 0:
        paras.append(
            f"**Recent feed (7d, direct feed expenses):** about **{recent_feed_kg} kg** recorded on this pond — "
            "use this only as context; POS-on-account feed may not appear here."
        )
    else:
        paras.append(
            "**Recent feed (7d):** no direct **feed purchase** kg recorded on this pond — if you feed via POS on account, "
            "rely on your shop records too."
        )

    if suggested_kg is not None and suggested_kg > 0:
        basis_clause = ""
        if biomass_basis_kg is not None and biomass_basis_kg > 0 and biomass_basis_source:
            basis_clause = (
                f" Biomass basis: **~{biomass_basis_kg} kg** ({biomass_basis_source})."
            )
        paras.append(
            f"**Suggested ration (editable):** about **{suggested_kg} kg** total for the day "
            f"(≈ **{rate_pct}%** of estimated biomass per day; **{meals}** where practical)."
            f"{basis_clause} "
            "Stop feeding if feed remains after ~15 minutes (avoid water quality stress). "
            "**Edit** the narrative or kg below, then **approve**."
        )
    else:
        paras.append(
            "**Suggested ration:** could not estimate kg (no positive biomass from transactions or biomass samples). "
            "Add a **biomass sample** (estimated total fish count and total kg) for this pond / cycle, "
            "or enter your own kg target, then approve."
        )

    paras.append(
        "_Source: WorldFish / CGIAR extension tables for tilapia (see snapshot `worldfish` block). "
        "This is generated from FSERP pond metrics — not a live external AI. "
        "Managers must confirm with field conditions before feeding._"
    )
    return "\n\n".join(paras)


def build_feeding_advice_payload(
    company_id: int,
    pond_id: int,
    target_date: date,
    production_cycle_id: int | None = None,
    *,
    water_temp_c: Decimal | None = None,
) -> tuple[dict | None, str | None]:
    """
    Returns dict with keys: ai_advice_text, suggested_feed_kg (Decimal|None), pond_status_snapshot (dict).
    On error returns (None, message).
    """
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return None, "Pond not found"

    cycle: AquacultureProductionCycle | None = None
    if production_cycle_id is not None:
        cycle = AquacultureProductionCycle.objects.filter(
            pk=production_cycle_id, company_id=company_id, pond_id=pond_id
        ).first()
        if not cycle:
            return None, "Production cycle not found for this pond"

    rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        fish_species_filter="tilapia",
        include_inactive_ponds=True,
    )
    if not rows:
        return None, "Could not compute stock position"
    stock_row = rows[0]

    biomass, biomass_basis_source = _select_biomass_for_feeding_kg(stock_row)
    worldfish = worldfish_daily_bw_percent(stock_row, water_temp_c=water_temp_c)
    rate_pct = _d(worldfish.get("chosen_bw_pct_per_day"))

    suggested: Decimal | None = None
    if biomass > 0:
        suggested = (biomass * rate_pct / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    recent = recent_direct_feed_kg_sum(company_id, pond_id, end_date=target_date, days=7)

    schedule = feeding_schedule_recommendation(
        stock_row,
        worldfish,
        water_temp_c,
        suggested_daily_feed_kg=suggested,
        body_weight_percent_per_day=rate_pct,
    )

    now = django_timezone.now()
    snapshot = {
        "generated_at": now.isoformat(),
        "target_date": target_date.isoformat(),
        "pond": {
            "id": pond.id,
            "name": (pond.name or "").strip(),
            "pond_role": getattr(pond, "pond_role", None) or "grow_out",
            "water_area_decimal": format_pond_area_decimal_for_api(pond.water_area_decimal),
            "pond_depth_ft": format_two_decimal_places_for_api(getattr(pond, "pond_depth_ft", None)),
        },
        "production_cycle": (
            {"id": cycle.id, "name": (cycle.name or "").strip(), "code": (cycle.code or "").strip()}
            if cycle
            else None
        ),
        "water_temp_c": str(water_temp_c) if water_temp_c is not None else None,
        "worldfish": worldfish,
        "feeding_heuristic": {
            "body_weight_percent_per_day": str(rate_pct),
            "recent_direct_feed_kg_7d": str(recent),
            "biomass_basis_kg": str(biomass) if biomass > 0 else None,
            "biomass_basis_source": biomass_basis_source or None,
            "model_note": "WorldFish-style tilapia bands + load/temperature guards; optional LLM hook later.",
        },
        "feeding_schedule": schedule,
        "stock_position": _json_safe_stock_row(stock_row),
    }

    text = _build_narrative(
        pond=pond,
        target_date=target_date,
        cycle=cycle,
        stock_row=stock_row,
        suggested_kg=suggested,
        rate_pct=rate_pct,
        recent_feed_kg=recent,
        worldfish=worldfish,
        feeding_schedule=schedule,
        biomass_basis_kg=biomass if biomass > 0 else None,
        biomass_basis_source=biomass_basis_source,
    )

    return {
        "ai_advice_text": text,
        "suggested_feed_kg": suggested,
        "pond_status_snapshot": snapshot,
    }, None


def effective_advice_text(ai_text: str, edited_text: str) -> str:
    e = (edited_text or "").strip()
    return e if e else (ai_text or "")
