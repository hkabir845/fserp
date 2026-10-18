"""Read original posted costs; never replace missing history with today's item cost."""
from decimal import Decimal, ROUND_HALF_UP

from api.models import InvoiceLine, JournalEntryLine


def invoice_stock_costs(company_id, lines):
    """Return line-id -> posted cost, including provable single-item legacy journals.

    A multi-item aggregate journal cannot prove individual historical costs. Such
    rows remain unresolved unless they have the per-line posting snapshot.
    """
    by_invoice = {}
    costs = {}
    for line in lines:
        by_invoice.setdefault(line.invoice_id, []).append(line)
        if line.stock_cost_amount is not None:
            costs[line.id] = line.stock_cost_amount
    missing = {iid for iid, rows in by_invoice.items() if any(row.id not in costs for row in rows)}
    if not missing:
        return costs
    # All invoice lines must be considered before calling a legacy journal single-item.
    all_lines = {}
    for line in InvoiceLine.objects.filter(invoice_id__in=missing, invoice__company_id=company_id).order_by("id"):
        if line.quantity > 0:
            all_lines.setdefault(line.invoice_id, []).append(line)
    names = {f"AUTO-INV-{iid}-COGS": iid for iid in missing}
    totals = {}
    for row in JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id, journal_entry__is_posted=True,
        journal_entry__entry_number__in=names, credit__gt=0,
    ).values("journal_entry__entry_number", "credit"):
        iid = names[row["journal_entry__entry_number"]]
        totals[iid] = totals.get(iid, Decimal("0")) + row["credit"]
    for iid, rows in all_lines.items():
        if any(row.stock_cost_amount is not None for row in rows):
            continue
        if not rows or None in {row.item_id for row in rows} or len({row.item_id for row in rows}) != 1 or iid not in totals:
            continue
        qty = sum((row.quantity for row in rows), Decimal("0"))
        running = Decimal("0")
        for index, row in enumerate(rows):
            cost = (totals[iid] - running if index == len(rows) - 1 else
                    (totals[iid] * row.quantity / qty).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            running += cost
            costs.setdefault(row.id, cost)
    return costs
