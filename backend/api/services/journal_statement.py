"""Build account-style activity lists from posted journal lines (chart account)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.db.models import DecimalField, ExpressionWrapper, F, Sum

from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

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
