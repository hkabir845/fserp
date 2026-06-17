"""Build account-style activity lists from posted journal lines (chart account)."""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.db.models import DecimalField, ExpressionWrapper, F, Prefetch, Sum

from api.models import (
    Bill,
    ChartOfAccount,
    Invoice,
    JournalEntry,
    JournalEntryLine,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    PayrollRun,
)

_PAY_RCV = re.compile(r"^AUTO-PAY-(\d+)-RCV$")
_PAY_MADE = re.compile(r"^AUTO-PAY-(\d+)-MADE$")
_INV = re.compile(r"^AUTO-INV-(\d+)-(?:SALE|RCPT|COGS)$")
_BILL = re.compile(r"^AUTO-BILL-(\d+)$")
_PAYROLL = re.compile(r"^AUTO-PAYROLL-(\d+)$")

_DIFF = ExpressionWrapper(
    F("debit") - F("credit"),
    output_field=DecimalField(max_digits=14, decimal_places=2),
)


def _net_movement_before_date(
    account_id: int,
    before_date: date,
    *,
    station_id: Optional[int] = None,
) -> Decimal:
    """Sum(debit - credit) for posted lines on this account strictly before ``before_date``."""
    qs = JournalEntryLine.objects.filter(
        account_id=account_id,
        journal_entry__entry_date__lt=before_date,
    )
    if station_id is not None:
        qs = qs.filter(station_id=station_id)
    r = qs.aggregate(net=Sum(_DIFF))
    v = r.get("net")
    return v if v is not None else Decimal("0")


def journal_net_movement(account_id: int) -> Decimal:
    """Sum(debit - credit) for all journal lines on this chart account (lifetime)."""
    r = JournalEntryLine.objects.filter(account_id=account_id).aggregate(net=Sum(_DIFF))
    v = r.get("net")
    return v if v is not None else Decimal("0")


def journal_net_movement_map(account_ids: Iterable[int]) -> Dict[int, Decimal]:
    """Batch net movement for many accounts (two queries total with list + map pattern)."""
    ids = [int(x) for x in dict.fromkeys(account_ids)]
    if not ids:
        return {}
    rows = (
        JournalEntryLine.objects.filter(account_id__in=ids)
        .values("account_id")
        .annotate(net=Sum(_DIFF))
    )
    out: Dict[int, Decimal] = {i: Decimal("0") for i in ids}
    for r in rows:
        aid = int(r["account_id"])
        out[aid] = r["net"] if r["net"] is not None else Decimal("0")
    return out


def build_statement_transactions(
    account: ChartOfAccount,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    station_id: Optional[int] = None,
) -> Tuple[List[dict[str, Any]], Decimal, Decimal]:
    """
    Lines on this chart account in date order, with running balance.

    Opening for the displayed slice follows standard sub-ledger rules:

    - **Company-wide** (no ``station_id``): start from chart ``opening_balance`` plus all journal
      activity on this account **strictly before** ``start_date`` when a start date is given;
      otherwise start from ``opening_balance`` only.
    - **Site filter** (``station_id`` set): only lines tagged to that site; opening is **zero**
      when there is no ``start_date`` (lifetime slice for that dimension). With ``start_date``,
      opening is the net movement on (account, site) **before** that date so the running balance
      matches a site-period trial balance / management roll-forward.

    Returns ``(transactions, ending_balance, opening_balance_for_range)``.
    """
    account_id = account.id
    ob = account.opening_balance or Decimal("0")

    if station_id is not None:
        if start_date:
            opening_for_range = _net_movement_before_date(
                account_id, start_date, station_id=station_id
            )
        else:
            opening_for_range = Decimal("0")
    else:
        if start_date:
            opening_for_range = ob + _net_movement_before_date(
                account_id, start_date, station_id=None
            )
        else:
            opening_for_range = ob

    lines_qs = JournalEntryLine.objects.filter(account_id=account_id).select_related(
        "journal_entry", "station"
    )
    if station_id is not None:
        lines_qs = lines_qs.filter(station_id=station_id)
    if start_date:
        lines_qs = lines_qs.filter(journal_entry__entry_date__gte=start_date)
    if end_date:
        lines_qs = lines_qs.filter(journal_entry__entry_date__lte=end_date)
    lines_qs = lines_qs.order_by("journal_entry__entry_date", "id")

    transactions: List[dict[str, Any]] = []
    running = opening_for_range

    for line in lines_qs:
        je = getattr(line, "journal_entry", None)
        if je is None and line.journal_entry_id:
            je = JournalEntry.objects.filter(pk=line.journal_entry_id).first()
        if je is None:
            continue

        debit = line.debit or Decimal("0")
        credit = line.credit or Decimal("0")
        running += debit - credit

        other_account_id = None
        other_account_name = None
        other_account_code = None
        other = (
            JournalEntryLine.objects.filter(journal_entry_id=line.journal_entry_id)
            .exclude(account_id=account_id)
            .first()
        )
        if other:
            other_account_id = other.account_id
            oa = ChartOfAccount.objects.filter(id=other.account_id).first()
            if oa:
                other_account_name = oa.account_name
                other_account_code = oa.account_code

        je_desc = (je.description or "").strip()
        line_desc = (line.description or "").strip()
        st = getattr(line, "station", None)
        transactions.append(
            {
                "id": line.id,
                "journal_entry_id": je.id,
                "date": je.entry_date.isoformat() if je.entry_date else None,
                "entry_number": je.entry_number or "",
                "journal_description": je_desc,
                "description": line_desc,
                "debit": str(debit),
                "credit": str(credit),
                "balance": str(running),
                "other_account_id": other_account_id,
                "other_account_name": other_account_name,
                "other_account_code": other_account_code,
                "station_id": line.station_id,
                "station_name": (st.station_name if st else "") or "",
            }
        )

    return transactions, running, opening_for_range


def enrich_statement_transaction_sources(
    transactions: List[dict[str, Any]],
    *,
    company_id: int,
) -> None:
    """Attach source metadata: payments (with delete flags), invoices (receivable), bills (payable)."""
    pay_ids: set[int] = set()
    inv_ids: set[int] = set()
    bill_ids: set[int] = set()
    payroll_ids: set[int] = set()

    for tx in transactions:
        en = (tx.get("entry_number") or "").strip()
        m = _PAY_RCV.match(en) or _PAY_MADE.match(en)
        if m:
            pay_ids.add(int(m.group(1)))
            continue
        m = _INV.match(en)
        if m:
            inv_ids.add(int(m.group(1)))
            continue
        m = _BILL.match(en)
        if m:
            bill_ids.add(int(m.group(1)))
            continue
        m = _PAYROLL.match(en)
        if m:
            payroll_ids.add(int(m.group(1)))

    meta_by_entry: dict[str, dict[str, Any]] = {}

    if pay_ids:
        payments = {
            p.id: p
            for p in Payment.objects.filter(
                company_id=company_id,
                id__in=pay_ids,
                payment_type__in=("received", "made"),
            ).prefetch_related(
                Prefetch(
                    "invoice_allocations",
                    queryset=PaymentInvoiceAllocation.objects.select_related("invoice"),
                ),
                Prefetch(
                    "bill_allocations",
                    queryset=PaymentBillAllocation.objects.select_related("bill"),
                ),
            )
        }

        for pid, p in payments.items():
            locked = bool(getattr(p, "bank_deposit_id", None))
            can_delete = p.payment_type in ("received", "made") and not locked
            immutable_reason = (
                "This receipt is on a bank deposit. Void or adjust the deposit before editing or deleting this payment."
                if locked
                else None
            )
            if p.payment_type == "received":
                entry_number = f"AUTO-PAY-{pid}-RCV"
                source_type = "payment_received"
                contact_type = "customer"
                contact_id = p.customer_id
                allocations: list[dict[str, Any]] = []
                for a in p.invoice_allocations.all():
                    inv = a.invoice
                    allocations.append(
                        {
                            "document_type": "receivable",
                            "invoice_id": a.invoice_id,
                            "document_number": (
                                inv.invoice_number if inv else f"INV-{a.invoice_id}"
                            ),
                            "amount": str(a.amount),
                            "contact_id": p.customer_id,
                        }
                    )
            else:
                entry_number = f"AUTO-PAY-{pid}-MADE"
                source_type = "payment_made"
                contact_type = "vendor"
                contact_id = p.vendor_id
                allocations = []
                for a in p.bill_allocations.all():
                    bill = a.bill
                    allocations.append(
                        {
                            "document_type": "payable",
                            "bill_id": a.bill_id,
                            "document_number": (
                                bill.bill_number if bill else f"BILL-{a.bill_id}"
                            ),
                            "amount": str(a.amount),
                            "contact_id": p.vendor_id,
                        }
                    )

            meta_by_entry[entry_number] = {
                "source_type": source_type,
                "source_id": pid,
                "source_label": f"PAY-{pid}",
                "can_delete_payment": can_delete,
                "immutable_reason": immutable_reason,
                "contact_type": contact_type,
                "contact_id": contact_id,
                **({"allocations": allocations} if allocations else {}),
            }

    if inv_ids:
        invoices = {
            i.id: i
            for i in Invoice.objects.filter(company_id=company_id, id__in=inv_ids)
        }
        for iid, inv in invoices.items():
            label = (inv.invoice_number or f"INV-{iid}").strip() or f"INV-{iid}"
            for suffix in ("SALE", "RCPT", "COGS"):
                meta_by_entry[f"AUTO-INV-{iid}-{suffix}"] = {
                    "source_type": "receivable",
                    "source_id": iid,
                    "source_label": label,
                    "document_type": "receivable",
                    "invoice_id": iid,
                }

    if bill_ids:
        bills = {
            b.id: b
            for b in Bill.objects.filter(company_id=company_id, id__in=bill_ids)
        }
        for bid, bill in bills.items():
            label = (bill.bill_number or f"BILL-{bid}").strip() or f"BILL-{bid}"
            meta_by_entry[f"AUTO-BILL-{bid}"] = {
                "source_type": "payable",
                "source_id": bid,
                "source_label": label,
                "document_type": "payable",
                "bill_id": bid,
            }

    if payroll_ids:
        runs = {
            r.id: r
            for r in PayrollRun.objects.filter(company_id=company_id, id__in=payroll_ids)
        }
        for rid, pr in runs.items():
            label = (pr.payroll_number or f"PR-{rid}").strip() or f"PR-{rid}"
            meta_by_entry[f"AUTO-PAYROLL-{rid}"] = {
                "source_type": "payroll",
                "source_id": rid,
                "source_label": label,
                "can_delete_payroll_journal": True,
            }

    for tx in transactions:
        en = (tx.get("entry_number") or "").strip()
        meta = meta_by_entry.get(en)
        if meta:
            tx.update(meta)
