"""Market valuation and margin snapshots for biomass sampling rows."""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from api.models import AquacultureBiomassSample, AquacultureProductionCycle
from api.services.aquaculture_bio_asset_cost_service import lookup_bio_cost_per_kg
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import pl_window_for_transfer_date

_VALUATION_FIELDS = (
    "market_value",
    "book_bioasset_value",
    "book_cost_per_kg",
    "bioasset_margin",
    "bioasset_margin_per_kg",
    "biological_production_cost",
    "full_cost_base",
    "full_cycle_margin",
    "full_cycle_margin_per_kg",
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _kg_price_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _clear_valuation(sample: AquacultureBiomassSample) -> None:
    for field in _VALUATION_FIELDS:
        setattr(sample, field, None)


def compute_biomass_sample_valuation_dict(
    *,
    company_id: int,
    pond_id: int,
    sample_date: date,
    extrapolated_biomass_kg: Decimal | None,
    market_price_per_kg: Decimal | None,
    production_cycle: AquacultureProductionCycle | None = None,
) -> dict[str, str | None]:
    """Return valuation snapshot fields as string decimals (or nulls)."""
    empty = {field: None for field in _VALUATION_FIELDS}
    if market_price_per_kg is None or market_price_per_kg <= 0:
        return empty
    if extrapolated_biomass_kg is None or extrapolated_biomass_kg <= 0:
        return empty

    biomass_kg = _kg_price_q(Decimal(str(extrapolated_biomass_kg)))
    market_price = _money_q(Decimal(str(market_price_per_kg)))
    market_value = _money_q(biomass_kg * market_price)

    bio_ref = lookup_bio_cost_per_kg(
        company_id,
        pond_id=pond_id,
        as_of_date=sample_date,
        production_cycle=production_cycle,
        line_weight_kg=biomass_kg,
    )
    bio_balance = _money_q(Decimal(str(bio_ref.get("bio_asset_balance") or "0")))
    book_cost = bio_ref.get("book_cost_per_kg") or bio_ref.get("cost_per_kg")
    book_cost_per_kg = _kg_price_q(Decimal(str(book_cost))) if book_cost else None

    book_bioasset_value = bio_balance
    if book_bioasset_value <= 0 and book_cost_per_kg is not None:
        book_bioasset_value = _money_q(biomass_kg * book_cost_per_kg)

    bioasset_margin = _money_q(market_value - book_bioasset_value)
    bioasset_margin_per_kg = (
        _kg_price_q(market_price - book_cost_per_kg) if book_cost_per_kg is not None else None
    )

    biological_total = _money_q(
        Decimal(str(bio_ref.get("biological_production_cost_total") or bio_ref.get("biological_cost_total") or "0"))
    )

    start, end = pl_window_for_transfer_date(sample_date, production_cycle)
    cycle_filter_id = production_cycle.id if production_cycle is not None else None
    pl = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        pond_id,
        cycle_filter_id,
        production_cycle,
        include_cycle_breakdown=False,
    )
    ponds = pl.get("ponds") or []
    pond_row = ponds[0] if ponds else {}
    operating = _money_q(Decimal(str(pond_row.get("operating_expenses") or "0")))
    payroll = _money_q(Decimal(str(pond_row.get("payroll_allocated") or "0")))
    full_cost_base = _money_q(operating + payroll)

    full_cycle_margin = _money_q(market_value - full_cost_base)
    full_cycle_margin_per_kg = _kg_price_q(full_cycle_margin / biomass_kg)

    return {
        "market_value": str(market_value),
        "book_bioasset_value": str(book_bioasset_value),
        "book_cost_per_kg": str(book_cost_per_kg) if book_cost_per_kg is not None else None,
        "bioasset_margin": str(bioasset_margin),
        "bioasset_margin_per_kg": str(bioasset_margin_per_kg) if bioasset_margin_per_kg is not None else None,
        "biological_production_cost": str(biological_total),
        "full_cost_base": str(full_cost_base),
        "full_cycle_margin": str(full_cycle_margin),
        "full_cycle_margin_per_kg": str(full_cycle_margin_per_kg),
    }


def apply_biomass_sample_valuation(sample: AquacultureBiomassSample) -> None:
    """Compute and assign valuation snapshot fields on an unsaved or in-memory sample."""
    if sample.market_price_per_kg is None or sample.market_price_per_kg <= 0:
        _clear_valuation(sample)
        return
    if sample.extrapolated_biomass_kg is None or sample.extrapolated_biomass_kg <= 0:
        _clear_valuation(sample)
        return

    vals = compute_biomass_sample_valuation_dict(
        company_id=sample.company_id,
        pond_id=sample.pond_id,
        sample_date=sample.sample_date,
        extrapolated_biomass_kg=sample.extrapolated_biomass_kg,
        market_price_per_kg=sample.market_price_per_kg,
        production_cycle=sample.production_cycle,
    )
    for field in _VALUATION_FIELDS:
        raw = vals.get(field)
        setattr(sample, field, Decimal(raw) if raw is not None else None)
