"""
Pond performance dashboard: FCR, load, ADG, biomass, and bioasset (GL 1581) per pond.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from api.models import AquacultureBiomassSample, AquaculturePond
from api.services.aquaculture_data_bank_service import pond_biological_settlement
from api.services.aquaculture_fcr_service import compute_fcr_for_scope, fcr_period_summary_block
from api.services.aquaculture_growth_service import _interval_rows_for_samples
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _avg_adg_from_intervals(intervals: list[dict[str, Any]]) -> str | None:
    values: list[Decimal] = []
    for row in intervals:
        raw = row.get("adg_g_per_fish_per_day")
        if raw is None:
            continue
        try:
            v = Decimal(str(raw))
        except Exception:
            continue
        if v > 0:
            values.append(v)
    if not values:
        return None
    return str(_money_q(sum(values, Decimal("0")) / Decimal(len(values))))


def build_pond_performance_report(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> dict[str, Any]:
    ponds_qs = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "id"
    )
    if pond_id is not None:
        ponds_qs = ponds_qs.filter(pk=pond_id)

    sample_qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        sample_date__gte=start,
        sample_date__lte=end,
    ).select_related("pond")
    if pond_id is not None:
        sample_qs = sample_qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        sample_qs = sample_qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        sample_qs = sample_qs.filter(fish_species=fish_species)

    by_pond_samples: dict[int, list[AquacultureBiomassSample]] = {}
    for s in sample_qs.order_by("pond_id", "sample_date", "id"):
        by_pond_samples.setdefault(s.pond_id, []).append(s)

    stock_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        include_inactive_ponds=False,
    )
    stock_by_pond: dict[int, dict] = {int(r["pond_id"]): r for r in stock_rows if r.get("pond_id")}

    fcr_block = fcr_period_summary_block(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
    )

    pond_rows: list[dict[str, Any]] = []
    total_biomass = Decimal("0")
    total_bioasset = Decimal("0")
    total_fish = 0
    adg_values: list[Decimal] = []

    for p in ponds_qs:
        pid = p.id
        stock = stock_by_pond.get(pid, {})
        intervals = _interval_rows_for_samples(by_pond_samples.get(pid, []), company_id)
        adg_avg = _avg_adg_from_intervals(intervals)
        if adg_avg is not None:
            adg_values.append(Decimal(adg_avg))

        fcr = compute_fcr_for_scope(
            company_id,
            start,
            end,
            pond_id=pid,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )

        settlement = pond_biological_settlement(company_id, pid, end)
        bioasset = _d(settlement.get("settlement_bioasset_value"))

        biomass_kg = effective_biomass_kg_from_position_row(stock) if stock else Decimal("0")
        fish_count = int(stock.get("implied_net_fish_count") or 0) if stock else 0

        total_biomass += biomass_kg
        total_bioasset += bioasset
        total_fish += fish_count

        pond_rows.append(
            {
                "pond_id": pid,
                "pond_name": (p.name or "").strip() or f"Pond #{pid}",
                "pond_role": stock.get("pond_role") or getattr(p, "pond_role", None) or "grow_out",
                "water_area_decimal": stock.get("water_area_decimal"),
                "fish_count": fish_count,
                "biomass_kg": str(_money_q(biomass_kg)),
                "bioasset_value": str(bioasset),
                "fcr_biomass": fcr.get("fcr_biomass"),
                "fcr_harvest": fcr.get("fcr_harvest"),
                "feed_kg": fcr.get("feed_kg"),
                "biomass_gain_kg": fcr.get("biomass_gain_kg"),
                "harvest_kg": fcr.get("harvest_kg"),
                "adg_g_per_fish_per_day": adg_avg,
                "adg_interval_count": len(intervals),
                "sample_count": len(by_pond_samples.get(pid, [])),
                "load_kg_per_decimal": stock.get("stock_density_kg_per_decimal"),
                "load_level": stock.get("load_level"),
                "load_level_label": stock.get("load_level_label"),
                "pcs_per_kg": stock.get("current_fish_per_kg"),
                "latest_sample_date": stock.get("latest_sample_date"),
            }
        )

    portfolio = fcr_block.get("portfolio") or {}
    portfolio_adg: str | None = None
    if adg_values:
        portfolio_adg = str(_money_q(sum(adg_values, Decimal("0")) / Decimal(len(adg_values))))

    return {
        "summary": {
            "pond_count": len(pond_rows),
            "total_fish_count": total_fish,
            "total_biomass_kg": str(_money_q(total_biomass)),
            "total_bioasset_value": str(_money_q(total_bioasset)),
            "portfolio_fcr_biomass": portfolio.get("fcr_biomass"),
            "portfolio_fcr_harvest": portfolio.get("fcr_harvest"),
            "portfolio_feed_kg": portfolio.get("feed_kg"),
            "portfolio_biomass_gain_kg": portfolio.get("biomass_gain_kg"),
            "portfolio_harvest_kg": portfolio.get("harvest_kg"),
            "avg_adg_g_per_fish_per_day": portfolio_adg,
        },
        "fcr": fcr_block,
        "ponds": pond_rows,
        "methodology": (
            "One row per active pond. Biomass uses effective live weight (transaction book adjusted by "
            "latest seine sample when fish have grown beyond fry book weight). Bioasset is the posted GL "
            "balance of Biological Inventory (1581) tagged to the pond as of the period end date. "
            "FCR (biomass) = feed kg on pond expenses (feed purchase + feed consumed) ÷ positive biomass "
            "gain from first-to-last sampling in the period. ADG = mean of sample-to-sample intervals in "
            "the period: (later mean weight − earlier mean weight) × 1000 ÷ days (g/fish/day). "
            "Load = biomass kg ÷ water area (decimal), with comfort bands by pond role."
        ),
    }
