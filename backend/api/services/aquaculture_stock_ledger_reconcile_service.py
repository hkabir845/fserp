"""Tag untagged fish stock ledger rows to production cycles and seed missing demo opening stock."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

RECONCILE_MEMO_TAG = "[STOCK-CYCLE-RECONCILE]"
OPENING_DEMO_MEMO_TAG = "[DEMO-OPENING-STOCK]"

_SAMPLE_EXTRAPOLATION_FIELDS = (
    "stock_reference_fish_count",
    "stock_reference_net_weight_kg",
    "stock_reference_avg_weight_kg",
    "extrapolated_biomass_kg",
    "biomass_gain_kg",
)

# Named pond demo stock (matches seed_aquaculture_named_ponds.POND_PROFILES).
_NAMED_POND_OPENING: dict[str, tuple[int, Decimal]] = {
    "digonta": (52000, Decimal("1040.0000")),
    "mynuddin": (11800, Decimal("3540.0000")),
    "ashari-1": (14200, Decimal("4970.0000")),
    "ashari-2": (9600, Decimal("2880.0000")),
}


def resolve_default_production_cycle(
    company_id: int,
    pond_id: int,
) -> AquacultureProductionCycle | None:
    """Prefer the pond's Mid Cycle, else code '0', else the earliest active cycle."""
    base = AquacultureProductionCycle.objects.filter(company_id=company_id, pond_id=pond_id)
    cy = base.filter(is_active=True, name__icontains="Mid Cycle").order_by("-start_date", "-id").first()
    if cy:
        return cy
    cy = base.filter(code="0").order_by("-start_date", "-id").first()
    if cy:
        return cy
    return base.filter(is_active=True).order_by("-start_date", "-id").first()


def _opening_from_untagged_ledger(company_id: int, pond_id: int) -> tuple[int, Decimal] | None:
    led = (
        AquacultureFishStockLedger.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            production_cycle__isnull=True,
            entry_kind="adjustment",
            fish_count_delta__gt=0,
        )
        .order_by("-entry_date", "-id")
        .first()
    )
    if led:
        return int(led.fish_count_delta), Decimal(str(led.weight_kg_delta))
    return None


def _opening_from_named_profile(pond: AquaculturePond) -> tuple[int, Decimal] | None:
    key = (pond.name or "").strip().casefold()
    if key in _NAMED_POND_OPENING:
        fc, w = _NAMED_POND_OPENING[key]
        return fc, w
    return None


def _opening_from_latest_sample(company_id: int, pond_id: int, cycle_id: int) -> tuple[int, Decimal] | None:
    sample = (
        AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            production_cycle_id=cycle_id,
            estimated_fish_count__gt=0,
            estimated_total_weight_kg__gt=0,
        )
        .order_by("-sample_date", "-id")
        .first()
    )
    if not sample:
        return None
    return int(sample.estimated_fish_count), Decimal(str(sample.estimated_total_weight_kg))


def _resolve_opening_stock(
    company_id: int,
    pond: AquaculturePond,
    cycle_id: int,
) -> tuple[int, Decimal] | None:
    from_untagged = _opening_from_untagged_ledger(company_id, pond.id)
    if from_untagged:
        return from_untagged
    from_profile = _opening_from_named_profile(pond)
    if from_profile:
        return from_profile
    return _opening_from_latest_sample(company_id, pond.id, cycle_id)


def reconcile_untagged_stock_ledger_entries(company_id: int) -> int:
    """Assign production_cycle_id on ledger rows that were logged before a cycle existed."""
    updated = 0
    qs = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        production_cycle__isnull=True,
    ).select_related("pond")
    for led in qs:
        cy = resolve_default_production_cycle(company_id, led.pond_id)
        if not cy:
            continue
        led.production_cycle = cy
        memo = (led.memo or "").strip()
        if RECONCILE_MEMO_TAG not in memo:
            led.memo = f"{memo} {RECONCILE_MEMO_TAG}".strip() if memo else RECONCILE_MEMO_TAG
        led.save(update_fields=["production_cycle", "memo", "updated_at"])
        updated += 1
    return updated


def ensure_opening_stock_for_demo_cycles(company_id: int) -> int:
    """
    Create positive opening adjustments on demo/dashboard cycles that have biomass samples
    but no implied net fish count (cycle-filtered stock position is empty).
    """
    created = 0
    cycles = AquacultureProductionCycle.objects.filter(company_id=company_id).select_related("pond")
    for cy in cycles:
        code = (cy.code or "").strip()
        if not (code.startswith("DASH-DEMO-CY-") or code.startswith("BULK-DEMO-CY-") or code.startswith("APP-DEMO-CY-")):
            continue
        if AquacultureFishStockLedger.objects.filter(
            company_id=company_id,
            pond_id=cy.pond_id,
            production_cycle_id=cy.id,
            memo__contains=OPENING_DEMO_MEMO_TAG,
        ).exists():
            continue
        rows = compute_fish_stock_position_rows(
            company_id,
            pond_id=cy.pond_id,
            production_cycle_id=cy.id,
            fish_species_filter="tilapia",
            include_inactive_ponds=True,
        )
        implied = int(rows[0].get("implied_net_fish_count") or 0) if rows else 0
        if implied > 0:
            continue
        opening = _resolve_opening_stock(company_id, cy.pond, cy.id)
        if not opening:
            continue
        fc, wkg = opening
        if fc <= 0 or wkg <= 0:
            continue
        entry_date = cy.start_date or (date.today() - timedelta(days=90))
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond_id=cy.pond_id,
            production_cycle=cy,
            entry_date=entry_date,
            entry_kind="adjustment",
            loss_reason="",
            fish_species="tilapia",
            fish_count_delta=fc,
            weight_kg_delta=wkg,
            book_value=Decimal("0"),
            post_to_books=False,
            memo=f"{OPENING_DEMO_MEMO_TAG} Opening fry/stocking reconcile for {cy.name} — demo only, not posted to GL.",
        )
        created += 1
    return created


def ensure_bulk_cycle_opening_stock(company_id: int) -> int:
    """Bulk demo cycles only had small loss/adj rows; add opening stock matching sample estimates."""
    created = 0
    for cy in AquacultureProductionCycle.objects.filter(
        company_id=company_id,
        code__startswith="BULK-DEMO-CY-",
    ).select_related("pond"):
        has_positive = AquacultureFishStockLedger.objects.filter(
            company_id=company_id,
            pond_id=cy.pond_id,
            production_cycle_id=cy.id,
            entry_kind="adjustment",
            fish_count_delta__gt=0,
        ).exists()
        if has_positive:
            continue
        opening = _resolve_opening_stock(company_id, cy.pond, cy.id)
        if not opening:
            continue
        fc, wkg = opening
        memo = f"BULK-DEMO-OPENING-{cy.id} {OPENING_DEMO_MEMO_TAG}"
        if AquacultureFishStockLedger.objects.filter(company_id=company_id, memo=memo).exists():
            continue
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond_id=cy.pond_id,
            production_cycle=cy,
            entry_date=cy.start_date or (date.today() - timedelta(days=60)),
            entry_kind="adjustment",
            loss_reason="",
            fish_species="tilapia",
            fish_count_delta=fc,
            weight_kg_delta=wkg,
            book_value=Decimal("0"),
            post_to_books=False,
            memo=memo,
        )
        created += 1
    return created


def backfill_biomass_sample_extrapolation(company_id: int) -> int:
    updated = 0
    for sample in AquacultureBiomassSample.objects.filter(company_id=company_id).iterator():
        apply_aquaculture_biomass_sample_extrapolation(sample)
        sample.save(update_fields=list(_SAMPLE_EXTRAPOLATION_FIELDS))
        updated += 1
    return updated


def opening_stock_for_pond(company_id: int, pond: AquaculturePond, cycle_id: int) -> tuple[int, Decimal] | None:
    """Public helper for seed commands."""
    return _resolve_opening_stock(company_id, pond, cycle_id)


def reconcile_aquaculture_demo_stock(company_id: int) -> dict[str, int]:
    tagged = reconcile_untagged_stock_ledger_entries(company_id)
    demo_openings = ensure_opening_stock_for_demo_cycles(company_id)
    bulk_openings = ensure_bulk_cycle_opening_stock(company_id)
    samples = backfill_biomass_sample_extrapolation(company_id)
    return {
        "ledger_tagged": tagged,
        "demo_cycle_openings": demo_openings,
        "bulk_cycle_openings": bulk_openings,
        "samples_backfilled": samples,
    }
