"""Create/update/delete biomass sampling rows from fish harvest sales (kg + head count)."""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from api.models import AquacultureBiomassSample, AquacultureFishSale
from api.utils.decimal_fields import fit_decimal
from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation
from api.services.aquaculture_biomass_sample_valuation_service import apply_biomass_sample_valuation
from api.services.tenant_reporting_categories import resolve_aquaculture_income_to_builtin

logger = logging.getLogger(__name__)


def _entry_time(sale: AquacultureFishSale):
    """Wall-clock entry time of the sale, so same-day rows stay in order on the sampling page."""
    created = getattr(sale, "created_at", None)
    if not created:
        return None
    try:
        return timezone.localtime(created).time()
    except (ValueError, TypeError):
        return created.time()


def sync_biomass_sample_from_fish_sale(sale: AquacultureFishSale) -> None:
    """
    When a fish harvest sale has positive weight_kg and fish_count, upsert one biomass sample
    (sample_date = sale_date) linked via source_fish_sale. avg_weight_kg matches manual sampling:
    kg per fish (total_kg / count). Notes include fish per kg (count / kg).

    If the sale no longer qualifies (wrong income type, missing count, etc.), remove the linked row.

    This is a derived analytics side effect — it must never raise or roll back the parent sale save.
    """
    try:
        linked = AquacultureBiomassSample.objects.filter(source_fish_sale_id=sale.id).first()

        ok = (
            resolve_aquaculture_income_to_builtin(sale.company_id, sale.income_type or "") == "fish_harvest_sale"
            and sale.fish_count is not None
            and sale.fish_count > 0
            and sale.weight_kg is not None
            and sale.weight_kg > 0
        )
        if not ok:
            if linked:
                linked.delete()
            return

        avg_kg = fit_decimal(
            (sale.weight_kg / Decimal(sale.fish_count)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
            max_digits=14,
            decimal_places=6,
        )
        fish_per_kg = (Decimal(sale.fish_count) / sale.weight_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        market_price = fit_decimal(
            (sale.total_amount / sale.weight_kg).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            max_digits=14,
            decimal_places=2,
        )
        notes = (
            f"Auto from fish harvest sale #{sale.id}. "
            f"Approx. {fish_per_kg} fish per kg (pcs/kg); avg {avg_kg} kg per fish."
        )

        obj, _created = AquacultureBiomassSample.objects.update_or_create(
            source_fish_sale_id=sale.id,
            defaults={
                "company_id": sale.company_id,
                "pond_id": sale.pond_id,
                "production_cycle": sale.production_cycle,
                "sample_date": sale.sale_date,
                "sample_time": _entry_time(sale),
                "estimated_fish_count": sale.fish_count,
                "estimated_total_weight_kg": fit_decimal(sale.weight_kg, max_digits=14, decimal_places=4),
                "avg_weight_kg": avg_kg,
                "fish_species": sale.fish_species or "tilapia",
                "fish_species_other": (sale.fish_species_other or "")[:120],
                "notes": notes[:5000],
                "market_price_per_kg": market_price,
            },
        )
        # Stock-reference extrapolation and market valuation are derived analytics snapshots
        # (deep stock/P&L/bio-cost lookups). Failures are logged, not raised.
        try:
            apply_aquaculture_biomass_sample_extrapolation(obj)
            apply_biomass_sample_valuation(obj)
            obj.save()
        except Exception:
            logger.exception(
                "Biomass enrichment failed for fish sale #%s; base sample kept without full snapshot.",
                sale.id,
            )
    except Exception:
        logger.exception(
            "Biomass sync failed for fish sale #%s; sale itself is unaffected.",
            sale.id,
        )
