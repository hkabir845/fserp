"""
Entity dimension rules for station / pond / head-office financial reports.

Posted journal lines drive site-scoped P&L, Balance Sheet, and entity summary reports.
Each P&L line should carry either:
  - station_id (fuel site, shop, register), or
  - aquaculture_pond_id (pond as individual entity), or
  - neither (head office / company-wide — appears only in unscoped slice + company total).

When both station and pond are set, pond wins for P&L attribution (station rows exclude pond-tagged lines).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db.models import Q

from api.models import (
    AquaculturePond,
    Bill,
    Invoice,
    JournalEntry,
    JournalEntryLine,
)
from api.services.coa_constants import pl_bucket_for_coa


def pl_line_needs_entity_dimension(account) -> bool:
    """True when the account affects Income, COGS, or Expense on entity P&L reports."""
    if not account:
        return False
    return (
        pl_bucket_for_coa(
            getattr(account, "account_type", None),
            getattr(account, "account_sub_type", None),
            getattr(account, "account_code", None),
        )
        is not None
    )


def apply_entry_station_to_unscoped_pl_lines(entry: JournalEntry) -> int:
    """
    Copy journal header station_id onto P&L lines that lack both station and pond tags.
    Returns the number of lines updated.
    """
    header_sid = entry.station_id
    if not header_sid:
        return 0
    updated = 0
    for line in entry.lines.select_related("account").all():
        if not pl_line_needs_entity_dimension(line.account):
            continue
        if line.station_id is not None or line.aquaculture_pond_id is not None:
            continue
        line.station_id = header_sid
        line.save(update_fields=["station_id"])
        updated += 1
    return updated


def validate_manual_je_entity_scoping_for_post(entry: JournalEntry) -> tuple[bool, str]:
    """
    Manual (non-AUTO) journals must tag every P&L line with a station or pond before posting.
    """
    en = (entry.entry_number or "").strip()
    if en.startswith("AUTO-"):
        return True, ""

    apply_entry_station_to_unscoped_pl_lines(entry)
    entry.refresh_from_db()

    missing: list[str] = []
    for line in entry.lines.select_related("account").all():
        if not pl_line_needs_entity_dimension(line.account):
            continue
        if line.station_id is not None or line.aquaculture_pond_id is not None:
            continue
        code = (line.account.account_code or "").strip() if line.account else ""
        missing.append(code or f"line #{line.id}")

    if not missing:
        return True, ""

    codes = ", ".join(missing[:8])
    extra = f" (+{len(missing) - 8} more)" if len(missing) > 8 else ""
    return (
        False,
        "Cannot post: income, COGS, and expense lines need a site (station) or pond tag "
        f"so entity P&L reports are correct. Untagged accounts: {codes}{extra}. "
        "Set Default site, per-line Site/Pond, or use Head office only for balance-sheet lines (cash, AP, AR).",
    )


def manual_je_entity_scoping_warnings(entry: JournalEntry) -> list[str]:
    """
    Warnings for a manual journal before/after post (does not block posting).
    Head-office balance-sheet lines (cash, AP, AR) may legitimately lack site/pond tags.
    """
    warnings: list[str] = []
    for line in entry.lines.select_related("account").all():
        acc = line.account
        if not pl_line_needs_entity_dimension(acc):
            continue
        has_station = line.station_id is not None
        has_pond = getattr(line, "aquaculture_pond_id", None) is not None
        if has_station or has_pond:
            continue
        code = (acc.account_code or "").strip()
        name = (acc.account_name or "").strip() or f"account #{acc.id}"
        warnings.append(
            f"Line #{line.id or '?'} ({code} {name}): no station or pond tag — "
            "this amount will appear under Head office / unassigned, not on a station or pond P&L."
        )
    return warnings


def audit_entity_gl_scoping(company_id: int, *, sample_limit: int = 5) -> dict[str, Any]:
    """
    Data-quality metrics for per-entity reporting. Use after go-live or before period close.
    """
    cid = company_id
    pl_qs = (
        JournalEntryLine.objects.filter(
            journal_entry__company_id=cid,
            journal_entry__is_posted=True,
        )
        .select_related("account", "journal_entry")
    )
    unscoped_pl = []
    for line in pl_qs.iterator(chunk_size=500):
        if not pl_line_needs_entity_dimension(line.account):
            continue
        if line.station_id is None and line.aquaculture_pond_id is None:
            amt = (line.debit or Decimal("0")) + (line.credit or Decimal("0"))
            if amt <= 0:
                continue
            unscoped_pl.append(
                {
                    "journal_entry_id": line.journal_entry_id,
                    "entry_number": line.journal_entry.entry_number,
                    "entry_date": line.journal_entry.entry_date.isoformat()
                    if line.journal_entry.entry_date
                    else None,
                    "account_code": line.account.account_code if line.account else "",
                    "amount": str(amt.quantize(Decimal("0.01"))),
                }
            )

    inv_null = Invoice.objects.filter(company_id=cid).filter(
        Q(station_id__isnull=True) | Q(station_id=0)
    )
    inv_posted_null = inv_null.exclude(status="draft").count()
    inv_null_total = inv_null.count()

    bill_null = Bill.objects.filter(company_id=cid).filter(
        Q(receipt_station_id__isnull=True) | Q(receipt_station_id=0)
    )
    bill_posted_null = bill_null.exclude(status="draft").exclude(status="void").count()
    bill_null_total = bill_null.count()

    pond_count = AquaculturePond.objects.filter(company_id=cid, is_active=True).count()

    return {
        "company_id": cid,
        "active_ponds": pond_count,
        "unscoped_pl_line_count": len(unscoped_pl),
        "unscoped_pl_samples": unscoped_pl[:sample_limit],
        "invoices_missing_station": inv_null_total,
        "invoices_posted_missing_station": inv_posted_null,
        "bills_missing_receipt_station": bill_null_total,
        "bills_posted_missing_receipt_station": bill_posted_null,
    }
