"""
Paper for an inter-pond fish sale: an invoice from the selling pond and a bill for the buying one.

Each pond is a profit centre, so when fish move the trade deserves the same evidence an outside
sale gets. For every priced transfer line this raises a matched pair:

- an **Invoice** from the selling pond to the buying pond's customer identity (``pond.pos_customer``)
- a **Bill** for the buying pond against the selling pond's vendor identity (``pond.internal_vendor``)

Both are marked ``paid`` on creation and settle through the inter-pond current account, never in
cash — no internal balance ages in A/R or A/P, which is what the two identities being flagged
``is_internal`` is for.

**These documents never post GL and never move stock.** The economics of the move are already
carried, pond by pond, by the transfer's own journal (Dr 1581 buyer / Cr 4245 / Dr 5245 / Cr 1581
seller — see ``gl_posting.post_aquaculture_fish_pond_transfer_journal``). Letting the documents
post as well would count the same sale twice, and a posted bill carrying a fish item would inflate
the buying pond's fish stock on top of the transfer that already moved it. The guards live in
``gl_posting.bill_eligible_for_posting``, ``gl_posting.sync_invoice_gl`` and
``aquaculture_auto_biomass_sample.sync_biomass_samples_from_bill``, all keyed on
``internal_fish_transfer_line``.

Document lines are deliberately item-less: the description carries the fish, so nothing touches
the item catalog, inventory, or COGS machinery.

Deleting a transfer or one of its lines removes the matching documents through the FK cascade.
"""
from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal

from api.models import (
    AquaculturePond,
    Bill,
    BillLine,
    Invoice,
    InvoiceLine,
)
from api.services.aquaculture_constants import fish_species_display_label
from api.services.aquaculture_pond_internal_vendor import (
    mark_pond_pos_customer_internal,
    maybe_provision_auto_internal_vendor,
)
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer

logger = logging.getLogger(__name__)

INVOICE_NUMBER_PREFIX = "IPT-INV"
BILL_NUMBER_PREFIX = "IPT-BILL"

SETTLEMENT_NOTE = (
    "Inter-pond trade — settled through the inter-pond current account, not in cash. "
    "Company profit excludes this sale until the fish are sold outside."
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _d(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (TypeError, ValueError):
        return Decimal("0")


def _line_description(transfer, line, *, selling: str, buying: str) -> str:
    species = fish_species_display_label(
        transfer.fish_species or "", transfer.fish_species_other or ""
    )
    head = f"{int(line.fish_count):,} head, " if line.fish_count else ""
    return (
        f"{species or 'Fish'} — {head}{_d(line.weight_kg).normalize()} kg from {selling} to {buying}"
    )[:300]


def _trading_identities(company_id: int, pond) -> tuple[int | None, int | None]:
    """
    (selling vendor id, buying customer id) for a pond, provisioning them if they are missing.

    Ponds created before the trading identities existed — or through paths that skip the
    provisioning hook — would otherwise have no way to trade, so give them their faces here
    rather than silently dropping the paperwork.
    """
    if not pond:
        return None, None
    if not pond.internal_vendor_id or not pond.pos_customer_id:
        try:
            maybe_provision_auto_internal_vendor(
                company_id=company_id, pond=pond, skip_auto=False
            )
            maybe_provision_auto_pos_customer(company_id=company_id, pond=pond, skip_auto=False)
            mark_pond_pos_customer_internal(pond)
            pond.refresh_from_db()
        except Exception:
            logger.exception(
                "Could not provision trading identities for pond #%s.", getattr(pond, "id", None)
            )
    return pond.internal_vendor_id, pond.pos_customer_id


def _delete_pair(line_id: int) -> None:
    Invoice.all_objects.filter(internal_fish_transfer_line_id=line_id).delete()
    Bill.all_objects.filter(internal_fish_transfer_line_id=line_id).delete()


def _upsert_invoice(company_id: int, transfer, line, *, customer_id: int, description: str) -> None:
    """Selling pond's invoice to the buying pond."""
    amount = _money_q(_d(line.sale_amount))
    inv, _created = Invoice.all_objects.update_or_create(
        internal_fish_transfer_line_id=line.id,
        defaults={
            "company_id": company_id,
            "customer_id": customer_id,
            "invoice_number": f"{INVOICE_NUMBER_PREFIX}-{line.id}",
            "invoice_date": transfer.transfer_date,
            "due_date": transfer.transfer_date,
            "status": "paid",
            "subtotal": amount,
            "tax_total": Decimal("0.00"),
            "total": amount,
            "payment_method": "internal_settlement",
        },
    )
    inv.lines.all().delete()
    InvoiceLine.objects.create(
        invoice=inv,
        item=None,
        description=description,
        quantity=_d(line.weight_kg),
        unit_price=_money_q(_d(line.sale_rate_per_kg)),
        amount=amount,
    )


def _upsert_bill(company_id: int, transfer, line, *, vendor_id: int, description: str) -> None:
    """Buying pond's bill from the selling pond."""
    amount = _money_q(_d(line.sale_amount))
    bill, _created = Bill.all_objects.update_or_create(
        internal_fish_transfer_line_id=line.id,
        defaults={
            "company_id": company_id,
            "vendor_id": vendor_id,
            "bill_number": f"{BILL_NUMBER_PREFIX}-{line.id}",
            "bill_date": transfer.transfer_date,
            "due_date": transfer.transfer_date,
            "status": "paid",
            "subtotal": amount,
            "tax_total": Decimal("0.00"),
            "total": amount,
            "memo": SETTLEMENT_NOTE,
            # Never true for an internal document: the transfer moved the fish, not this bill.
            "stock_receipt_applied": False,
            "vendor_ap_incremented": False,
        },
    )
    bill.lines.all().delete()
    # Deliberately untagged: an aquaculture_pond_id here would enter the buying pond's expense
    # register and cost-per-kg pool on top of the 1581 the transfer already capitalized — the
    # same cost twice, and an inflated cost/kg that would feed the next transfer's price. The
    # pond context lives on internal_fish_transfer_line and in the description.
    BillLine.objects.create(
        bill=bill,
        item=None,
        description=description,
        quantity=_d(line.weight_kg),
        unit_price=_money_q(_d(line.sale_rate_per_kg)),
        amount=amount,
    )


def sync_internal_trade_documents(company_id: int, transfer) -> dict:
    """
    Raise (or refresh) the invoice/bill pair for every priced line of a transfer.

    A line with no price, or a pond missing its trading identity, gets no documents and any stale
    pair is removed. Never raises — paperwork must not roll back the transfer that produced it.
    """
    made = 0
    skipped: list[str] = []
    try:
        lines = list(transfer.lines.select_related("to_pond").all())
        seller = AquaculturePond.objects.filter(
            pk=transfer.from_pond_id, company_id=company_id
        ).first()
        seller_vendor_id, _ = _trading_identities(company_id, seller)
        seller_name = (getattr(seller, "name", "") or "").strip() or "source pond"

        for line in lines:
            amount = _money_q(_d(line.sale_amount))
            buyer = getattr(line, "to_pond", None)
            _, buyer_customer_id = _trading_identities(company_id, buyer)
            buyer_name = (getattr(buyer, "name", "") or "").strip() or "destination pond"

            if amount <= 0:
                _delete_pair(line.id)
                continue
            if not seller_vendor_id or not buyer_customer_id:
                _delete_pair(line.id)
                skipped.append(
                    f"{seller_name} to {buyer_name}: a pond is missing its internal trading party."
                )
                continue

            description = _line_description(
                transfer, line, selling=seller_name, buying=buyer_name
            )
            _upsert_invoice(
                company_id,
                transfer,
                line,
                customer_id=buyer_customer_id,
                description=description,
            )
            _upsert_bill(
                company_id, transfer, line, vendor_id=seller_vendor_id, description=description
            )
            made += 1
    except Exception:
        logger.exception(
            "Internal trade documents failed for transfer #%s; the transfer itself is unaffected.",
            getattr(transfer, "id", None),
        )
    return {"documents": made, "skipped": skipped}


def internal_trade_documents_for_transfer(transfer) -> list[dict]:
    """Invoice/bill numbers per line, for the transfer API payload."""
    out: list[dict] = []
    for line in transfer.lines.all():
        inv = Invoice.all_objects.filter(internal_fish_transfer_line_id=line.id).first()
        bill = Bill.all_objects.filter(internal_fish_transfer_line_id=line.id).first()
        if not inv and not bill:
            continue
        out.append(
            {
                "line_id": line.id,
                "to_pond_id": line.to_pond_id,
                "invoice_id": inv.id if inv else None,
                "invoice_number": inv.invoice_number if inv else None,
                "bill_id": bill.id if bill else None,
                "bill_number": bill.bill_number if bill else None,
                "amount": str(_money_q(_d(line.sale_amount))),
            }
        )
    return out
