"""
Resolve the analytic (register) site on AR/AP payment headers from allocations.

General ledger remains company cash vs AR/AP; station supports multi-site reports and audit trail.
"""
from __future__ import annotations

from api.models import (
    Bill,
    Customer,
    Invoice,
    InvoiceLine,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    Station,
    Vendor,
)
from api.services.station_stock import get_or_create_default_station, receipt_station_id_for_vendor


def _active_station(company_id: int, station_id: int | None) -> int | None:
    if not station_id:
        return None
    if Station.objects.filter(pk=station_id, company_id=company_id, is_active=True).exists():
        return int(station_id)
    return None


def resolve_payment_station_id(company_id: int, p: Payment) -> int | None:
    """
    Resolve register / reporting site on the payment header from allocations.

    Single invoice site wins. If invoices span multiple sites: prefer the customer's
    default_station when it matches one of those sites; otherwise use the lowest station id
    as a deterministic reporting primary (GL remains company-level).
    """
    if p.payment_type == Payment.PAYMENT_TYPE_RECEIVED and p.customer_id:
        a_ids = list(
            PaymentInvoiceAllocation.objects.filter(payment_id=p.id, invoice_id__isnull=False)
            .exclude(invoice_id=0)
            .values_list("invoice_id", flat=True)
        )
        if a_ids:
            invs = list(Invoice.objects.filter(company_id=company_id, id__in=a_ids).only("station_id"))
            st_ids = {int(x.station_id) for x in invs if x.station_id}
            if not st_ids:
                return int(get_or_create_default_station(company_id).id)
            if len(st_ids) == 1:
                return st_ids.pop()
            cust = Customer.objects.filter(pk=p.customer_id, company_id=company_id).only("default_station_id").first()
            ds = int(cust.default_station_id) if cust and cust.default_station_id else None
            if ds and ds in st_ids and _active_station(company_id, ds) == ds:
                return ds
            return min(st_ids)
        cust = Customer.objects.filter(pk=p.customer_id, company_id=company_id).only("default_station_id").first()
        ds = _active_station(company_id, cust.default_station_id if cust else None)
        if ds is not None:
            return ds
        return int(get_or_create_default_station(company_id).id)

    if p.payment_type == Payment.PAYMENT_TYPE_MADE and p.vendor_id:
        b_ids = list(
            PaymentBillAllocation.objects.filter(payment_id=p.id, bill_id__isnull=False)
            .exclude(bill_id=0)
            .values_list("bill_id", flat=True)
        )
        if b_ids:
            from api.services.bill_list_allocations import bill_line_entity_scope_key
            keys = {
                bill_line_entity_scope_key(line, bill)
                for bill in Bill.objects.filter(company_id=company_id, pk__in=b_ids).prefetch_related("lines__tank")
                for line in bill.lines.all()
            }
            if len(keys) == 1:
                key = next(iter(keys))
                return int(key) if key.isdigit() else None
            return None
        v = (
            Vendor.objects.filter(pk=p.vendor_id, company_id=company_id)
            .only("default_station_id", "default_aquaculture_pond_id")
            .first()
        )
        return receipt_station_id_for_vendor(company_id, v)
    return None


def apply_payment_register_station(company_id: int, p: Payment) -> None:
    sid = resolve_payment_station_id(company_id, p)
    Payment.objects.filter(pk=p.pk, company_id=company_id).update(station_id=sid)


def payment_site_display_label(company_id: int, p: Payment) -> str:
    """
    Human-readable site for payment list UI.

    When a vendor payment applies to bill(s) tagged to a single pond, show the pond name
    instead of the shop receipt station (matches journal entry Site column rules).
    """
    from api.models import AquaculturePond
    from api.services.journal_entity_display import pond_site_label

    if p.payment_type == Payment.PAYMENT_TYPE_MADE:
        b_ids = list(
            PaymentBillAllocation.objects.filter(payment_id=p.id, bill_id__isnull=False)
            .exclude(bill_id=0)
            .values_list("bill_id", flat=True)
        )
        if b_ids:
            from api.services.bill_list_allocations import summarize_bill_entity_allocations
            labels = []
            for bill in Bill.objects.filter(company_id=company_id, pk__in=b_ids).prefetch_related(
                "lines__aquaculture_pond", "lines__receipt_station", "lines__tank__station"
            ):
                for row in summarize_bill_entity_allocations(bill):
                    key = row["entity_scope_key"]
                    if key.startswith("p:"):
                        pond = AquaculturePond.objects.filter(pk=int(key[2:]), company_id=company_id).first()
                        label = pond_site_label(pond)
                    else:
                        label = row["entity_label"]
                    if label and label not in labels:
                        labels.append(label)
            return ", ".join(labels)

    if p.payment_type == Payment.PAYMENT_TYPE_RECEIVED:
        inv_ids = list(
            PaymentInvoiceAllocation.objects.filter(payment_id=p.id, invoice_id__isnull=False)
            .exclude(invoice_id=0)
            .values_list("invoice_id", flat=True)
        )
        if inv_ids:
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
            if len(pond_ids) == 1:
                pond = AquaculturePond.objects.filter(
                    pk=pond_ids.pop(), company_id=company_id
                ).first()
                label = pond_site_label(pond)
                if label:
                    return label

    st = getattr(p, "station", None)
    return (st.station_name or "").strip() if st else ""
