"""Reconstruct dated physical inventory and moving-average cost from source documents.

No use of today's quantity, price or cost in historical valuation. Missing opening
dates and negative reconstructed stock are reported, never silently filled in.
A dated opening replaces earlier movements only when it equals that register.
A tank dip is the measured volume at the end of the dip date.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Q
from django.utils import timezone

from api.models import (
    AquacultureExpense, AquacultureExpenseInventoryLine, AquacultureFishSale,
    BillLine, CreditNote, InventoryAdjustmentLine,
    InventoryTransferLine, InvoiceLine, TankDip,
    PondWarehouseStockReceiptLine, PondWarehouseStockReturnLine,
)
from api.services.aquaculture_empty_sack_service import EMPTY_SACK_INCOME_TYPE, EMPTY_SACK_ITEM_NUMBER
from api.services.gl_posting import _bill_line_receipt_value
from api.services.inventory_cost_evidence import invoice_stock_costs

ZERO = Decimal("0")
_KIND = 9


def historical_inventory_positions(company_id, items, as_of, station_id=None):
    items = list(items)
    by_id = {item.id: item for item in items}
    ids = set(by_id)
    # date, creation time, document/line order, item, quantity, receipt value,
    # station, destination (transfer only), fixed outgoing cost, kind
    events = []
    warnings = defaultdict(set)
    dips = []

    horizon = max(as_of, timezone.localdate())

    def relevant(day, iid):
        return iid in ids and day <= horizon

    def add(day, created, pk, iid, qty, value=None, site=None, destination=None, cost=None, kind="move"):
        if relevant(day, iid):
            events.append((day, str(created or ""), pk, iid, qty, value, site, destination, cost, kind))

    for item in items:
        qty = item.opening_stock_quantity or ZERO
        if qty:
            opening_on = item.opening_balance_date
            if opening_on is None:
                warnings[item.id].add("Opening quantity has no effective date; historical opening is unknown.")
            else:
                add(opening_on, "", item.id, item.id, qty, qty * item.opening_stock_unit_cost, kind="opening")
                if station_id is not None and opening_on <= as_of:
                    warnings[item.id].add("Opening stock has no historical station allocation.")

    receipts = list(BillLine.objects.filter(
        bill__company_id=company_id, bill__bill_date__lte=as_of,
        bill__stock_receipt_applied=True, bill__internal_fish_transfer_line__isnull=True,
        item_id__in=ids,
    ).exclude(bill__status__in=("draft", "void")).select_related("bill", "tank"))
    siblings = defaultdict(list)
    for line in BillLine.objects.filter(bill_id__in={line.bill_id for line in receipts}).select_related("item"):
        siblings[line.bill_id].append(line)
    for line in receipts:
        if not relevant(line.bill.bill_date, line.item_id):
            continue
        site = line.receipt_station_id or (line.tank.station_id if line.tank_id else None) or line.bill.receipt_station_id
        if station_id is not None and site is None:
            warnings[line.item_id].add("A stock receipt has no recorded station allocation.")
        add(line.bill.bill_date, line.bill.created_at, line.id, line.item_id,
            line.quantity, _bill_line_receipt_value(line.bill, line, siblings=siblings[line.bill_id]), site)

    sales = list(InvoiceLine.objects.filter(
        invoice__company_id=company_id, invoice__invoice_date__lte=as_of,
        invoice__internal_fish_transfer_line__isnull=True, item_id__in=ids,
    ).exclude(invoice__status__in=("draft", "void")).select_related("invoice", "nozzle__tank"))
    sale_costs = invoice_stock_costs(company_id, sales)
    for line in sales:
        if not relevant(line.invoice.invoice_date, line.item_id):
            continue
        qty = line.stock_relieved_quantity or ZERO
        if not qty and line.nozzle_id:
            qty = line.quantity
        if not qty:
            if line.quantity > 0:
                warnings[line.item_id].add("An invoice has no recorded physical stock-relief quantity; verify its historical movement.")
            continue
        site = line.stock_relieved_station_id or line.receipt_station_id or line.invoice.station_id
        if site is None and line.nozzle_id:
            site = line.nozzle.tank.station_id
        cost = sale_costs.get(line.id)
        unit_cost = cost / line.quantity if cost is not None and line.quantity > 0 else None
        if unit_cost is None:
            warnings[line.item_id].add("A sale has no exact original cost evidence; its value uses reconstructed historical average cost.")
        add(line.invoice.invoice_date, line.invoice.created_at, line.id, line.item_id, -qty, site=site, cost=unit_cost)

    for line in InventoryAdjustmentLine.objects.filter(
        adjustment__company_id=company_id, adjustment__status="posted",
        adjustment__adjustment_date__lte=as_of, item_id__in=ids,
    ).select_related("adjustment"):
        if not relevant(line.adjustment.adjustment_date, line.item_id):
            continue
        if line.book_quantity is None:
            warnings[line.item_id].add("A posted stock adjustment has no original book quantity.")
            continue
        delta = line.counted_quantity - line.book_quantity
        add(line.adjustment.adjustment_date, line.adjustment.created_at, line.id, line.item_id,
            delta, delta * line.unit_cost if delta > 0 and line.unit_cost is not None else None,
            line.adjustment.station_id, cost=line.unit_cost)

    for line in InventoryTransferLine.objects.filter(
        transfer__company_id=company_id, transfer__status="posted",
        transfer__transfer_date__lte=as_of, item_id__in=ids,
    ).select_related("transfer"):
        add(line.transfer.transfer_date, line.transfer.created_at, line.id, line.item_id,
            line.quantity, site=line.transfer.from_station_id, destination=line.transfer.to_station_id)

    for line in PondWarehouseStockReceiptLine.objects.filter(
        receipt__company_id=company_id, receipt__transfer_date__lte=as_of, item_id__in=ids,
    ).select_related("receipt"):
        add(line.receipt.transfer_date, line.receipt.created_at, line.id, line.item_id,
            line.quantity, site=line.receipt.from_station_id, destination=-line.receipt.pond_id)
    for line in PondWarehouseStockReturnLine.objects.filter(
        stock_return__company_id=company_id, stock_return__transfer_date__lte=as_of, item_id__in=ids,
    ).select_related("stock_return"):
        add(line.stock_return.transfer_date, line.stock_return.created_at, line.id, line.item_id,
            line.quantity, site=-line.stock_return.pond_id, destination=line.stock_return.to_station_id)

    for dip in TankDip.objects.filter(
        company_id=company_id, dip_date__lte=as_of, tank__product_id__in=ids,
    ).select_related("tank"):
        if dip.book_stock_before is None:
            warnings[dip.tank.product_id].add("A tank dip has no original book volume.")
            continue
        dips.append(dip)

    empty = next((item for item in items if item.item_number == EMPTY_SACK_ITEM_NUMBER), None)
    if empty is not None:
        for expense in AquacultureExpense.objects.filter(
            company_id=company_id, empty_sack_count__gt=0, expense_date__lte=as_of,
        ):
            add(expense.expense_date, expense.created_at, expense.id, empty.id, expense.empty_sack_count,
                ZERO, site=-expense.pond_id if expense.pond_id else None, kind="zero_value")
        sack_sales = AquacultureFishSale.objects.filter(
            company_id=company_id, income_type=EMPTY_SACK_INCOME_TYPE, sale_date__lte=as_of,
        ).filter(Q(invoice__isnull=True) | ~Q(invoice__status__in=("draft", "void")))
        for sale in sack_sales:
            if sale.weight_kg and sale.weight_kg > 0:
                add(sale.sale_date, sale.created_at, sale.id, empty.id, -sale.weight_kg,
                    site=-sale.pond_id if sale.pond_id else None)

    for line in AquacultureExpenseInventoryLine.objects.filter(
        expense__company_id=company_id, expense__expense_date__lte=as_of, item_id__in=ids,
    ).select_related("expense"):
        add(line.expense.expense_date, line.expense.created_at, line.id,
            line.item_id, -line.quantity, site=line.source_station_id)

    # Credit-note stock restoration follows the original invoice's proportional quantities.
    for note in CreditNote.objects.filter(
        company_id=company_id, credit_date__lte=as_of, status="posted", stock_restored=True,
    ).select_related("invoice").prefetch_related("invoice__lines"):
        if note.stock_movement_evidence:
            for movement in note.stock_movement_evidence:
                iid = movement["item_id"]
                if iid not in ids:
                    continue
                if not relevant(note.credit_date, iid):
                    continue
                value = movement.get("cost_amount")
                if value is None:
                    warnings[iid].add("Returned stock has no exact original cost evidence.")
                add(note.credit_date, note.created_at, movement["invoice_line_id"], iid,
                    Decimal(movement["quantity"]), Decimal(value) if value is not None else None,
                    movement.get("station_id"))
            continue
        if note.invoice.total <= 0:
            continue
        fraction = note.amount / note.invoice.total
        original_lines = list(note.invoice.lines.all())
        return_costs = invoice_stock_costs(company_id, original_lines)
        for line in original_lines:
            if line.item_id in ids:
                if not relevant(note.credit_date, line.item_id):
                    continue
                qty = (line.stock_relieved_quantity * fraction).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
                if qty <= 0:
                    continue
                value = (return_costs[line.id] * fraction).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if line.id in return_costs else None
                if value is None:
                    warnings[line.item_id].add("Returned stock has no exact original cost evidence; verify its cost against the credit-note journal.")
                add(note.credit_date, note.created_at, line.id, line.item_id, qty, value,
                    site=line.stock_relieved_station_id or note.invoice.station_id)

    # A dated opening is a cutover only when it matches the register already saved
    # before that date. A conflicting opening is omitted; the receipts and issues stay.
    for opening in [event for event in events if event[_KIND] == "opening"]:
        day, iid, opening_qty = opening[0], opening[3], opening[4]
        prior = [event for event in events if event[3] == iid and event[_KIND] == "move" and event[7] is None and event[0] < day]
        prior_qty = sum((event[4] for event in prior), ZERO)
        if prior and prior_qty == opening_qty:
            events = [event for event in events if not (event[3] == iid and event[_KIND] == "move" and event[0] < day)]
        elif prior:
            events = [event for event in events if event is not opening]

    # A stick reading is the physical volume only when later documents bring that
    # volume to today's on-hand. Otherwise the dip remains a variance on the register.
    # Today's quantity is the check, never a replacement value.
    latest_dip = {}
    for dip in dips:
        current = latest_dip.get(dip.tank_id)
        if current is None or (dip.dip_date, dip.id) >= (current.dip_date, current.id):
            latest_dip[dip.tank_id] = dip
    dips_by_item = defaultdict(list)
    for dip in latest_dip.values():
        dips_by_item[dip.tank.product_id].append(dip)
    verified_dips = {}
    today = timezone.localdate()
    for iid, item_dips in dips_by_item.items():
        if len(item_dips) != 1:
            continue
        dip = item_dips[0]
        projected = dip.volume + sum(
            (event[4] for event in events
             if event[3] == iid and event[7] is None and event[_KIND] != "dip" and dip.dip_date < event[0] <= today),
            ZERO,
        )
        if projected == (by_id[iid].quantity_on_hand or ZERO):
            verified_dips[iid] = dip
    for iid, dip in verified_dips.items():
        events = [event for event in events if not (event[3] == iid and event[0] <= dip.dip_date)]
        events.append((dip.dip_date, "9999-dip", dip.id, iid, dip.volume, None, dip.tank.station_id, None, None, "dip"))
    for dip in dips:
        iid = dip.tank.product_id
        if iid in verified_dips:
            continue
        opening_day = next((event[0] for event in events if event[3] == iid and event[_KIND] == "opening"), None)
        if opening_day is not None and dip.dip_date < opening_day:
            continue
        events.append((dip.dip_date, str(dip.created_at or ""), dip.id, iid,
            dip.volume - dip.book_stock_before, None, dip.tank.station_id, None, None, "move"))

    positions = {iid: {"quantity": ZERO, "value": ZERO, "unit_cost": ZERO} for iid in ids}
    sites = defaultdict(lambda: ZERO)
    for day, created, pk, iid, delta, receipt_value, site, destination, fixed_cost, kind in sorted(events, key=lambda e: e[:4]):
        if day > as_of:
            continue
        p = positions[iid]
        if kind == "dip":
            p["quantity"] = delta
            p["value"] = ZERO
            p["unit_cost"] = ZERO
            sites[(iid, site)] = delta
            continue
        if destination is not None:
            sites[(iid, site)] -= delta
            sites[(iid, destination)] += delta
            continue
        cost = fixed_cost if fixed_cost is not None else p["unit_cost"]
        if delta > 0:
            amount = receipt_value if receipt_value is not None else delta * cost
            if amount <= 0 and kind != "zero_value":
                warnings[iid].add("A stock increase has no recorded cost basis.")
            p["value"] += amount
        else:
            p["value"] += delta * cost
        p["quantity"] += delta
        sites[(iid, site)] += delta
        if p["quantity"] < 0:
            warnings[iid].add(f"Source documents produce negative inventory on {day.isoformat()}.")
        elif p["quantity"] == 0:
            if abs(p["value"]) >= Decimal("0.01"):
                warnings[iid].add("Zero physical stock has a residual carrying value; reconcile original costs and quantities.")
            p["value"] = ZERO
        else:
            if p["value"] < 0:
                warnings[iid].add("Positive stock has a negative carrying value; reconcile original costs and openings.")
            p["unit_cost"] = p["value"] / p["quantity"]

    for iid, p in positions.items():
        if station_id is not None:
            p["quantity"] = sites[(iid, station_id)]
            p["value"] = p["quantity"] * p["unit_cost"]
            if p["quantity"] < 0:
                warnings[iid].add("Reconstructed station stock is negative; verify dated station allocations.")
        elif as_of == timezone.localdate():
            # Compare like dates only, for coverage diagnostics; never use live stock
            # to manufacture a historical opening or replace reconstructed quantities.
            actual = by_id[iid].quantity_on_hand or ZERO
            if p["quantity"] != actual:
                warnings[iid].add("Reconstructed closing quantity does not match current physical stock; verify opening and movement records.")
        p["warnings"] = sorted(warnings[iid])
        p["is_complete"] = not p["warnings"]
    return positions
