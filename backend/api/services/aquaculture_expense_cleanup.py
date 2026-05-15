"""
Rollback aquaculture expense side-effects (pond warehouse / shop stock + AUTO-AQ-* GL).

Mirrors the spirit of ``cleanup_vendor_bill_posting_effects`` and ``cleanup_invoice_posting_effects``
for fuel-station style inventory + ledger consistency.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Case, F, Value, When

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFeedingAdvice,
    Item,
    JournalEntry,
)
from api.services.aquaculture_pond_stock_service import add_pond_stock
from api.services.item_catalog import item_tracks_physical_stock
from api.services.station_stock import add_station_stock, item_uses_station_bins


def cleanup_aquaculture_expense_posting_effects(company_id: int, expense_id: int) -> None:
    """
    Before deleting an AquacultureExpense: detach feeding advices that pointed at this expense (so
    “Applied” state matches the rolled-back consumption), restore pond or station shop quantities
    from persisted inventory lines, then remove AUTO-AQ-POND- / AUTO-AQ-SHOP- COGS journals.
    """
    with transaction.atomic():
        exp = (
            AquacultureExpense.objects.select_for_update()
            .filter(pk=expense_id, company_id=company_id)
            .first()
        )
        if not exp:
            return

        # Feeding advice apply sets linked_expense; expense FK is SET_NULL on delete, which would
        # orphan an "Applied" row. Revert to approved so the operator can re-apply after undo.
        AquacultureFeedingAdvice.objects.filter(
            company_id=company_id, linked_expense_id=expense_id
        ).update(
            linked_expense_id=None,
            status=Case(
                When(
                    status=AquacultureFeedingAdvice.STATUS_APPLIED,
                    then=Value(AquacultureFeedingAdvice.STATUS_APPROVED),
                ),
                default=F("status"),
            ),
            applied_feed_kg=Case(
                When(status=AquacultureFeedingAdvice.STATUS_APPLIED, then=Value(None)),
                default=F("applied_feed_kg"),
            ),
            applied_at=Case(
                When(status=AquacultureFeedingAdvice.STATUS_APPLIED, then=Value(None)),
                default=F("applied_at"),
            ),
            applied_by_id=Case(
                When(status=AquacultureFeedingAdvice.STATUS_APPLIED, then=Value(None)),
                default=F("applied_by_id"),
            ),
        )

        lines = list(
            AquacultureExpenseInventoryLine.objects.filter(expense_id=expense_id).select_related(
                "item", "source_station"
            )
        )
        for ln in lines:
            it = ln.item
            qty = ln.quantity if ln.quantity is not None else Decimal("0")
            if qty <= 0:
                continue
            st = ln.source_station_id
            if st is not None:
                sid = int(st)
                if item_uses_station_bins(company_id, it):
                    add_station_stock(company_id, sid, int(it.id), qty)
                elif item_tracks_physical_stock(it) and it.quantity_on_hand is not None:
                    Item.objects.filter(pk=it.pk, company_id=company_id).update(
                        quantity_on_hand=F("quantity_on_hand") + qty
                    )
            elif exp.pond_id is not None:
                add_pond_stock(company_id, int(exp.pond_id), int(it.id), qty)

        JournalEntry.objects.filter(
            company_id=company_id,
            entry_number__in=(
                f"AUTO-AQ-POND-{expense_id}-COGS",
                f"AUTO-AQ-SHOP-{expense_id}-COGS",
            ),
        ).delete()
