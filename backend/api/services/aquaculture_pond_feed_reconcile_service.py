"""
Audit and reconcile pond feed: GL journals for consumption, and unused pond-warehouse feed.

Only feed_consumed / shop stock issues (AUTO-AQ-POND-* / AUTO-AQ-SHOP-*) should hit pond feed cost.
Feed sitting at the pond warehouse is inventory (no COGS) until consumed or returned to shop.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFeedingAdvice,
    JournalEntry,
    PondWarehouseStockReceiptLine,
)
from api.services.aquaculture_pond_stock_service import (
    pond_warehouse_stock_matrix,
    transfer_pond_warehouse_to_station,
)
from api.services.gl_posting import (
    post_aquaculture_pond_feed_consumption_journal,
    post_aquaculture_shop_stock_issue_journal,
)
from api.services.gl_posting_audit import (
    find_aquaculture_pond_consumption_gaps,
    find_aquaculture_shop_issue_gaps,
)
from api.services.station_stock import get_or_create_default_station


def _is_feed_row(row: dict) -> bool:
    cat = (row.get("pos_category") or "").strip().lower()
    if cat == "feed":
        return True
    name = (row.get("item_name") or "").lower()
    rc = (row.get("reporting_category") or "").lower()
    return "feed" in name or rc == "feed"


def _resolve_return_station_id(company_id: int, pond_id: int, item_id: int) -> int:
    ln = (
        PondWarehouseStockReceiptLine.objects.filter(
            receipt__company_id=company_id,
            receipt__pond_id=pond_id,
            item_id=item_id,
        )
        .select_related("receipt")
        .order_by("-receipt__created_at", "-receipt_id", "-id")
        .first()
    )
    if ln and ln.receipt and ln.receipt.from_station_id:
        return int(ln.receipt.from_station_id)
    return int(get_or_create_default_station(company_id).id)


def audit_pond_feed_gl_and_stock(company_id: int) -> dict:
    pond_gaps = find_aquaculture_pond_consumption_gaps(company_id)
    shop_gaps = find_aquaculture_shop_issue_gaps(company_id)

    feed_stock = [r for r in pond_warehouse_stock_matrix(company_id) if _is_feed_row(r)]

    # Manual feed_purchase on feeding advice (create_expense path) — counts as pond cost without
    # drawing pond warehouse stock or posting AUTO-AQ-POND/SHOP COGS.
    advice_manual: list[dict] = []
    for adv in (
        AquacultureFeedingAdvice.objects.filter(
            company_id=company_id,
            status=AquacultureFeedingAdvice.STATUS_APPLIED,
            linked_expense_id__isnull=False,
        )
        .select_related("linked_expense", "pond")
        .order_by("-applied_at", "-id")
    ):
        exp = adv.linked_expense
        if not exp:
            continue
        cat = (exp.expense_category or "").strip()
        has_inv = AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).exists()
        if cat == "feed_purchase" and not has_inv and exp.source_station_id is None:
            advice_manual.append(
                {
                    "advice_id": adv.id,
                    "pond_id": adv.pond_id,
                    "pond_name": (adv.pond.name or "").strip() if adv.pond_id and adv.pond else "",
                    "applied_kg": str(adv.applied_feed_kg or "0"),
                    "expense_id": exp.id,
                    "amount": str(exp.amount or "0"),
                    "expense_date": exp.expense_date.isoformat() if exp.expense_date else "",
                    "has_gl": JournalEntry.objects.filter(
                        company_id=company_id, entry_number=f"AUTO-AQ-EXP-{exp.id}"
                    ).exists(),
                }
            )

    applied_no_expense: list[dict] = []
    for adv in AquacultureFeedingAdvice.objects.filter(
        company_id=company_id,
        status=AquacultureFeedingAdvice.STATUS_APPLIED,
        linked_expense_id__isnull=True,
        applied_feed_kg__gt=0,
    ).select_related("pond"):
        applied_no_expense.append(
            {
                "advice_id": adv.id,
                "pond_id": adv.pond_id,
                "pond_name": (adv.pond.name or "").strip() if adv.pond_id and adv.pond else "",
                "applied_kg": str(adv.applied_feed_kg or "0"),
                "target_date": adv.target_date.isoformat() if adv.target_date else "",
            }
        )

    return {
        "pond_consumption_gaps": pond_gaps,
        "shop_issue_gaps": shop_gaps,
        "pond_feed_stock": feed_stock,
        "advice_manual_feed_purchase": advice_manual,
        "advice_applied_without_expense": applied_no_expense,
    }


def backfill_pond_feed_gl_gaps(company_id: int) -> dict[str, int]:
    posted = {"pond_consumption": 0, "shop_issue": 0, "failed": 0}

    for gap in find_aquaculture_pond_consumption_gaps(company_id):
        exp = AquacultureExpense.objects.filter(pk=gap["record_id"], company_id=company_id).first()
        if not exp:
            posted["failed"] += 1
            continue
        line_rows = [
            (ln.item, ln.quantity)
            for ln in AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).select_related(
                "item"
            )
            if ln.item_id and ln.quantity and ln.quantity > 0
        ]
        if post_aquaculture_pond_feed_consumption_journal(
            company_id, exp.id, exp.expense_date, line_rows
        ):
            posted["pond_consumption"] += 1
        else:
            posted["failed"] += 1

    for gap in find_aquaculture_shop_issue_gaps(company_id):
        exp = AquacultureExpense.objects.filter(pk=gap["record_id"], company_id=company_id).first()
        if not exp:
            posted["failed"] += 1
            continue
        line_rows = [
            (ln.item, ln.quantity)
            for ln in AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).select_related(
                "item"
            )
            if ln.item_id and ln.quantity and ln.quantity > 0
        ]
        if post_aquaculture_shop_stock_issue_journal(
            company_id,
            exp.id,
            exp.expense_date,
            exp.source_station_id,
            line_rows,
        ):
            posted["shop_issue"] += 1
        else:
            posted["failed"] += 1

    return posted


@transaction.atomic
def return_pond_feed_stock_to_shop(
    company_id: int,
    *,
    station_id: int | None = None,
    pond_id: int | None = None,
    memo: str = "Return unused pond feed to shop (reconcile)",
) -> list[dict]:
    """
    Move all feed SKUs from pond warehouse back to a shop station. No GL (inventory still on balance sheet).
    """
    actions: list[dict] = []
    feed_rows = [
        r
        for r in pond_warehouse_stock_matrix(company_id, pond_id=pond_id)
        if _is_feed_row(r)
    ]
    by_pond: dict[int, list[dict]] = {}
    for row in feed_rows:
        by_pond.setdefault(int(row["pond_id"]), []).append(row)

    for pid, rows in sorted(by_pond.items()):
        items_payload: list[dict] = []
        for row in rows:
            qty = Decimal(str(row["quantity"]))
            if qty <= 0:
                continue
            items_payload.append({"item_id": int(row["item_id"]), "quantity": str(qty)})
        if not items_payload:
            continue
        st_id = station_id
        if st_id is None:
            st_id = _resolve_return_station_id(company_id, pid, int(rows[0]["item_id"]))
        ret = transfer_pond_warehouse_to_station(
            company_id=company_id,
            pond_id=pid,
            station_id=int(st_id),
            items=items_payload,
            memo=memo,
        )
        actions.append(
            {
                "pond_id": pid,
                "pond_name": rows[0].get("pond_name") or "",
                "station_id": int(st_id),
                "return_id": ret.id,
                "return_number": ret.return_number,
                "lines": items_payload,
            }
        )
    return actions
