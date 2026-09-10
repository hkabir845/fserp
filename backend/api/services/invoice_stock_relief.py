"""Move physical stock when a customer invoice recognises revenue.

The POS path has always decremented stock as part of the sale. Invoices raised anywhere else
did not: ``post_invoice_cogs_journal`` still credited the inventory asset for any line carrying
an inventory item, so the ledger said the goods had gone while quantity on hand said they were
still on the shelf. The control account drifted credit, the valuation report disagreed with it,
and nothing stopped the same units being sold again.

Relief is recorded on ``Invoice.stock_relieved`` — the mirror of ``Bill.stock_receipt_applied``
— so it happens exactly once per invoice and can be unwound exactly once when the invoice is
edited, voided or deleted.

Two kinds of line are deliberately out of scope here:

* **Nozzle lines.** Fuel dispensed through a pump moves wet stock on the tank, which the POS
  path already does and ``rollback_invoice_posting_effects`` already restores.
* **Tank-backed SKUs without a nozzle.** ``Item.quantity_on_hand`` is a derived mirror of tank
  stock (see ``refresh_item_quantity_on_hand_from_tanks``); writing it directly would put it
  out of step with the tanks it is derived from. Wet stock leaves through a nozzle or a dip.

Scope: lines for items with a **real cost basis** — a carried cost, an opening cost, or an
actual posted purchase (``item_has_cost_basis``). Those are the SKUs the tenant is genuinely
managing as inventory, and for them an oversell is a real error, exactly as it already is at
the POS. Items with no cost basis are excluded on purpose: their COGS is estimated from the
selling price, so enforcing stock on them would block sales without making any number truer.
That residual gap is tracked as A0-5 in `docs/ACCOUNTING_AUDIT_BACKLOG.md`.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import F

from api.models import Invoice, InvoiceLine, Item
from api.services.inventory_validation import assert_pos_general_lines_within_qoh
from api.services.item_catalog import item_tracks_physical_stock
from api.services.station_stock import (
    add_station_stock,
    decrement_station_lines,
    item_uses_station_bins,
    tanks_exist_for_item,
)

__all__ = [
    "invoice_stock_lines",
    "apply_invoice_stock_relief",
    "undo_invoice_stock_relief",
]


def _line_moves_stock(company_id: int, line: InvoiceLine) -> bool:
    from api.services.gl_posting import item_has_cost_basis

    it = line.item
    if it is None:
        return False
    if getattr(line, "nozzle_id", None):
        return False  # wet stock leaves through the tank, not here
    if not item_tracks_physical_stock(it):
        return False  # services and non-inventory items have nothing to relieve
    if not item_uses_station_bins(company_id, it) and tanks_exist_for_item(company_id, it.id):
        return False  # tank-backed: quantity_on_hand is derived from the tanks
    if not item_has_cost_basis(company_id, it):
        # No real cost basis — no carried cost, no opening cost, never purchased. COGS for
        # such a line is estimated from the selling price (see item_cogs_unit_cost), which
        # means the tenant is not managing this SKU as inventory at all. Enforcing stock on
        # it would block sales without making any number more true.
        return False
    qty = line.quantity or Decimal("0")
    return qty > 0


def invoice_stock_lines(company_id: int, invoice_id: int) -> list[dict]:
    """The lines of this invoice that should move physical stock, in POS ``lines_data`` shape."""
    rows: list[dict] = []
    for line in InvoiceLine.objects.filter(invoice_id=invoice_id).select_related("item"):
        if not _line_moves_stock(company_id, line):
            continue
        rows.append({"item": line.item, "quantity": line.quantity or Decimal("0")})
    return rows


def apply_invoice_stock_relief(company_id: int, inv: Invoice) -> bool:
    """Decrement stock for a posted invoice. Idempotent; returns True when it moved stock.

    Raises ``StockBusinessError`` when the sale would take stock below zero, so the caller's
    transaction rolls back rather than recording a sale of goods that are not there.
    """
    if inv is None or inv.id is None:
        return False
    status = (inv.status or "").strip().lower()
    if status in ("draft", "void"):
        return False
    if (inv.total or Decimal("0")) <= 0:
        return False

    with transaction.atomic():
        locked = (
            Invoice.all_objects.select_for_update()
            .filter(pk=inv.id, company_id=company_id)
            .first()
        )
        if locked is None or locked.stock_relieved:
            return False
        lines_data = invoice_stock_lines(company_id, locked.id)
        if not lines_data:
            # Nothing physical on this invoice. The zero line evidence prevents a later
            # catalog edit (for example adding cost) from inventing a reversal movement.
            Invoice.all_objects.filter(pk=locked.id).update(stock_relieved=True)
            return False

        station_id = locked.station_id
        # Raises StockBusinessError when a line exceeds what is on hand.
        assert_pos_general_lines_within_qoh(company_id, lines_data, station_id)

        if station_id is not None:
            decrement_station_lines(company_id, int(station_id), lines_data)
        for d in lines_data:
            it: Item = d["item"]
            if item_uses_station_bins(company_id, it):
                continue  # handled by decrement_station_lines
            if it.quantity_on_hand is None:
                continue
            Item.objects.filter(pk=it.pk, company_id=company_id).update(
                quantity_on_hand=F("quantity_on_hand") - d["quantity"]
            )
        for line in InvoiceLine.objects.filter(invoice_id=locked.id):
            relieved = line.quantity if _line_moves_stock(company_id, line) else Decimal("0")
            station_evidence = (
                int(station_id)
                if relieved > 0 and station_id is not None and item_uses_station_bins(company_id, line.item)
                else None
            )
            InvoiceLine.objects.filter(pk=line.pk).update(
                stock_relieved_quantity=relieved,
                stock_relieved_station_id=station_evidence,
            )
        Invoice.all_objects.filter(pk=locked.id).update(stock_relieved=True)
        inv.stock_relieved = True
        return True


def undo_invoice_stock_relief(company_id: int, invoice_id: int) -> bool:
    """Put the stock back. Idempotent: only an invoice flagged as relieved is restored."""
    with transaction.atomic():
        locked = (
            Invoice.all_objects.select_for_update()
            .filter(pk=invoice_id, company_id=company_id)
            .first()
        )
        if locked is None or not locked.stock_relieved:
            return False
        station_id = locked.station_id
        lines = InvoiceLine.objects.filter(
            invoice_id=invoice_id, stock_relieved_quantity__gt=0
        ).select_related("item")
        for line in lines:
            it = line.item
            qty = line.stock_relieved_quantity or Decimal("0")
            if it is None or qty <= 0:
                continue
            if line.stock_relieved_station_id is not None:
                add_station_stock(
                    company_id, int(line.stock_relieved_station_id), int(it.id), qty
                )
                continue
            if it.quantity_on_hand is None:
                continue
            Item.objects.filter(pk=it.pk, company_id=company_id).update(
                quantity_on_hand=F("quantity_on_hand") + qty
            )
        InvoiceLine.objects.filter(invoice_id=invoice_id).update(
            stock_relieved_quantity=0, stock_relieved_station_id=None
        )
        Invoice.all_objects.filter(pk=invoice_id).update(stock_relieved=False)
        return True
