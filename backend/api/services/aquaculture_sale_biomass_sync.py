"""Create/update/delete biomass sampling rows from fish harvest sales (kg + head count)."""
from __future__ import annotations

from decimal import Decimal

from api.models import AquacultureBiomassSample, AquacultureFishSale


def sync_biomass_sample_from_fish_sale(sale: AquacultureFishSale) -> None:
    """
    When a fish harvest sale has positive weight_kg and fish_count, upsert one biomass sample
    (sample_date = sale_date) linked via source_fish_sale. avg_weight_kg matches manual sampling:
    kg per fish (total_kg / count). Notes include fish per kg (count / kg).

    If the sale no longer qualifies (wrong income type, missing count, etc.), remove the linked row.
    """
    linked = AquacultureBiomassSample.objects.filter(source_fish_sale_id=sale.id).first()

    ok = (
        (sale.income_type or "") == "fish_harvest_sale"
        and sale.fish_count is not None
        and sale.fish_count > 0
        and sale.weight_kg is not None
        and sale.weight_kg > 0
    )
    if not ok:
        if linked:
            linked.delete()
        return

    avg_kg = (sale.weight_kg / Decimal(sale.fish_count)).quantize(Decimal("0.000001"))
    fish_per_kg = (Decimal(sale.fish_count) / sale.weight_kg).quantize(Decimal("0.0001"))
    notes = (
        f"Auto from fish harvest sale #{sale.id}. "
        f"Approx. {fish_per_kg} fish per kg (pcs/kg); avg {avg_kg} kg per fish."
    )

    AquacultureBiomassSample.objects.update_or_create(
        source_fish_sale_id=sale.id,
        defaults={
            "company_id": sale.company_id,
            "pond_id": sale.pond_id,
            "production_cycle": sale.production_cycle,
            "sample_date": sale.sale_date,
            "estimated_fish_count": sale.fish_count,
            "estimated_total_weight_kg": sale.weight_kg,
            "avg_weight_kg": avg_kg,
            "fish_species": sale.fish_species or "tilapia",
            "fish_species_other": (sale.fish_species_other or "")[:120],
            "notes": notes[:5000],
        },
    )
