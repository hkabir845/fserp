"""
Fish growth report: sample-to-sample intervals with ADG, period FCR, and pond load.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from api.models import AquacultureBiomassSample, AquaculturePond
from api.services.aquaculture_constants import fish_species_display_label
from api.services.aquaculture_fcr_service import (
    compute_fcr_for_scope,
    fcr_period_summary_block,
    sum_feed_kg_for_period,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _sample_biomass_kg(sample: AquacultureBiomassSample) -> Decimal | None:
    if sample.extrapolated_biomass_kg is not None and sample.extrapolated_biomass_kg > 0:
        return _d(sample.extrapolated_biomass_kg)
    if sample.estimated_total_weight_kg is not None and sample.estimated_total_weight_kg > 0:
        return _d(sample.estimated_total_weight_kg)
    fc = sample.estimated_fish_count
    aw = sample.avg_weight_kg
    if fc and fc > 0 and aw and aw > 0:
        return _d(fc) * _d(aw)
    return None


def _sample_mean_weight_kg(sample: AquacultureBiomassSample) -> Decimal | None:
    if sample.avg_weight_kg is not None and sample.avg_weight_kg > 0:
        return _d(sample.avg_weight_kg)
    fc = sample.estimated_fish_count
    tw = sample.estimated_total_weight_kg
    if fc and fc > 0 and tw and tw > 0:
        return _d(tw) / Decimal(fc)
    return None


def _days_between(start: date, end: date) -> int:
    return max(1, (end - start).days)


def _interval_rows_for_samples(samples: list[AquacultureBiomassSample], company_id: int) -> list[dict[str, Any]]:
    ordered = sorted(samples, key=lambda s: (s.sample_date, s.id))
    rows: list[dict[str, Any]] = []
    for i in range(1, len(ordered)):
        prev = ordered[i - 1]
        cur = ordered[i]
        days = _days_between(prev.sample_date, cur.sample_date)
        prev_mean = _sample_mean_weight_kg(prev)
        cur_mean = _sample_mean_weight_kg(cur)
        prev_bio = _sample_biomass_kg(prev)
        cur_bio = _sample_biomass_kg(cur)

        adg_g: str | None = None
        if prev_mean is not None and cur_mean is not None and prev_mean > 0:
            adg = ((cur_mean - prev_mean) * Decimal("1000")) / Decimal(days)
            adg_g = str(adg.quantize(Decimal("0.01")))

        biomass_gain: str | None = None
        if prev_bio is not None and cur_bio is not None:
            biomass_gain = str(_money_q(cur_bio - prev_bio))

        feed_start = prev.sample_date + timedelta(days=1)
        feed_end = cur.sample_date
        if feed_start > feed_end:
            feed_start = prev.sample_date
        feed_kg = sum_feed_kg_for_period(
            company_id,
            feed_start,
            feed_end,
            pond_id=cur.pond_id,
            production_cycle_id=cur.production_cycle_id,
        )
        interval_fcr: str | None = None
        if biomass_gain is not None and Decimal(biomass_gain) > 0 and feed_kg > 0:
            interval_fcr = str(_money_q(feed_kg / Decimal(biomass_gain)))

        sp = getattr(cur, "fish_species", None) or "tilapia"
        spo = getattr(cur, "fish_species_other", None) or ""
        rows.append(
            {
                "from_sample_id": prev.id,
                "to_sample_id": cur.id,
                "from_date": prev.sample_date.isoformat(),
                "to_date": cur.sample_date.isoformat(),
                "days": days,
                "fish_species": sp,
                "fish_species_label": fish_species_display_label(sp, spo),
                "from_mean_weight_g": str((prev_mean * 1000).quantize(Decimal("0.01"))) if prev_mean else None,
                "to_mean_weight_g": str((cur_mean * 1000).quantize(Decimal("0.01"))) if cur_mean else None,
                "adg_g_per_fish_per_day": adg_g,
                "from_biomass_kg": str(prev_bio) if prev_bio is not None else None,
                "to_biomass_kg": str(cur_bio) if cur_bio is not None else None,
                "biomass_gain_kg": biomass_gain,
                "feed_kg": str(feed_kg) if feed_kg > 0 else "0",
                "interval_fcr": interval_fcr,
            }
        )
    return rows


def build_fish_growth_report(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> dict[str, Any]:
    qs = (
        AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            sample_date__gte=start,
            sample_date__lte=end,
        )
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "sample_date", "id")
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        qs = qs.filter(fish_species=fish_species)

    by_pond: dict[int, list[AquacultureBiomassSample]] = {}
    for s in qs:
        by_pond.setdefault(s.pond_id, []).append(s)

    pond_groups: list[dict[str, Any]] = []
    all_intervals: list[dict[str, Any]] = []

    for pid in sorted(by_pond.keys()):
        samples = by_pond[pid]
        intervals = _interval_rows_for_samples(samples, company_id)
        for row in intervals:
            row["pond_id"] = pid
            row["pond_name"] = (samples[0].pond.name or "").strip() if samples[0].pond_id else ""
        all_intervals.extend(intervals)

        period_fcr = compute_fcr_for_scope(
            company_id,
            start,
            end,
            pond_id=pid,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )

        pond_groups.append(
            {
                "pond_id": pid,
                "pond_name": (samples[0].pond.name or "").strip() if samples[0].pond_id else f"Pond #{pid}",
                "sample_count": len(samples),
                "interval_count": len(intervals),
                "intervals": intervals,
                "period_fcr": period_fcr,
            }
        )

    fcr_block = fcr_period_summary_block(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
    )

    stock_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        include_inactive_ponds=False,
    )
    load_rows = []
    for r in stock_rows:
        load_rows.append(
            {
                "pond_id": r.get("pond_id"),
                "pond_name": r.get("pond_name") or "",
                "water_area_decimal": r.get("water_area_decimal"),
                "implied_net_weight_kg": r.get("implied_net_weight_kg"),
                "implied_net_fish_count": r.get("implied_net_fish_count"),
                "current_fish_per_kg": r.get("current_fish_per_kg"),
                "stock_density_kg_per_decimal": r.get("stock_density_kg_per_decimal"),
                "load_level": r.get("load_level"),
                "load_level_label": r.get("load_level_label"),
            }
        )

    portfolio = fcr_block.get("portfolio") or {}
    return {
        "summary": {
            "sample_count": qs.count(),
            "interval_count": len(all_intervals),
            "pond_count": len(pond_groups),
            "feed_kg": portfolio.get("feed_kg"),
            "biomass_gain_kg": portfolio.get("biomass_gain_kg"),
            "fcr_biomass": portfolio.get("fcr_biomass"),
            "harvest_kg": portfolio.get("harvest_kg"),
        },
        "fcr": fcr_block,
        "pond_groups": pond_groups,
        "intervals": all_intervals,
        "load_by_pond": load_rows,
        "methodology": (
            "Growth intervals are measured between consecutive biomass samples in the period. "
            "ADG (g/fish/day) = (later mean weight − earlier mean weight) × 1000 ÷ days. "
            "Interval FCR = feed recorded between sample dates ÷ biomass gain. "
            "Period FCR and load use the same methods as the FCR & pond load report."
        ),
    }
