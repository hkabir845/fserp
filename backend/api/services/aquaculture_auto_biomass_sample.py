"""
Auto sampling rows from fish movements: vendor purchases and pond-to-pond transfers.

Every time fish or fingerlings change hands, the three numbers a sampling row needs are already
on the document — head count, weight (kg) and pieces per kg. This module turns those into
``AquacultureBiomassSample`` rows so the buying pond and the selling pond each get a dated,
timed measurement without anyone re-typing it:

- **Vendor bill fish line** -> one row for the receiving pond (the pond that bought).
  Only for a bill whose stock receipt is applied, matching the rule fish stock already uses.
- **Pond-to-pond transfer** -> one row for the source pond (the pond that sold, totalled over
  the transfer's lines) and one row per destination line (each pond that bought).

Harvest sales have their own equivalent in ``aquaculture_sale_biomass_sync``.

Each row is linked back to its source (``source_bill_line``, ``source_fish_pond_transfer``,
``source_fish_pond_transfer_line``) so re-saving a document updates its rows instead of piling up
duplicates, and deleting the document takes its rows with it (FK cascade).

``sample_time`` carries the entry timestamp of the source document, so several trades booked on
one date stay distinguishable and in order.

Unlike a manual sample, these rows never trigger book biomass revaluation
(``sync_biomass_book_weight_from_sample``): they measure the batch that moved, not the whole pond.

Every entry point is best-effort — a derived analytics row must never roll back the bill or
transfer that produced it.
"""
from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.utils import timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    Bill,
    BillLine,
)
from api.services.aquaculture_biomass_sample_service import (
    apply_aquaculture_biomass_sample_extrapolation,
)
from api.services.aquaculture_biomass_sample_valuation_service import apply_biomass_sample_valuation
from api.services.aquaculture_constants import normalize_fish_species, normalize_fish_species_other
from api.utils.decimal_fields import fit_decimal

logger = logging.getLogger(__name__)


def _dec(value) -> Decimal | None:
    if value is None or (isinstance(value, str) and not str(value).strip()):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _entry_time(record):
    """Wall-clock entry time of the source document, in the site's timezone."""
    created = getattr(record, "created_at", None)
    if not created:
        return None
    try:
        return timezone.localtime(created).time()
    except (ValueError, TypeError):
        return created.time()


def _species(raw_code, raw_other) -> tuple[str, str] | None:
    """Sampling needs a real species; N/A or unparseable means no row."""
    code, err = normalize_fish_species(raw_code or "tilapia")
    if err or not code or code == "not_applicable":
        return None
    return code, normalize_fish_species_other(raw_other, code) or ""


def _measurements(weight_kg: Decimal, head: int) -> tuple[Decimal, Decimal]:
    """(avg kg per fish at 6dp, pieces per kg at 4dp) — the sampling page shows both."""
    avg_kg = fit_decimal(
        (weight_kg / Decimal(head)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
        max_digits=14,
        decimal_places=6,
    )
    pcs_per_kg = (Decimal(head) / weight_kg).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return avg_kg, pcs_per_kg


def _note(prefix: str, avg_kg: Decimal, pcs_per_kg: Decimal) -> str:
    return f"{prefix} Approx. {pcs_per_kg} fish per kg (pcs/kg); avg {avg_kg} kg per fish."[:5000]


def _head_from(weight_kg: Decimal, raw_count, raw_pcs_per_kg) -> int | None:
    """Head count as entered, else derived from kg x pcs/kg."""
    if raw_count is not None and str(raw_count).strip() != "":
        try:
            head = int(raw_count)
        except (TypeError, ValueError):
            head = 0
        if head > 0:
            return head
    ppk = _dec(raw_pcs_per_kg)
    if ppk is not None and ppk > 0 and weight_kg > 0:
        head = int((weight_kg * ppk).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if head > 0:
            return head
    return None


def _upsert(*, lookup: dict, defaults: dict) -> None:
    obj, _created = AquacultureBiomassSample.objects.update_or_create(**lookup, defaults=defaults)
    # Stock reference, extrapolation and valuation are derived snapshots over deep stock / P&L
    # lookups. A failure there must leave the base sampling row in place.
    try:
        apply_aquaculture_biomass_sample_extrapolation(obj)
        apply_biomass_sample_valuation(obj)
        obj.save()
    except Exception:
        logger.exception(
            "Biomass enrichment failed for auto sample #%s; base row kept without full snapshot.",
            obj.id,
        )


def sync_biomass_samples_from_bill(company_id: int, bill) -> None:
    """Fish / fingerling purchase lines on a posted vendor bill -> sampling row per buying pond."""
    try:
        if getattr(bill, "internal_fish_transfer_line_id", None):
            # Paper for an inter-pond transfer; that transfer already sampled both ponds.
            return
        # Read the flag from the DB: posting sets it on the row, and the caller may still hold a
        # copy of the bill fetched before sync_posted_vendor_bill ran.
        receipt_applied = bool(
            Bill.objects.filter(pk=bill.id)
            .values_list("stock_receipt_applied", flat=True)
            .first()
        )
        entry_time = _entry_time(bill)
        lines = BillLine.objects.filter(bill_id=bill.id).select_related("item")
        for line in lines:
            existing = AquacultureBiomassSample.objects.filter(source_bill_line_id=line.id).first()
            item = line.item
            weight_kg = _dec(line.aquaculture_fish_weight_kg)
            head = None
            if weight_kg is not None and weight_kg > 0:
                head = _head_from(weight_kg, line.aquaculture_fish_count, None)
            species = _species(line.aquaculture_fish_species, line.aquaculture_fish_species_other)
            qualifies = (
                receipt_applied
                and item is not None
                and (getattr(item, "pos_category", "") or "").strip().lower() == "fish"
                and line.aquaculture_pond_id is not None
                and weight_kg is not None
                and weight_kg > 0
                and head is not None
                and species is not None
            )
            if not qualifies:
                if existing:
                    existing.delete()
                continue

            code, other = species
            avg_kg, pcs_per_kg = _measurements(weight_kg, head)
            _upsert(
                lookup={"source_bill_line_id": line.id},
                defaults={
                    "company_id": company_id,
                    "pond_id": line.aquaculture_pond_id,
                    "production_cycle_id": line.aquaculture_production_cycle_id,
                    "sample_date": bill.bill_date,
                    "sample_time": entry_time,
                    "estimated_fish_count": head,
                    "estimated_total_weight_kg": fit_decimal(
                        weight_kg, max_digits=14, decimal_places=4
                    ),
                    "avg_weight_kg": avg_kg,
                    "fish_species": code,
                    "fish_species_other": other[:120],
                    "notes": _note(
                        f"Auto from fish purchase on bill {bill.bill_number or f'#{bill.id}'}.",
                        avg_kg,
                        pcs_per_kg,
                    ),
                },
            )
    except Exception:
        logger.exception(
            "Auto biomass sampling failed for bill #%s; the bill itself is unaffected.",
            getattr(bill, "id", None),
        )


def sync_biomass_samples_from_fish_pond_transfer(
    company_id: int, transfer: AquacultureFishPondTransfer
) -> None:
    """Pond-to-pond transfer -> one sampling row for the selling pond and one per buying pond."""
    try:
        entry_time = _entry_time(transfer)
        species = _species(transfer.fish_species, transfer.fish_species_other)
        lines = list(transfer.lines.all())

        # --- Buying side: one row per destination line -------------------------------------
        sold_kg = Decimal("0")
        sold_head = 0
        for line in lines:
            existing = AquacultureBiomassSample.objects.filter(
                source_fish_pond_transfer_line_id=line.id
            ).first()
            weight_kg = _dec(line.weight_kg)
            head = (
                _head_from(weight_kg, line.fish_count, line.pcs_per_kg)
                if weight_kg is not None and weight_kg > 0
                else None
            )
            if species is None or weight_kg is None or weight_kg <= 0 or head is None:
                if existing:
                    existing.delete()
                continue

            sold_kg += weight_kg
            sold_head += head
            code, other = species
            avg_kg, pcs_per_kg = _measurements(weight_kg, head)
            _upsert(
                lookup={"source_fish_pond_transfer_line_id": line.id},
                defaults={
                    "company_id": company_id,
                    "pond_id": line.to_pond_id,
                    "production_cycle_id": line.to_production_cycle_id,
                    "sample_date": transfer.transfer_date,
                    "sample_time": entry_time,
                    "estimated_fish_count": head,
                    "estimated_total_weight_kg": fit_decimal(
                        weight_kg, max_digits=14, decimal_places=4
                    ),
                    "avg_weight_kg": avg_kg,
                    "fish_species": code,
                    "fish_species_other": other[:120],
                    "notes": _note(
                        f"Auto from pond transfer #{transfer.id} in "
                        f"(from {(transfer.from_pond.name or '').strip() or 'source pond'}).",
                        avg_kg,
                        pcs_per_kg,
                    ),
                },
            )

        # --- Selling side: one row for the source pond, totalled over the lines -------------
        sell_side = AquacultureBiomassSample.objects.filter(
            source_fish_pond_transfer_id=transfer.id
        ).first()
        if species is None or sold_kg <= 0 or sold_head <= 0:
            if sell_side:
                sell_side.delete()
            return

        code, other = species
        avg_kg, pcs_per_kg = _measurements(sold_kg, sold_head)
        _upsert(
            lookup={"source_fish_pond_transfer_id": transfer.id},
            defaults={
                "company_id": company_id,
                "pond_id": transfer.from_pond_id,
                "production_cycle_id": transfer.from_production_cycle_id,
                "sample_date": transfer.transfer_date,
                "sample_time": entry_time,
                "estimated_fish_count": sold_head,
                "estimated_total_weight_kg": fit_decimal(
                    sold_kg, max_digits=14, decimal_places=4
                ),
                "avg_weight_kg": avg_kg,
                "fish_species": code,
                "fish_species_other": other[:120],
                "notes": _note(
                    f"Auto from pond transfer #{transfer.id} out "
                    f"({len(lines)} destination line{'s' if len(lines) != 1 else ''}).",
                    avg_kg,
                    pcs_per_kg,
                ),
            },
        )
    except Exception:
        logger.exception(
            "Auto biomass sampling failed for pond transfer #%s; the transfer itself is unaffected.",
            getattr(transfer, "id", None),
        )
