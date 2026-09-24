"""Credit notes, sales returns, and refunds.

A posted credit note reverses a slice of the original sale journal and the original
cost journal, puts the same slice of stock back, and reduces what the customer owes.
A refund pays that credit out of cash when the original sale sat in accounts receivable.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import F, Sum

from api.exceptions import GlPostingError
from api.models import CreditNote, Customer, Invoice, InvoiceLine, JournalEntry
from api.services.gl_posting import (
    CODE_AR,
    CODE_CASH,
    _create_posted_entry,
    _ensure_core_posting_account,
    _gl_station_id,
)
from api.services.station_stock import add_station_stock


def _money(value) -> Decimal:
    return (value or Decimal("0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def posted_credit_total(company_id: int, invoice_id: int, as_of=None) -> Decimal:
    qs = CreditNote.objects.filter(
        company_id=company_id, invoice_id=invoice_id, status="posted"
    )
    if as_of is not None:
        qs = qs.filter(credit_date__lte=as_of)
    total = qs.aggregate(s=Sum("amount"))["s"]
    return total or Decimal("0")


def _sale_journal(company_id: int, invoice_id: int) -> JournalEntry | None:
    return JournalEntry.objects.filter(
        company_id=company_id, entry_number=f"AUTO-INV-{invoice_id}-SALE", is_posted=True
    ).first()


def _cogs_journal(company_id: int, invoice_id: int) -> JournalEntry | None:
    return JournalEntry.objects.filter(
        company_id=company_id, entry_number=f"AUTO-INV-{invoice_id}-COGS", is_posted=True
    ).first()


def _reversed_lines(journal: JournalEntry | None, fraction: Decimal) -> list[tuple]:
    if journal is None or fraction <= 0:
        return []
    out = []
    rows = list(journal.lines.select_related("account").all())
    running = Decimal("0")
    targets = []
    for i, ln in enumerate(rows):
        debit = _money((ln.debit or Decimal("0")) * fraction)
        credit = _money((ln.credit or Decimal("0")) * fraction)
        if i == len(rows) - 1:
            # Last line absorbs rounding so the reversal stays balanced.
            pass
        targets.append((ln, debit, credit))
    # Swap sides. Rebalance the last non-zero pair if rounding drifted.
    swapped = []
    for ln, debit, credit in targets:
        swapped.append((ln.account, credit, debit, (ln.description or "Credit note")[:300]))
        running += credit - debit
    if not swapped:
        return []
    drift = sum(d for _, d, _, _ in swapped) - sum(c for _, _, c, _ in swapped)
    if drift != 0 and abs(drift) <= Decimal("0.05"):
        acc, d, c, desc = swapped[-1]
        if drift > 0:
            swapped[-1] = (acc, d, _money(c + drift), desc)
        else:
            swapped[-1] = (acc, _money(d - drift), c, desc)
    return [row for row in swapped if row[1] > 0 or row[2] > 0]


def _restore_stock(company_id: int, invoice: Invoice, fraction: Decimal) -> bool:
    restored = False
    for line in InvoiceLine.objects.filter(invoice_id=invoice.id).select_related("item"):
        original = line.stock_relieved_quantity or Decimal("0")
        if original <= 0 or line.item_id is None:
            continue
        qty = (original * fraction).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        if qty <= 0:
            continue
        if line.stock_relieved_station_id is not None:
            add_station_stock(
                company_id, int(line.stock_relieved_station_id), int(line.item_id), qty
            )
        else:
            from api.models import Item

            Item.objects.filter(pk=line.item_id, company_id=company_id).update(
                quantity_on_hand=F("quantity_on_hand") + qty
            )
        restored = True
    return restored


@transaction.atomic
def post_credit_note(
    company_id: int,
    invoice_id: int,
    *,
    amount: Decimal | None = None,
    credit_date=None,
    reason: str = "",
    credit_note_number: str = "",
) -> CreditNote:
    invoice = (
        Invoice.all_objects.select_for_update()
        .filter(pk=invoice_id, company_id=company_id)
        .first()
    )
    if invoice is None:
        raise GlPostingError("Invoice not found.")
    if (invoice.status or "") in ("draft", "void"):
        raise GlPostingError("A draft or void invoice has no sale to reverse.")
    total = _money(invoice.total)
    if total <= 0:
        raise GlPostingError("Invoice total must be greater than zero.")
    already = posted_credit_total(company_id, invoice.id)
    remaining = _money(total - already)
    if remaining <= 0:
        raise GlPostingError("This invoice is already fully credited.")
    credit_amt = _money(amount if amount is not None else remaining)
    if credit_amt <= 0 or credit_amt > remaining:
        raise GlPostingError(
            f"Credit amount must be between 0.01 and the remaining {remaining}."
        )
    sale = _sale_journal(company_id, invoice.id)
    if sale is None:
        raise GlPostingError("The original sale has no posted journal to reverse.")

    fraction = credit_amt / total
    lines = _reversed_lines(sale, fraction)
    lines.extend(_reversed_lines(_cogs_journal(company_id, invoice.id), fraction))
    if not lines:
        raise GlPostingError("Could not build a reversing journal for this sale.")

    when = credit_date or invoice.invoice_date
    number = (credit_note_number or "").strip()
    if not number:
        seq = CreditNote.objects.filter(company_id=company_id).count() + 1
        number = f"CN-{seq}"
    note = CreditNote.objects.create(
        company_id=company_id,
        customer_id=invoice.customer_id,
        invoice_id=invoice.id,
        credit_note_number=number[:64],
        credit_date=when,
        status="posted",
        reason=(reason or "Sales return")[:300],
        amount=credit_amt,
    )
    entry_number = f"AUTO-CN-{note.id}"
    je = _create_posted_entry(
        company_id,
        when,
        entry_number,
        f"Credit note {number} against {invoice.invoice_number}"[:500],
        lines,
        gl_station_id=_gl_station_id(company_id, invoice.station_id),
    )
    if je is None:
        raise GlPostingError("Credit note journal did not post.")
    note.journal_entry_id = je.id
    ar = _ensure_core_posting_account(company_id, CODE_AR)
    credited_ar = Decimal("0")
    credited_cash = Decimal("0")
    cash = _ensure_core_posting_account(company_id, CODE_CASH)
    for ln in je.lines.all():
        if ar and ln.account_id == ar.id:
            credited_ar += ln.credit or Decimal("0")
        if cash and ln.account_id == cash.id:
            credited_cash += ln.credit or Decimal("0")
    if credited_ar > 0 and invoice.customer_id:
        Customer.objects.filter(pk=invoice.customer_id).update(
            current_balance=F("current_balance") - credited_ar
        )
    if credited_cash > 0 and credited_ar <= 0:
        note.refunded_amount = credit_amt
    restored = _restore_stock(company_id, invoice, fraction)
    note.stock_restored = restored
    note.save(update_fields=["journal_entry", "refunded_amount", "stock_restored"])
    return note


@transaction.atomic
def refund_credit_note(
    company_id: int,
    credit_note_id: int,
    *,
    amount: Decimal | None = None,
    refund_date=None,
) -> CreditNote:
    note = (
        CreditNote.objects.select_for_update()
        .filter(pk=credit_note_id, company_id=company_id, status="posted")
        .first()
    )
    if note is None:
        raise GlPostingError("Credit note not found.")
    open_credit = _money(note.amount - (note.refunded_amount or Decimal("0")))
    if open_credit <= 0:
        raise GlPostingError("This credit note is already refunded.")
    pay = _money(amount if amount is not None else open_credit)
    if pay <= 0 or pay > open_credit:
        raise GlPostingError(f"Refund must be between 0.01 and {open_credit}.")
    ar = _ensure_core_posting_account(company_id, CODE_AR)
    cash = _ensure_core_posting_account(company_id, CODE_CASH)
    if not ar or not cash:
        raise GlPostingError("Need accounts 1100 and 1010 to refund a credit note.")
    when = refund_date or note.credit_date
    je = _create_posted_entry(
        company_id,
        when,
        f"AUTO-CN-{note.id}-RFD",
        f"Refund of credit note {note.credit_note_number}"[:500],
        [
            (ar, pay, Decimal("0"), "Refund customer credit"),
            (cash, Decimal("0"), pay, "Refund customer credit"),
        ],
    )
    if je is None:
        raise GlPostingError("Refund journal did not post.")
    if note.customer_id:
        Customer.objects.filter(pk=note.customer_id).update(
            current_balance=F("current_balance") + pay
        )
    note.refunded_amount = _money((note.refunded_amount or Decimal("0")) + pay)
    note.refund_journal_entry_id = je.id
    note.save(update_fields=["refunded_amount", "refund_journal_entry"])
    return note
