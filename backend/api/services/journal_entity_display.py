"""
Human-readable site / entity labels for journal entries and account statements.

When both station and pond are tagged on a line, pond wins — matching entity P&L scoping
(see entity_gl_scoping.py).
"""
from __future__ import annotations

import re
from typing import Iterable

from api.models import AquaculturePond, JournalEntry, JournalEntryLine
from api.services.aquaculture_pond_display import pond_operational_display_name

_PAY_MADE = re.compile(r"^AUTO-PAY-(\d+)-MADE$")
_PAY_RCV = re.compile(r"^AUTO-PAY-(\d+)-RCV$")


def pond_site_label(pond: AquaculturePond | None, *, pond_name: str = "") -> str:
    """Display label for a pond entity in Site columns."""
    if pond is not None:
        label = (pond_operational_display_name(pond) or "").strip()
        if label:
            return label
        pond_name = (pond.name or "").strip()
    name = (pond_name or "").strip()
    if not name:
        return ""
    if name.lower().endswith("pond"):
        return name
    return f"{name} Pond"


def _collect_pond_labels(lines: Iterable[JournalEntryLine]) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for line in lines:
        pond = getattr(line, "aquaculture_pond", None)
        if not pond:
            continue
        label = pond_site_label(pond)
        if label and label not in seen:
            seen.add(label)
            labels.append(label)
    return labels


def _format_pond_labels(pond_labels: list[str]) -> str:
    if not pond_labels:
        return ""
    if len(pond_labels) == 1:
        return pond_labels[0]
    if len(pond_labels) == 2:
        return f"{pond_labels[0]}, {pond_labels[1]}"
    return f"{pond_labels[0]} (+{len(pond_labels) - 1} more ponds)"


def journal_line_site_label(line: JournalEntryLine) -> str:
    """Site column for one journal line; pond tag wins over receipt station."""
    pond = getattr(line, "aquaculture_pond", None)
    if pond is not None:
        return pond_site_label(pond)
    lst = getattr(line, "station", None)
    if lst and (lst.station_name or "").strip():
        return (lst.station_name or "").strip()
    return ""


def _payment_pond_labels_from_allocations(company_id: int, entry: JournalEntry) -> list[str]:
    """When payment journals lack pond tags, infer from linked invoice/bill allocations."""
    en = (entry.entry_number or "").strip()
    m = _PAY_MADE.match(en)
    if m:
        from api.models import BillLine, PaymentBillAllocation

        pay_id = int(m.group(1))
        bill_ids = list(
            PaymentBillAllocation.objects.filter(
                payment_id=pay_id,
                payment__company_id=company_id,
                bill_id__isnull=False,
            )
            .exclude(bill_id=0)
            .values_list("bill_id", flat=True)
        )
        if not bill_ids:
            return []
        pond_ids = set(
            BillLine.objects.filter(
                bill_id__in=bill_ids,
                bill__company_id=company_id,
            )
            .exclude(aquaculture_pond_id__isnull=True)
            .values_list("aquaculture_pond_id", flat=True)
        )
        if len(pond_ids) != 1:
            return []
        pond = AquaculturePond.objects.filter(pk=pond_ids.pop(), company_id=company_id).first()
        label = pond_site_label(pond)
        return [label] if label else []

    m = _PAY_RCV.match(en)
    if m:
        from api.models import InvoiceLine, PaymentInvoiceAllocation

        pay_id = int(m.group(1))
        inv_ids = list(
            PaymentInvoiceAllocation.objects.filter(
                payment_id=pay_id,
                payment__company_id=company_id,
                invoice_id__isnull=False,
            )
            .exclude(invoice_id=0)
            .values_list("invoice_id", flat=True)
        )
        if not inv_ids:
            return []
        # Invoice has no pond field; the pond tag lives on invoice lines
        # (mirrors the BillLine path used for vendor payments above).
        pond_ids = set(
            InvoiceLine.objects.filter(
                invoice_id__in=inv_ids,
                invoice__company_id=company_id,
            )
            .exclude(aquaculture_pond_id__isnull=True)
            .values_list("aquaculture_pond_id", flat=True)
        )
        if len(pond_ids) != 1:
            return []
        pond = AquaculturePond.objects.filter(pk=pond_ids.pop(), company_id=company_id).first()
        label = pond_site_label(pond)
        return [label] if label else []

    return []


def journal_entry_site_label(entry: JournalEntry, lines: Iterable[JournalEntryLine]) -> str:
    """Site column for a journal entry list row; pond tags on lines win over header station."""
    line_list = list(lines)
    pond_labels = _collect_pond_labels(line_list)
    if pond_labels:
        return _format_pond_labels(pond_labels)

    company_id = getattr(entry, "company_id", None)
    if company_id:
        pond_labels = _payment_pond_labels_from_allocations(int(company_id), entry)
        if pond_labels:
            return _format_pond_labels(pond_labels)

    st = getattr(entry, "station", None)
    if st and (st.station_name or "").strip():
        return (st.station_name or "").strip()

    station_labels: list[str] = []
    seen_st: set[str] = set()
    for line in line_list:
        lst = getattr(line, "station", None)
        if not lst or not (lst.station_name or "").strip():
            continue
        name = (lst.station_name or "").strip()
        if name not in seen_st:
            seen_st.add(name)
            station_labels.append(name)
    if len(station_labels) == 1:
        return station_labels[0]
    if len(station_labels) == 2:
        return f"{station_labels[0]}, {station_labels[1]}"
    if len(station_labels) > 2:
        return f"{station_labels[0]} (+{len(station_labels) - 1} more sites)"
    return ""
