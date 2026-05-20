"""Look up prior biomass samples to suggest stock-ledger fish count / weight."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.models import AquacultureBiomassSample
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species


def _fish_per_kg_from_count_weight(fish_count: int | None, weight_kg) -> Decimal | None:
    if fish_count is None or int(fish_count) <= 0:
        return None
    w = Decimal(str(weight_kg))
    if w <= 0:
        return None
    return (Decimal(int(fish_count)) / w).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def last_biomass_sample_reference_for_ledger(
    company_id: int,
    *,
    pond_id: int,
    production_cycle_id: int | None,
    fish_species: str,
    fish_species_other: str | None = None,
) -> dict | None:
    """
    Most recent biomass sample for pond + cycle + species.
    production_cycle_id None matches samples with no cycle tagged.
    """
    sp_code, _ = normalize_fish_species(fish_species)
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id, pond_id=pond_id, fish_species=sp_code
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    else:
        qs = qs.filter(production_cycle_id__isnull=True)
    if sp_code == "other" and fish_species_other and str(fish_species_other).strip():
        qs = qs.filter(fish_species_other__iexact=str(fish_species_other).strip())

    sample = qs.select_related("pond", "production_cycle").order_by("-sample_date", "-id").first()
    if not sample:
        return None

    fc = sample.estimated_fish_count
    wkg = sample.estimated_total_weight_kg
    fpk = _fish_per_kg_from_count_weight(fc, wkg)
    if fpk is None and sample.avg_weight_kg is not None:
        avg = Decimal(str(sample.avg_weight_kg))
        if avg > 0:
            fpk = (Decimal("1") / avg).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    if fpk is None:
        return None

    cname = ""
    if sample.production_cycle_id and getattr(sample, "production_cycle", None):
        cname = (sample.production_cycle.name or "").strip()
    spo = getattr(sample, "fish_species_other", None) or ""

    avg_kg = None
    if fc and fc > 0 and wkg is not None:
        avg_kg = (Decimal(str(wkg)) / Decimal(int(fc))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    return {
        "sample_id": sample.id,
        "sample_date": sample.sample_date.isoformat(),
        "pond_id": sample.pond_id,
        "production_cycle_id": sample.production_cycle_id,
        "production_cycle_name": cname,
        "fish_species": sp_code,
        "fish_species_label": fish_species_display_label(sp_code, spo),
        "estimated_fish_count": fc,
        "estimated_total_weight_kg": str(wkg) if wkg is not None else None,
        "fish_per_kg": str(fpk),
        "avg_weight_kg": str(avg_kg) if avg_kg is not None else (
            str(sample.avg_weight_kg) if sample.avg_weight_kg is not None else None
        ),
        "extrapolated_biomass_kg": (
            str(sample.extrapolated_biomass_kg) if sample.extrapolated_biomass_kg is not None else None
        ),
    }
