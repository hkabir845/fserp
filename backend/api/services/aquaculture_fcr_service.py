"""
Feed Conversion Ratio (FCR) from recorded feed consumption and biomass change (sampling-based).

FCR = feed kg consumed ÷ biomass gain (kg) in the period, when gain is positive.
Also exposes feed ÷ harvest kg for the same window.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

from api.models import AquacultureBiomassSample, AquacultureExpense, AquacultureFishSale, AquaculturePond
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company


def _d(val) -> Decimal:
    if val is None or val == "":
        return Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def _q2(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _q4(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def sum_feed_kg_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> Decimal:
    """Direct pond feed (purchased + consumed) with feed_weight_kg in the inclusive date window."""
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_category__in=["feed_purchase", "feed_consumed"],
        expense_date__gte=start,
        expense_date__lte=end,
        feed_weight_kg__isnull=False,
        feed_weight_kg__gt=0,
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    agg = qs.aggregate(total=Sum("feed_weight_kg"))
    return _q4(_d(agg.get("total")))


def _sample_biomass_kg(sample: AquacultureBiomassSample) -> Decimal | None:
    if sample.extrapolated_biomass_kg is not None and sample.extrapolated_biomass_kg > 0:
        return _d(sample.extrapolated_biomass_kg)
    if sample.estimated_total_weight_kg is not None and sample.estimated_total_weight_kg > 0:
        return _d(sample.estimated_total_weight_kg)
    fc = sample.estimated_fish_count
    avg = sample.avg_weight_kg
    if fc is not None and fc > 0 and avg is not None and avg > 0:
        return _q4(_d(fc) * _d(avg))
    return None


def biomass_gain_from_samples_for_pond(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, Decimal, Decimal, str]:
    """
    Returns (first_biomass_kg, last_biomass_kg, gain_kg, basis_note).
    gain_kg is last − first when both samples exist and last > first; else 0.
    """
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sample_date__gte=start,
        sample_date__lte=end,
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        qs = qs.filter(fish_species=fish_species)
    samples = list(qs.order_by("sample_date", "id"))
    usable: list[tuple[date, Decimal]] = []
    for s in samples:
        bio = _sample_biomass_kg(s)
        if bio is not None and bio > 0:
            usable.append((s.sample_date, bio))
    if len(usable) < 2:
        note = "Need at least two biomass samples in the period with positive estimated biomass."
        return Decimal("0"), Decimal("0"), Decimal("0"), note
    first = usable[0][1]
    last = usable[-1][1]
    gain = last - first
    if gain <= 0:
        return first, last, Decimal("0"), "Biomass did not increase between first and last sample in period."
    return first, last, _q4(gain), "Last sample biomass − first sample biomass (extrapolated or estimated total)."


def sum_harvest_kg_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> Decimal:
    qs = AquacultureFishSale.objects.filter(
        company_id=company_id,
        sale_date__gte=start,
        sale_date__lte=end,
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    total = Decimal("0")
    for s in qs.only("weight_kg", "income_type"):
        if income_type_is_non_biological_for_company(company_id, getattr(s, "income_type", None) or ""):
            continue
        if getattr(s, "income_type", None) == "fish_harvest_sale":
            total += _d(s.weight_kg)
    return _q4(total)


def compute_fcr_for_scope(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> dict:
    """FCR metrics for one pond (or company-wide when pond_id is None)."""
    feed_kg = sum_feed_kg_for_period(
        company_id, start, end, pond_id=pond_id, production_cycle_id=production_cycle_id
    )
    harvest_kg = sum_harvest_kg_for_period(
        company_id, start, end, pond_id=pond_id, production_cycle_id=production_cycle_id
    )
    first_bio = Decimal("0")
    last_bio = Decimal("0")
    gain_kg = Decimal("0")
    gain_note = ""
    if pond_id is not None:
        first_bio, last_bio, gain_kg, gain_note = biomass_gain_from_samples_for_pond(
            company_id,
            pond_id,
            start,
            end,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )
    else:
        ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")
        gains: list[Decimal] = []
        for p in ponds:
            _, _, g, _ = biomass_gain_from_samples_for_pond(
                company_id, p.id, start, end, production_cycle_id=production_cycle_id, fish_species=fish_species
            )
            if g > 0:
                gains.append(g)
        if gains:
            gain_kg = _q4(sum(gains, Decimal("0")))
            gain_note = f"Sum of per-pond biomass gains ({len(gains)} pond(s) with positive sample Δ)."

    fcr_biomass: str | None = None
    if gain_kg > 0 and feed_kg > 0:
        fcr_biomass = str(_q2(feed_kg / gain_kg))

    fcr_harvest: str | None = None
    if harvest_kg > 0 and feed_kg > 0:
        fcr_harvest = str(_q2(feed_kg / harvest_kg))

    return {
        "feed_kg": str(feed_kg),
        "harvest_kg": str(harvest_kg),
        "biomass_first_kg": str(_q4(first_bio)) if pond_id else None,
        "biomass_last_kg": str(_q4(last_bio)) if pond_id else None,
        "biomass_gain_kg": str(gain_kg),
        "biomass_gain_note": gain_note,
        "fcr_biomass": fcr_biomass,
        "fcr_harvest": fcr_harvest,
        "fcr_biomass_label": "Feed kg ÷ biomass gain (sampling)" if fcr_biomass else None,
        "fcr_harvest_label": "Feed kg ÷ harvest sale kg" if fcr_harvest else None,
    }


def fcr_period_summary_block(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> dict:
    """Standard FCR block attached to date-range aquaculture reports."""
    portfolio = compute_fcr_for_scope(
        company_id, start, end, pond_id=None, production_cycle_id=production_cycle_id
    )
    scoped = None
    if pond_id is not None:
        scoped = compute_fcr_for_scope(
            company_id, start, end, pond_id=pond_id, production_cycle_id=production_cycle_id
        )
    per_pond: list[dict] = []
    if pond_id is None:
        ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")
        for p in ponds:
            row = compute_fcr_for_scope(
                company_id, start, end, pond_id=p.id, production_cycle_id=production_cycle_id
            )
            if _d(row.get("feed_kg")) <= 0 and _d(row.get("biomass_gain_kg")) <= 0 and _d(row.get("harvest_kg")) <= 0:
                continue
            per_pond.append(
                {
                    "pond_id": p.id,
                    "pond_name": (p.name or "").strip(),
                    **row,
                }
            )
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "portfolio": portfolio,
        "scoped": scoped,
        "per_pond": per_pond,
        "methodology": (
            "FCR (biomass) = total feed kg recorded on pond expenses (feed purchase + feed consumed) "
            "÷ positive biomass gain from first-to-last sampling in the period. "
            "FCR (harvest) = same feed kg ÷ fish_harvest_sale weight in the period."
        ),
    }
