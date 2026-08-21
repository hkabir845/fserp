"""
Report-time soft allocation of untagged pond feed/medicine onto stocking batches.

Does not mutate expenses, GL, warehouse QOH, or empty sacks. Used so cycle-filtered
reports / FCR can include a proportional share of historical untagged consumption.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from api.models import AquacultureExpense
from api.services.aquaculture_feeding_advice_service import (
    allocate_feed_kg_across_batches,
    compute_batch_feed_demand_shares,
)
from api.services.aquaculture_pond_consumption_ledger_service import compute_pond_warehouse_consumption_rows

SOFT_ALLOC_NOTE = (
    "Includes soft-allocated share of pond-level (untagged) consumption by sampling × WorldFish "
    "demand. Books are unchanged; only the batch report view is split."
)


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


def soft_allocate_untagged_consumption_for_cycle(
    company_id: int,
    *,
    production_cycle_id: int,
    pond_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    """
    Virtual ledger rows: this cycle's share of untagged pond warehouse consumption.

    Each output row mirrors ``compute_pond_warehouse_consumption_rows`` shape plus
    ``is_soft_allocation``, ``source_expense_id``, ``share_fraction``.
    """
    # Resolve pond scope from the cycle when not provided.
    from api.models import AquacultureProductionCycle

    cy = AquacultureProductionCycle.objects.filter(
        pk=production_cycle_id, company_id=company_id
    ).first()
    if not cy:
        return []
    scope_pond = pond_id if pond_id is not None else cy.pond_id
    if pond_id is not None and cy.pond_id != pond_id:
        return []

    untagged = compute_pond_warehouse_consumption_rows(
        company_id,
        pond_id=scope_pond,
        production_cycle_id=None,
        date_from=date_from,
        date_to=date_to,
        kind=kind,
        limit=10000,
    )
    # Only rows that are truly untagged (ledger returns cycle null).
    untagged = [r for r in untagged if r.get("production_cycle_id") is None]
    if not untagged:
        return []

    shares_by_pond: dict[int, list[dict]] = {}
    out: list[dict] = []

    for r in untagged:
        pid = int(r["pond_id"])
        if pid not in shares_by_pond:
            shares_by_pond[pid] = compute_batch_feed_demand_shares(company_id, pid)
        shares = shares_by_pond[pid]
        if len(shares) < 2:
            # Single-batch ponds should be hard-tagged by reconcile; skip soft here
            # unless the only share is this cycle.
            if len(shares) == 1 and int(shares[0]["production_cycle_id"]) == production_cycle_id:
                row = dict(r)
                row["is_soft_allocation"] = True
                row["source_expense_id"] = r.get("id")
                row["share_fraction"] = "1.0000"
                row["source_doc"] = f"{r.get('source_doc') or ''} · soft 100% → batch".strip()
                out.append(row)
            continue

        allocated = allocate_feed_kg_across_batches(Decimal("1"), shares)
        target = next(
            (a for a in allocated if int(a["production_cycle_id"]) == production_cycle_id),
            None,
        )
        if not target:
            continue
        frac = _d(target.get("share_fraction"))
        if frac <= 0:
            continue

        amt = _q2(_d(r.get("amount")) * frac)
        kg_raw = r.get("feed_weight_kg")
        kg = _q4(_d(kg_raw) * frac) if kg_raw not in (None, "") else None
        sacks_raw = r.get("feed_sack_count")
        sacks = _q4(_d(sacks_raw) * frac) if sacks_raw not in (None, "") else None
        qty_raw = r.get("quantity")
        qty = _q4(_d(qty_raw) * frac) if qty_raw not in (None, "") else None

        cy_name = (target.get("production_cycle_name") or "").strip()
        row = dict(r)
        row["id"] = f"soft-{r.get('id')}-{production_cycle_id}"
        row["production_cycle_id"] = production_cycle_id
        row["production_cycle_name"] = cy_name
        row["amount"] = str(amt)
        if kg is not None:
            row["feed_weight_kg"] = str(kg)
        if sacks is not None:
            row["feed_sack_count"] = str(sacks)
        if qty is not None:
            row["quantity"] = str(qty)
        row["is_soft_allocation"] = True
        row["source_expense_id"] = r.get("id")
        row["share_fraction"] = str(frac.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
        row["source_doc"] = (
            f"{r.get('source_doc') or ('Pond consumption #' + str(r.get('id')))} · "
            f"soft {row['share_fraction']} → {cy_name or f'cycle #{production_cycle_id}'}"
        )
        row["memo"] = ((r.get("memo") or "") + f"\n[SOFT-BATCH-ALLOC {row['share_fraction']}]").strip()[:5000]
        out.append(row)

    return out


def sum_soft_allocated_feed_kg_for_cycle(
    company_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int,
    pond_id: int | None = None,
) -> Decimal:
    """Extra feed kg for FCR when filtering by cycle (untagged pond feed soft share)."""
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_category__in=["feed_purchase", "feed_consumed"],
        expense_date__gte=start,
        expense_date__lte=end,
        feed_weight_kg__isnull=False,
        feed_weight_kg__gt=0,
        production_cycle_id__isnull=True,
        pond_id__isnull=False,
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)

    from api.models import AquacultureProductionCycle

    cy = AquacultureProductionCycle.objects.filter(
        pk=production_cycle_id, company_id=company_id
    ).first()
    if not cy:
        return Decimal("0")
    if pond_id is not None and cy.pond_id != pond_id:
        return Decimal("0")
    qs = qs.filter(pond_id=cy.pond_id)

    total = Decimal("0")
    shares_cache: dict[int, list[dict]] = {}
    for exp in qs.only("id", "pond_id", "feed_weight_kg"):
        pid = int(exp.pond_id)
        if pid not in shares_cache:
            shares_cache[pid] = compute_batch_feed_demand_shares(company_id, pid)
        shares = shares_cache[pid]
        if not shares:
            continue
        if len(shares) == 1:
            if int(shares[0]["production_cycle_id"]) == production_cycle_id:
                total += _d(exp.feed_weight_kg)
            continue
        allocated = allocate_feed_kg_across_batches(_d(exp.feed_weight_kg), shares)
        for a in allocated:
            if int(a["production_cycle_id"]) == production_cycle_id:
                total += _d(a.get("allocated_kg"))
                break
    return _q4(total)
