"""
GL for an inter-pond fish sale carried by its invoice and bill, not by a transfer journal.

Ponds trade with each other the way they trade with anyone else: the selling pond raises an
invoice, the buying pond records a bill. This module posts those two documents.

The pair settles through **1595 Inter-Pond Current Account**, never in cash, so no internal
balance ever ages in real A/R or A/P:

Seller's invoice — ``AUTO-IPT-INV-{transfer_id}-{line_id}``, every line tagged to the seller::

    Dr 1595  price   the buying pond owes it
    Cr 4245  price   internal fish revenue
    Dr 5245  cost    internal cost of sales
    Cr 1581  cost    fish leave at book cost

Buyer's bill — ``AUTO-IPT-BILL-{transfer_id}-{line_id}``, tagged to the buying pond::

    Dr 1581  price   the fish arrive at what the pond paid for them
    Cr 1595  price   owed to the selling pond

Company-wide the two 1595 legs cancel, so the net GL is exactly what the old transfer journal
produced (``gl_posting.post_aquaculture_fish_pond_transfer_journal``) — this is a re-papering,
not a restatement. What it adds is a counterpart on each side: under the transfer journal the
buying pond received 1581 with nothing to offset it, which is why per-pond trial balances never
balanced. Now they do.

Consolidation still removes the margin: ``internal_trade_elimination`` nets 4245/5245 and writes
the unsold profit down through 1585, so company profit only moves when the fish leave the company.

These journals do not touch fish stock. The documents are the money; biomass and head count move
through the stock ledger and sampling as they always did.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db.models import Q

from api.models import AquaculturePond, ChartOfAccount, JournalEntry
from api.services.gl_posting import _create_posted_entry
from api.utils.rounding import money

logger = logging.getLogger(__name__)

CODE_BIO_INVENTORY = "1581"
CODE_INTERPOND_CURRENT = "1595"
CODE_INTERNAL_REVENUE = "4245"
CODE_INTERNAL_COGS = "5245"

INVOICE_ENTRY_PREFIX = "AUTO-IPT-INV"
BILL_ENTRY_PREFIX = "AUTO-IPT-BILL"


def _d(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (TypeError, ValueError):
        return Decimal("0")


def _accounts(company_id: int) -> dict[str, ChartOfAccount] | None:
    """The four accounts an inter-pond sale needs, or None when the chart is not seeded for it."""
    wanted = (
        CODE_BIO_INVENTORY,
        CODE_INTERPOND_CURRENT,
        CODE_INTERNAL_REVENUE,
        CODE_INTERNAL_COGS,
    )
    found = {
        a.account_code: a
        for a in ChartOfAccount.objects.filter(
            company_id=company_id, account_code__in=wanted, is_active=True
        )
    }
    missing = [c for c in wanted if c not in found]
    if missing:
        logger.warning(
            "inter-pond trade posting needs chart accounts %s; company %s is missing %s",
            ", ".join(wanted),
            company_id,
            ", ".join(missing),
        )
        return None
    return found


def _pond_name(pond: AquaculturePond | None, fallback: str) -> str:
    return (getattr(pond, "name", "") or "").strip() or fallback


def internal_trade_entry_numbers(transfer_id: int, line_id: int) -> tuple[str, str]:
    """
    Entry numbers for one traded line.

    The transfer id is part of the number on purpose: editing a trade deletes its lines and
    recreates them with new ids, so a number keyed only on the line would strand the previous
    journals — posted money with no document behind it, and the trade counted twice. Keying on
    the transfer lets ``delete_internal_trade_journals_for_transfer`` clear the whole trade first.
    """
    return (
        f"{INVOICE_ENTRY_PREFIX}-{transfer_id}-{line_id}",
        f"{BILL_ENTRY_PREFIX}-{transfer_id}-{line_id}",
    )


def internal_trade_documents_posted(company_id: int, transfer_id: int, line_id: int) -> bool:
    inv_en, bill_en = internal_trade_entry_numbers(transfer_id, line_id)
    return JournalEntry.objects.filter(
        company_id=company_id, entry_number__in=[inv_en, bill_en]
    ).count() == 2


def delete_internal_trade_journals_for_transfer(company_id: int, transfer_id: int) -> int:
    """
    Remove every journal raised for this trade, whichever line ids it was posted against.

    Also clears the first-generation numbering (``AUTO-IPT-INV-{line}``) so a tenant converted
    before the transfer id was added to the number is cleaned up rather than double counted.
    """
    from api.models import AquacultureFishPondTransferLine

    qs = JournalEntry.objects.filter(company_id=company_id).filter(
        Q(entry_number__startswith=f"{INVOICE_ENTRY_PREFIX}-{transfer_id}-")
        | Q(entry_number__startswith=f"{BILL_ENTRY_PREFIX}-{transfer_id}-")
    )
    deleted, _ = qs.delete()

    legacy_line_ids = list(
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).values_list(
            "id", flat=True
        )
    )
    if legacy_line_ids:
        legacy_numbers: list[str] = []
        for lid in legacy_line_ids:
            legacy_numbers += [f"{INVOICE_ENTRY_PREFIX}-{lid}", f"{BILL_ENTRY_PREFIX}-{lid}"]
        n, _ = JournalEntry.objects.filter(
            company_id=company_id, entry_number__in=legacy_numbers
        ).delete()
        deleted += n
    return deleted


def post_internal_trade_line(company_id: int, transfer, line, *, cost_override=None) -> dict:
    """
    Post the invoice and bill journals for one inter-pond fish line.

    ``cost_override`` is the book cost actually available to relieve — the selling pond cannot
    credit more 1581 than it holds, so the caller caps it (see
    ``aquaculture_fish_transfer_gl_service.sync_aquaculture_fish_pond_transfer_gl``). The price
    legs are never capped: the buying pond still owes what it agreed to pay.

    Idempotent on both entry numbers. Returns what happened so a conversion run can report it.
    """
    inv_en, bill_en = internal_trade_entry_numbers(transfer.id, line.id)
    price = money(_d(getattr(line, "sale_amount", None)))
    cost = money(_d(getattr(line, "cost_amount", None)))
    if cost_override is not None:
        cost = money(_d(cost_override))

    if price <= 0:
        return {"line_id": line.id, "posted": False, "reason": "line has no sale value to post"}

    accounts = _accounts(company_id)
    if accounts is None:
        return {"line_id": line.id, "posted": False, "reason": "chart of accounts is missing 1581/1595/4245/5245"}

    bio = accounts[CODE_BIO_INVENTORY]
    current = accounts[CODE_INTERPOND_CURRENT]
    revenue = accounts[CODE_INTERNAL_REVENUE]
    cogs = accounts[CODE_INTERNAL_COGS]

    seller = AquaculturePond.objects.filter(
        pk=transfer.from_pond_id, company_id=company_id
    ).first()
    buyer = AquaculturePond.objects.filter(pk=line.to_pond_id, company_id=company_id).first()
    if not seller or not buyer:
        return {"line_id": line.id, "posted": False, "reason": "selling or buying pond is missing"}

    seller_name = _pond_name(seller, "source pond")
    buyer_name = _pond_name(buyer, "destination pond")
    seller_meta = {
        "pond_id": seller.id,
        "production_cycle_id": getattr(transfer, "from_production_cycle_id", None),
        "cost_bucket": "internal_fish_sale",
    }
    buyer_meta = {
        "pond_id": buyer.id,
        "production_cycle_id": getattr(line, "to_production_cycle_id", None),
        "cost_bucket": "internal_fish_purchase",
    }

    memo = f"Inter-pond fish sale — {seller_name} to {buyer_name}"
    created = []

    if not JournalEntry.objects.filter(company_id=company_id, entry_number=inv_en).exists():
        seller_lines = [
            (current, price, Decimal("0"), f"Due from {buyer_name}"),
            (revenue, Decimal("0"), price, f"Fish sold to {buyer_name}"),
        ]
        seller_meta_list = [seller_meta, seller_meta]
        if cost > 0:
            seller_lines.append((cogs, cost, Decimal("0"), f"Book cost of fish sold to {buyer_name}"))
            seller_lines.append((bio, Decimal("0"), cost, f"Fish leaving {seller_name}"))
            seller_meta_list += [seller_meta, seller_meta]
        je_inv = _create_posted_entry(
            company_id,
            transfer.transfer_date,
            inv_en,
            f"{memo} — seller invoice"[:500],
            seller_lines,
            gl_station_id=None,
            aquaculture_line_costing=seller_meta_list,
        )
        if je_inv is None:
            return {"line_id": line.id, "posted": False, "reason": "seller invoice journal was rejected"}
        created.append(inv_en)

    if not JournalEntry.objects.filter(company_id=company_id, entry_number=bill_en).exists():
        je_bill = _create_posted_entry(
            company_id,
            transfer.transfer_date,
            bill_en,
            f"{memo} — buyer bill"[:500],
            [
                (bio, price, Decimal("0"), f"Fish received at {buyer_name}"),
                (current, Decimal("0"), price, f"Owed to {seller_name}"),
            ],
            gl_station_id=None,
            aquaculture_line_costing=[buyer_meta, buyer_meta],
        )
        if je_bill is None:
            return {"line_id": line.id, "posted": False, "reason": "buyer bill journal was rejected"}
        created.append(bill_en)

    return {
        "line_id": line.id,
        "posted": bool(created),
        "already_posted": not created,
        "entries": created,
        "price": str(price),
        "cost": str(cost),
        "margin": str(money(price - cost)),
        "seller": seller_name,
        "buyer": buyer_name,
    }
