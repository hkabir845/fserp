"""
Backfill batch tags on already-used pond feed/medicine (VPS historical data).

Untagged ``feed_consumed`` / ``medicine_consumed`` / purchase rows are split across stocking
batches using sampling biomass × WorldFish %BW demand — same weights as live feeding apply.

Warehouse QOH is not changed (stock was already consumed). COGS journals are rewritten so each
batch-tagged expense keeps its own AUTO-AQ-POND-* entry without double-counting.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFeedingAdvice,
    JournalEntry,
)
from api.services.aquaculture_feeding_advice_service import (
    allocate_decimal_by_weights,
    allocate_feed_kg_across_batches,
    compute_batch_feed_demand_shares,
)
from api.services.gl_posting import (
    post_aquaculture_manual_expense_journal,
    post_aquaculture_pond_feed_consumption_journal,
)

BATCH_CONSUME_RECONCILE_TAG = "[BATCH-CONSUME-RECONCILE]"

_CONSUMPTION_CATS = frozenset(
    {
        "feed_consumed",
        "medicine_consumed",
        "feed_purchase",
        "medicine_purchase",
    }
)


def _d(val) -> Decimal:
    if val is None:
        return Decimal("0")
    return Decimal(str(val))


def _money(val: Decimal) -> Decimal:
    return _d(val).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _qty(val: Decimal) -> Decimal:
    return _d(val).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _already_reconciled(memo: str) -> bool:
    return BATCH_CONSUME_RECONCILE_TAG in (memo or "")


def _untagged_consumption_qs(company_id: int, *, pond_id: int | None = None):
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id__isnull=False,
        production_cycle_id__isnull=True,
        expense_category__in=_CONSUMPTION_CATS,
    ).exclude(memo__contains=BATCH_CONSUME_RECONCILE_TAG)
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    return qs.select_related("pond").order_by("pond_id", "expense_date", "id")


def preview_batch_consumption_reconcile(
    company_id: int,
    *,
    pond_id: int | None = None,
) -> dict[str, Any]:
    """Dry-run summary: how many untagged rows would be tagged or split."""
    rows = list(_untagged_consumption_qs(company_id, pond_id=pond_id))
    would_tag = 0
    would_split = 0
    skip_no_batch = 0
    samples: list[dict] = []
    for exp in rows:
        shares = compute_batch_feed_demand_shares(company_id, int(exp.pond_id))
        if not shares:
            skip_no_batch += 1
            continue
        if len(shares) == 1:
            would_tag += 1
            action = "tag"
        else:
            would_split += 1
            action = "split"
        if len(samples) < 40:
            samples.append(
                {
                    "expense_id": exp.id,
                    "pond_id": exp.pond_id,
                    "pond_name": (exp.pond.name or "").strip() if exp.pond_id else "",
                    "expense_date": exp.expense_date.isoformat() if exp.expense_date else "",
                    "category": exp.expense_category,
                    "amount": str(exp.amount or "0"),
                    "feed_weight_kg": str(exp.feed_weight_kg) if exp.feed_weight_kg is not None else None,
                    "batch_count": len(shares),
                    "action": action,
                }
            )
    return {
        "company_id": company_id,
        "untagged_total": len(rows),
        "would_tag_single_batch": would_tag,
        "would_split_multi_batch": would_split,
        "skip_no_batch_demand": skip_no_batch,
        "sample_rows": samples,
    }


@transaction.atomic
def _rewrite_pond_cogs_journal(company_id: int, expense: AquacultureExpense) -> bool:
    """Drop existing AUTO-AQ-POND journal (if any) and re-post from inventory lines. No stock move."""
    JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-AQ-POND-{expense.id}-COGS",
    ).delete()
    lines = list(
        AquacultureExpenseInventoryLine.objects.filter(expense_id=expense.id).select_related("item")
    )
    if not lines:
        return False
    row_tuples = [
        (ln.item, ln.quantity if ln.quantity is not None else Decimal("0"))
        for ln in lines
        if ln.item is not None and (ln.quantity or 0) > 0
    ]
    if not row_tuples:
        return False
    return bool(
        post_aquaculture_pond_feed_consumption_journal(
            company_id,
            expense_id=expense.id,
            entry_date=expense.expense_date,
            line_rows=row_tuples,
        )
    )


@transaction.atomic
def _tag_single_batch(company_id: int, exp: AquacultureExpense, cycle_id: int) -> str:
    memo = (exp.memo or "").strip()
    if BATCH_CONSUME_RECONCILE_TAG not in memo:
        memo = f"{memo}\n{BATCH_CONSUME_RECONCILE_TAG} tagged cycle #{cycle_id}".strip()[:5000]
    AquacultureExpense.objects.filter(pk=exp.pk, company_id=company_id).update(
        production_cycle_id=cycle_id,
        memo=memo,
    )
    # Refresh aquaculture_line_costing on journal if present (optional — amount unchanged).
    return "tagged"


@transaction.atomic
def _split_multi_batch(
    company_id: int,
    exp: AquacultureExpense,
    shares: list[dict],
) -> list[int]:
    """
    Replace one untagged expense with N cycle-tagged expenses.

    Does **not** restore or re-decrement pond warehouse — physical stock already moved.
    Rewrites AUTO-AQ-POND COGS across the new expense ids when inventory lines exist.
    """
    total_amt = _money(exp.amount)
    total_kg = _d(exp.feed_weight_kg) if exp.feed_weight_kg is not None else None
    total_sacks = _d(exp.feed_sack_count) if exp.feed_sack_count is not None else None
    empty_sacks = _d(exp.empty_sack_count) if exp.empty_sack_count is not None else None

    inv_lines = list(
        AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).select_related("item")
    )
    # Prefer kg weights when available; else amount; else inventory qty.
    if total_kg is not None and total_kg > 0:
        allocated = allocate_feed_kg_across_batches(total_kg, shares)
        weights = [_d(a.get("allocated_kg")) for a in allocated]
        kg_parts = weights
    else:
        weights = [_d(s.get("share_weight") or s.get("daily_demand_kg")) for s in shares]
        kg_parts = None
        allocated = allocate_feed_kg_across_batches(Decimal("1"), shares)  # fractions only

    amt_parts = allocate_decimal_by_weights(total_amt, weights if kg_parts is None else kg_parts)
    sack_parts = (
        allocate_decimal_by_weights(total_sacks, weights if kg_parts is None else kg_parts)
        if total_sacks is not None and total_sacks > 0
        else [None] * len(shares)
    )

    inv_splits: list[list[tuple[Any, Decimal, int | None]]] = [[] for _ in shares]
    for ln in inv_lines:
        qty = _qty(ln.quantity)
        if qty <= 0 or not ln.item_id:
            continue
        w = weights if kg_parts is None else kg_parts
        q_parts = allocate_decimal_by_weights(qty, w, quantize_to=Decimal("0.0001"))
        for i, q in enumerate(q_parts):
            if q > 0:
                inv_splits[i].append((ln.item, q, ln.source_station_id))

    # Delete old COGS / manual journals before removing the parent expense.
    JournalEntry.objects.filter(
        company_id=company_id,
        entry_number__in=(
            f"AUTO-AQ-POND-{exp.id}-COGS",
            f"AUTO-AQ-SHOP-{exp.id}-COGS",
            f"AUTO-AQ-EXP-{exp.id}",
        ),
    ).delete()

    advice_ids = list(
        AquacultureFeedingAdvice.objects.filter(
            company_id=company_id, linked_expense_id=exp.id
        ).values_list("id", flat=True)
    )

    parent_id = exp.id
    pond = exp.pond
    cat = exp.expense_category
    ed = exp.expense_date
    vendor = exp.vendor_name or ""
    funding = exp.funding_account_code or ""
    source_station_id = exp.source_station_id
    base_memo = (exp.memo or "").strip()

    # Remove inventory lines + parent without stock restore.
    AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).delete()
    AquacultureExpense.objects.filter(pk=exp.id, company_id=company_id).delete()

    new_ids: list[int] = []
    primary_id: int | None = None
    primary_kg = Decimal("-1")

    for i, share in enumerate(shares):
        cy_id = int(share["production_cycle_id"])
        cy_name = (share.get("production_cycle_name") or f"Cycle #{cy_id}").strip()
        frac = allocated[i].get("share_fraction") if i < len(allocated) else ""
        amt = amt_parts[i] if i < len(amt_parts) else Decimal("0")
        if amt <= 0 and not inv_splits[i]:
            continue
        kg_val = kg_parts[i] if kg_parts is not None else None
        sack_val = sack_parts[i] if sack_parts and sack_parts[i] is not None else None
        line_memo = (
            f"{base_memo}\n{BATCH_CONSUME_RECONCILE_TAG} from expense #{parent_id} · "
            f"batch {cy_name} ({frac} sampling×WorldFish)"
        ).strip()[:5000]
        child = AquacultureExpense(
            company_id=company_id,
            pond=pond,
            production_cycle_id=cy_id,
            expense_category=cat,
            expense_date=ed,
            amount=amt if amt > 0 else Decimal("0.00"),
            memo=line_memo,
            vendor_name=vendor,
            source_station_id=source_station_id,
            feed_sack_count=sack_val,
            empty_sack_count=None,
            feed_weight_kg=kg_val,
            funding_account_code=funding,
        )
        child.save()
        for item, q, st_id in inv_splits[i]:
            AquacultureExpenseInventoryLine.objects.create(
                expense=child,
                item=item,
                quantity=q,
                source_station_id=st_id,
            )
        if cat in ("feed_consumed", "medicine_consumed") and inv_splits[i]:
            _rewrite_pond_cogs_journal(company_id, child)
        elif funding and cat in ("feed_purchase", "medicine_purchase"):
            post_aquaculture_manual_expense_journal(
                company_id=company_id,
                expense_id=child.id,
                entry_date=ed,
            )
        new_ids.append(child.id)
        compare_kg = kg_val if kg_val is not None else amt
        if compare_kg > primary_kg:
            primary_kg = compare_kg
            primary_id = child.id

    if primary_id is not None and empty_sacks is not None and empty_sacks > 0:
        AquacultureExpense.objects.filter(pk=primary_id).update(empty_sack_count=empty_sacks)

    if advice_ids and primary_id is not None:
        AquacultureFeedingAdvice.objects.filter(company_id=company_id, pk__in=advice_ids).update(
            linked_expense_id=primary_id
        )

    return new_ids


def reconcile_batch_consumption_for_company(
    company_id: int,
    *,
    pond_id: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Tag or split historical untagged feed/medicine expenses for ``company_id``.

    Run on the VPS after deploy::

        python manage.py reconcile_aquaculture_batch_consumption --company-id 1
    """
    preview = preview_batch_consumption_reconcile(company_id, pond_id=pond_id)
    if dry_run:
        return {**preview, "dry_run": True, "tagged": 0, "split": 0, "created_expense_ids": []}

    tagged = 0
    split = 0
    created: list[int] = []
    errors: list[dict] = []

    for exp in list(_untagged_consumption_qs(company_id, pond_id=pond_id)):
        try:
            shares = compute_batch_feed_demand_shares(company_id, int(exp.pond_id))
            if not shares:
                continue
            if len(shares) == 1:
                _tag_single_batch(company_id, exp, int(shares[0]["production_cycle_id"]))
                tagged += 1
            else:
                new_ids = _split_multi_batch(company_id, exp, shares)
                split += 1
                created.extend(new_ids)
        except Exception as ex:  # noqa: BLE001 — continue other ponds on VPS
            errors.append({"expense_id": exp.id, "detail": str(ex)})

    return {
        **preview,
        "dry_run": False,
        "tagged": tagged,
        "split": split,
        "created_expense_ids": created,
        "errors": errors,
    }
