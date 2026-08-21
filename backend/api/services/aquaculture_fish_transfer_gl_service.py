"""GL 1581 re-tag when fish biological cost moves between ponds on inter-pond transfers."""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    JournalEntry,
    JournalEntryLine,
)
from api.services.gl_posting import (
    delete_aquaculture_fish_pond_transfer_journal,
    post_aquaculture_fish_pond_transfer_journal,
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def pond_1581_balance(company_id: int, pond_id: int, as_of: date) -> Decimal:
    """Posted GL balance of account 1581 tagged to pond on or before as_of."""
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=as_of,
        aquaculture_pond_id=pond_id,
        account__account_code="1581",
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    return _money_q(Decimal(str(agg["td"] or 0)) - Decimal(str(agg["tc"] or 0)))


def allocate_transfer_gl_amounts(
    company_id: int,
    *,
    from_pond_id: int,
    as_of: date,
    lines: list,
) -> tuple[list[tuple[object, Decimal]], Decimal, Decimal, bool]:
    """
    Map each transfer line to the GL amount to post (Dr/Cr 1581).
    Returns (line_amount_pairs, total_requested, total_gl, was_capped).
    """
    pairs: list[tuple[object, Decimal]] = []
    total_requested = Decimal("0")
    for ln in lines:
        req = _money_q(Decimal(str(getattr(ln, "cost_amount", None) or 0)))
        if req <= 0:
            pairs.append((ln, Decimal("0")))
            continue
        pairs.append((ln, req))
        total_requested += req

    if total_requested <= 0:
        return pairs, Decimal("0"), Decimal("0"), False

    balance = pond_1581_balance(company_id, from_pond_id, as_of)
    if balance <= 0:
        return [(ln, Decimal("0")) for ln, _ in pairs], total_requested, Decimal("0"), total_requested > 0

    if total_requested <= balance:
        return pairs, total_requested, total_requested, False

    # Proportional cap — management cost can exceed fry-only 1581 book balance.
    capped_pairs: list[tuple[object, Decimal]] = []
    running = Decimal("0")
    positive = [(ln, amt) for ln, amt in pairs if amt > 0]
    for i, (ln, req) in enumerate(positive):
        if i == len(positive) - 1:
            gl_amt = _money_q(balance - running)
        else:
            gl_amt = _money_q(req * balance / total_requested)
            running += gl_amt
        capped_pairs.append((ln, max(Decimal("0"), gl_amt)))

    zero_lines = [(ln, Decimal("0")) for ln, amt in pairs if amt <= 0]
    all_pairs = capped_pairs + zero_lines
    total_gl = sum(amt for _, amt in all_pairs)
    return all_pairs, total_requested, _money_q(total_gl), True


def sync_aquaculture_fish_pond_transfer_gl(company_id: int, transfer) -> dict:
    """
    Post an inter-pond fish movement as a **sale**: seller's invoice and buyer's bill.

    Fish moving between ponds is a trade, not a re-tag of inventory, so the paperwork carries the
    economics — ``AUTO-IPT-INV-{transfer}-{line}`` and ``AUTO-IPT-BILL-{transfer}-{line}``,
    settling through 1595 (see
    api.services.aquaculture_internal_trade_posting). The old single ``AUTO-AQ-FISH-XFER-{id}``
    journal is removed whenever this runs, so a transfer recorded under the previous model is
    re-papered the moment it is touched.

    What has not changed: the selling pond can only relieve the 1581 it actually holds, so the
    cost leg is still capped at its balance on the transfer date, and pond production expense is
    still reclassified into 1581 first when the company capitalizes it. The price legs are never
    capped — the buying pond owes the agreed price either way.
    """
    if not isinstance(transfer, AquacultureFishPondTransfer):
        return {"posted": False, "reason": "invalid_transfer"}

    from api.services.aquaculture_internal_transfer_price import apply_internal_prices_to_transfer

    delete_aquaculture_fish_pond_transfer_journal(company_id, transfer.id)
    # Price before posting, whoever the caller is: an unpriced line has nothing to invoice, and
    # the seam — not each caller — is what guarantees the sale carries a price.
    apply_internal_prices_to_transfer(company_id, transfer)
    lines = list(transfer.lines.select_related("to_pond", "to_production_cycle").all())
    total_requested = _money_q(
        sum(
            (
                _money_q(Decimal(str(getattr(ln, "cost_amount", None) or 0)))
                for ln in lines
                if _money_q(Decimal(str(getattr(ln, "cost_amount", None) or 0))) > 0
            ),
            Decimal("0"),
        )
    )
    reclass_posted = Decimal("0")
    if total_requested > 0:
        balance = pond_1581_balance(company_id, transfer.from_pond_id, transfer.transfer_date)
        if balance < total_requested:
            from api.services.aquaculture_pond_bio_capitalization import (
                company_capitalizes_pond_production,
                post_pond_expense_reclass_to_1581,
            )

            if company_capitalizes_pond_production(company_id):
                shortfall = _money_q(total_requested - balance)
                reclass_posted = post_pond_expense_reclass_to_1581(
                    company_id,
                    pond_id=transfer.from_pond_id,
                    production_cycle_id=transfer.from_production_cycle_id,
                    entry_date=transfer.transfer_date,
                    entry_number=f"AUTO-AQ-FISH-XFER-{transfer.id}-RECLASS",
                    amount_needed=shortfall,
                    memo=f"Inter-pond transfer #{transfer.id} — align 1581 with production cost",
                )

    line_amounts, total_req, total_gl, capped = allocate_transfer_gl_amounts(
        company_id,
        from_pond_id=transfer.from_pond_id,
        as_of=transfer.transfer_date,
        lines=lines,
    )
    # Inter-pond trades are sales: cost/kg + company margin (or margin alone when book cost
    # is still zero). Any line with a sale value must leave AUTO-IPT invoice + bill journals,
    # even when the seller has nothing left in 1581 to relieve (cost leg is then zero).
    def _sale(ln) -> Decimal:
        return _money_q(Decimal(str(getattr(ln, "sale_amount", None) or 0)))

    postable = [(ln, amt) for ln, amt in line_amounts if _sale(ln) > 0]
    if not postable:
        reason = "no_sale_value"
        if total_req > 0 and total_gl <= 0:
            reason = "source_pond_1581_balance_zero_and_no_sale_price"
        return {
            "posted": False,
            "reason": reason,
            "total_requested": str(_money_q(total_req)),
            "total_gl_amount": "0",
            "gl_capped": capped,
        }

    from api.services.aquaculture_internal_trade_documents import sync_internal_trade_documents
    from api.services.aquaculture_internal_trade_posting import post_internal_trade_line

    # The documents are the transaction, so they must exist before their journals do.
    doc_result = sync_internal_trade_documents(company_id, transfer)

    posted_lines: list[dict] = []
    entry_numbers: list[str] = []
    for ln, capped_cost in postable:
        outcome = post_internal_trade_line(company_id, transfer, ln, cost_override=capped_cost)
        posted_lines.append(outcome)
        entry_numbers.extend(outcome.get("entries") or [])

    any_posted = any(p.get("posted") or p.get("already_posted") for p in posted_lines)
    return {
        "posted": any_posted,
        "documents": doc_result.get("documents", 0),
        "document_skips": doc_result.get("skipped", []),
        "journal_entry_numbers": entry_numbers,
        "lines": posted_lines,
        "total_requested": str(_money_q(total_req)),
        "total_gl_amount": str(_money_q(total_gl)),
        "gl_capped": capped,
        "gl_cap_note": (
            "Cost relieved from the selling pond was capped at its 1581 book balance after "
            "expense reclass; the sale price to the buying pond is unchanged."
            if capped
            else None
        ),
        "gl_reclass_amount": str(_money_q(reclass_posted)) if reclass_posted > 0 else None,
    }


def transfer_gl_status(company_id: int, transfer_id: int) -> dict:
    """
    Read-only GL link for API payloads.

    Reports the inter-pond invoice/bill journals. A transfer still carrying the superseded
    ``AUTO-AQ-FISH-XFER`` journal is reported against that one until it is re-papered, so
    historical records stay legible.
    """
    line_ids = list(
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).values_list(
            "id", flat=True
        )
    )
    wanted = []
    for lid in line_ids:
        wanted.extend(
            ["AUTO-IPT-INV-%d-%d" % (transfer_id, lid), "AUTO-IPT-BILL-%d-%d" % (transfer_id, lid)]
        )
    entries = list(
        JournalEntry.objects.filter(
            company_id=company_id, entry_number__in=wanted, is_posted=True
        )
    )
    if entries:
        cr_total = JournalEntryLine.objects.filter(
            journal_entry__in=entries,
            account__account_code="1581",
            credit__gt=0,
        ).aggregate(t=Coalesce(Sum("credit"), Decimal("0")))["t"]
        return {
            "gl_posted": True,
            "journal_entry_id": entries[0].id,
            "journal_entry_number": entries[0].entry_number,
            "journal_entry_numbers": [e.entry_number for e in entries],
            "gl_total_amount": str(_money_q(Decimal(str(cr_total or 0)))),
        }

    legacy = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-AQ-FISH-XFER-{transfer_id}",
        is_posted=True,
    ).first()
    if not legacy:
        return {
            "gl_posted": False,
            "journal_entry_id": None,
            "journal_entry_number": None,
        }
    cr_total = JournalEntryLine.objects.filter(
        journal_entry=legacy,
        account__account_code="1581",
        credit__gt=0,
    ).aggregate(t=Coalesce(Sum("credit"), Decimal("0")))["t"]
    return {
        "gl_posted": True,
        "journal_entry_id": legacy.id,
        "journal_entry_number": legacy.entry_number,
        "legacy_transfer_journal": True,
        "gl_total_amount": str(_money_q(Decimal(str(cr_total or 0)))),
    }
