"""Align pond book biomass (kg) with sample-based estimated live biomass.

World-class aquaculture systems revalue biological inventory when fish grow.
Fry bills record tiny stocking kg; transfers leave at fingerling kg. Without
revaluation, book kg goes negative even when live heads remain.

**Locked policy (dual truth):** this service upserts one **non-GL** stock-ledger
adjustment per pond+species so implied book kg matches effective (sample) biomass
for current live fish. GL 1581 stays on the cost model — never mark-to-sample.
Book vs sample divergence within published sample noise is expected; see
``docs/AQUACULTURE_ACCOUNTING_POLICY.md`` and
``api.services.aquaculture_accounting_policy``.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from api.models import AquacultureBiomassSample, AquacultureFishStockLedger
from api.services.aquaculture_constants import normalize_fish_species
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    _enrich_stock_row_with_sample_reference,
    compute_fish_stock_position_rows,
)

REVAL_MEMO_PREFIX = "AUTO-AQ-BIOMASS-REVAL"
# Manual / correction bridges (Ashari-2 #95, Mynuddin C01/C02) rewrite book kg only.
_BOOK_BRIDGE_MEMO_MARKERS = (
    "book bridge to sample",
    "bridge book→effective",
    "bridge book->effective",
    "replace bad auto revals",
)


def is_book_revaluation_ledger_row(row) -> bool:
    """True for weight-only book rewrites (not fish arriving or leaving).

    Includes AUTO-AQ-BIOMASS-REVAL and CORRECTED … book-bridge adjustments. Counting
    those as FCR inflows (Ashari-2 C03: +149 t bridge) turns a ~3.7 t production
    gain into a huge negative.
    """
    memo = (getattr(row, "memo", None) or "").strip()
    if not memo:
        return False
    if memo.startswith(REVAL_MEMO_PREFIX):
        return True
    lower = memo.lower()
    return any(marker in lower for marker in _BOOK_BRIDGE_MEMO_MARKERS)


def _money_kg(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _reval_memo(*, pond_id: int, sample_id: int, target_kg: Decimal) -> str:
    return f"{REVAL_MEMO_PREFIX}:pond={pond_id}:sample={sample_id}:target_kg={target_kg}"


def clear_biomass_book_revaluations(
    *,
    company_id: int,
    pond_id: int,
    fish_species: str,
    production_cycle_id: int | None = None,
) -> int:
    """Remove prior auto revaluation adjustments for this pond, species, and cycle."""
    sp, _ = normalize_fish_species(fish_species)
    qs = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        entry_kind="adjustment",
        fish_species=sp,
        memo__startswith=REVAL_MEMO_PREFIX,
    )
    if production_cycle_id is None:
        qs = qs.filter(production_cycle_id__isnull=True)
    else:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    deleted, _ = qs.delete()
    return int(deleted or 0)


def sync_biomass_book_weight_from_sample(
    sample: AquacultureBiomassSample,
) -> AquacultureFishStockLedger | None:
    """
    After a biomass sample is saved, set book kg ≈ estimated live biomass.

    Creates a weight-only adjustment (fish_count_delta=0, post_to_books=False).
    Idempotent: replaces any prior AUTO-AQ-BIOMASS-REVAL for the same pond+species.
    Returns None when no live fish or book already matches estimated biomass.
    """
    company_id = int(sample.company_id)
    pond_id = int(sample.pond_id)
    sp, _ = normalize_fish_species(getattr(sample, "fish_species", None) or "tilapia")
    sample_id = int(sample.pk)
    cycle_id = sample.production_cycle_id

    clear_biomass_book_revaluations(
        company_id=company_id,
        pond_id=pond_id,
        fish_species=sp,
        production_cycle_id=cycle_id,
    )

    rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_id,
        fish_species_filter=sp,
    )
    if not rows:
        return None
    row = _enrich_stock_row_with_sample_reference(
        company_id,
        pond_id,
        production_cycle_id=sample.production_cycle_id,
        fish_species=sp,
        row=rows[0],
    )
    try:
        fish_n = int(row.get("implied_net_fish_count") or 0)
    except (TypeError, ValueError):
        fish_n = 0
    if fish_n <= 0:
        return None

    book = _money_kg(Decimal(str(row.get("implied_net_weight_kg") or "0")))
    target = _money_kg(effective_biomass_kg_from_position_row(row))
    if target <= 0:
        return None
    delta = _money_kg(target - book)
    if abs(delta) < Decimal("0.01"):
        return None

    return AquacultureFishStockLedger.objects.create(
        company_id=company_id,
        pond_id=pond_id,
        production_cycle_id=sample.production_cycle_id,
        entry_date=sample.sample_date,
        entry_kind="adjustment",
        loss_reason="",
        fish_species=sp,
        fish_species_other=(getattr(sample, "fish_species_other", None) or "")[:120],
        fish_count_delta=0,
        weight_kg_delta=delta,
        book_value=Decimal("0"),
        post_to_books=False,
        memo=_reval_memo(pond_id=pond_id, sample_id=sample_id, target_kg=target)[:5000],
    )


def accrue_book_growth_before_outbound(
    *,
    company_id: int,
    pond_id: int,
    fish_species: str,
    production_cycle_id: int | None,
) -> AquacultureFishStockLedger | None:
    """Put sample growth onto this cycle's book kg before a harvest or transfer is saved.

    The sample check allows a grown-fish sale. Without this accrual, book kilograms
    (stocked minus sold) go negative because the growth was never written.
    """
    sp, _ = normalize_fish_species(fish_species)
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        fish_species=sp,
    )
    if production_cycle_id is None:
        qs = qs.filter(production_cycle_id__isnull=True)
    else:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    sample = qs.order_by("-sample_date", "-id").first()
    if sample is None:
        return None
    return sync_biomass_book_weight_from_sample(sample)


def sync_biomass_book_weight_for_pond(
    *,
    company_id: int,
    pond_id: int,
    fish_species: str = "tilapia",
) -> AquacultureFishStockLedger | None:
    """Revalue from the latest biomass sample on the pond (ops / backfill helper)."""
    sp, _ = normalize_fish_species(fish_species)
    sample = (
        AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            fish_species=sp,
        )
        .order_by("-sample_date", "-id")
        .first()
    )
    if not sample:
        return None
    return sync_biomass_book_weight_from_sample(sample)
