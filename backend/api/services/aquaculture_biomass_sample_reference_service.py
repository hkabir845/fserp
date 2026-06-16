"""Look up prior biomass samples to suggest stock-ledger fish count / weight."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.db.models import F, OuterRef, Q, Subquery

from api.models import AquacultureBiomassSample, AquacultureDataBankPondClose, AquaculturePond
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.aquaculture_pond_site import normalize_physical_site_name


def _fish_per_kg_from_count_weight(fish_count: int | None, weight_kg) -> Decimal | None:
    if fish_count is None or int(fish_count) <= 0:
        return None
    w = Decimal(str(weight_kg))
    if w <= 0:
        return None
    return (Decimal(int(fish_count)) / w).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _same_site_pond_ids(company_id: int, pond_id: int) -> list[int]:
    """All pond profit-center rows on the same physical site (nursing + grow-out peers)."""
    pond = (
        AquaculturePond.objects.filter(pk=pond_id, company_id=company_id)
        .only("id", "physical_site_name")
        .first()
    )
    if not pond:
        return [pond_id]
    site = normalize_physical_site_name(getattr(pond, "physical_site_name", None))
    if not site:
        return [pond_id]
    peer_ids = list(
        AquaculturePond.objects.filter(company_id=company_id, physical_site_name__iexact=site).values_list(
            "id", flat=True
        )
    )
    return peer_ids or [pond_id]


def _apply_live_sample_data_bank_filter(qs, company_id: int):
    """Exclude archived biomass samples per pond Data Bank closes."""
    latest_close_end = (
        AquacultureDataBankPondClose.objects.filter(
            company_id=company_id,
            pond_id=OuterRef("pond_id"),
            status=AquacultureDataBankPondClose.STATUS_CLOSED,
            is_data_locked=True,
        )
        .order_by("-period_end", "-id")
        .values("period_end")[:1]
    )
    return qs.annotate(_data_bank_close_end=Subquery(latest_close_end)).filter(
        Q(_data_bank_close_end__isnull=True) | Q(sample_date__gt=F("_data_bank_close_end"))
    )


def _live_biomass_sample_queryset(
    company_id: int,
    *,
    requested_pond_id: int,
    fish_species: str,
    fish_species_other: str | None = None,
    production_cycle_id: int | None = None,
    same_site_scope: bool = True,
):
    """Samples visible in live pond UI (excludes archived Data Bank periods)."""
    sp_code, _ = normalize_fish_species(fish_species)
    pond_ids = _same_site_pond_ids(company_id, requested_pond_id) if same_site_scope else [requested_pond_id]
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id, pond_id__in=pond_ids, fish_species=sp_code
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if sp_code == "other" and fish_species_other and str(fish_species_other).strip():
        qs = qs.filter(fish_species_other__iexact=str(fish_species_other).strip())
    return _apply_live_sample_data_bank_filter(qs, company_id)


def _sample_reference_payload(
    sample: AquacultureBiomassSample,
    *,
    requested_pond_id: int,
    cycle_scope_fallback: bool,
) -> dict | None:
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
    pond_obj = getattr(sample, "pond", None)
    pname = (pond_obj.name or "").strip() if pond_obj else ""
    display_name = pond_operational_display_name(pond_obj) if pond_obj else pname
    spo = getattr(sample, "fish_species_other", None) or ""

    avg_kg = None
    if fc and fc > 0 and wkg is not None:
        avg_kg = (Decimal(str(wkg)) / Decimal(int(fc))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    site_scope_fallback = sample.pond_id != requested_pond_id

    return {
        "sample_id": sample.id,
        "sample_date": sample.sample_date.isoformat(),
        "pond_id": sample.pond_id,
        "pond_name": display_name or pname,
        "production_cycle_id": sample.production_cycle_id,
        "production_cycle_name": cname,
        "fish_species": getattr(sample, "fish_species", None) or "tilapia",
        "fish_species_label": fish_species_display_label(
            getattr(sample, "fish_species", None) or "tilapia",
            spo,
        ),
        "estimated_fish_count": fc,
        "estimated_total_weight_kg": str(wkg) if wkg is not None else None,
        "fish_per_kg": str(fpk),
        "avg_weight_kg": str(avg_kg) if avg_kg is not None else (
            str(sample.avg_weight_kg) if sample.avg_weight_kg is not None else None
        ),
        "stock_reference_fish_count": sample.stock_reference_fish_count,
        "extrapolated_biomass_kg": (
            str(sample.extrapolated_biomass_kg) if sample.extrapolated_biomass_kg is not None else None
        ),
        "cycle_scope_fallback": cycle_scope_fallback,
        "site_scope_fallback": site_scope_fallback,
    }


def _latest_usable_sample_reference_from_qs(
    qs,
    *,
    requested_pond_id: int,
    cycle_scope_fallback: bool,
    limit: int = 50,
) -> dict | None:
    """Return the newest sample that yields a valid pcs/kg reference (skip incomplete rows)."""
    for sample in qs.select_related("pond", "production_cycle").order_by("-sample_date", "-id")[:limit]:
        payload = _sample_reference_payload(
            sample,
            requested_pond_id=requested_pond_id,
            cycle_scope_fallback=cycle_scope_fallback,
        )
        if payload is not None:
            return payload
    return None


def last_biomass_sample_reference_for_ledger(
    company_id: int,
    *,
    pond_id: int,
    production_cycle_id: int | None,
    fish_species: str,
    fish_species_other: str | None = None,
) -> dict | None:
    """
    Most recent live biomass sample for pond + cycle + species.
    Searches the requested pond and same-site peers (nursing ↔ grow-out) so legacy
    duplicate profit-center rows still resolve the latest seine sample.
    When production_cycle_id is set, only samples for that cycle are considered first.
    If none match, falls back to the latest live sample for the site + species (any cycle).
    """
    qs = _live_biomass_sample_queryset(
        company_id,
        requested_pond_id=pond_id,
        fish_species=fish_species,
        fish_species_other=fish_species_other,
        production_cycle_id=production_cycle_id,
    )
    ref = _latest_usable_sample_reference_from_qs(
        qs, requested_pond_id=pond_id, cycle_scope_fallback=False
    )
    if ref is None and production_cycle_id is not None:
        qs = _live_biomass_sample_queryset(
            company_id,
            requested_pond_id=pond_id,
            fish_species=fish_species,
            fish_species_other=fish_species_other,
            production_cycle_id=None,
        )
        ref = _latest_usable_sample_reference_from_qs(
            qs, requested_pond_id=pond_id, cycle_scope_fallback=True
        )

    return ref
