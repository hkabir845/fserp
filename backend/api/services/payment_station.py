"""
Resolve the analytic (register) site on AR/AP payment headers from allocations.

General ledger remains company cash vs AR/AP; station supports multi-site reports and audit trail.
"""
from __future__ import annotations

from django.db.models import Prefetch

from api.models import (
    Bill,
    BillLine,
    Customer,
    Invoice,
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


def _stations_for_bill(b: Bill) -> set[int]:
    s: set[int] = set()
    if b.receipt_station_id:
        s.add(int(b.receipt_station_id))
    for line in b.lines.all():
        if line.tank_id and getattr(line, "tank", None) and line.tank.station_id:
            s.add(int(line.tank.station_id))
    return s


def _primary_for_bill(b: Bill) -> int | None:
    sb = _stations_for_bill(b)
    if not sb:
        return None
    if len(sb) == 1:
        return sb.pop()
    return None  # >1: ambiguous (shop + different tank site)


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
            bills = list(
                Bill.objects.filter(company_id=company_id, id__in=b_ids)
                .prefetch_related(
                    Prefetch("lines", queryset=BillLine.objects.select_related("tank"))
                )
            )
            by_site: set[int] = set()
            ambig = False
            for b in bills:
                st = _primary_for_bill(b)
                if st is None and _stations_for_bill(b):
                    ambig = True
                    break
                if st is not None:
                    by_site.add(int(st))
            if ambig:
                return None
            if not by_site:
                v0 = (
                    Vendor.objects.filter(pk=p.vendor_id, company_id=company_id)
                    .only("default_station_id", "default_aquaculture_pond_id")
                    .first()
                )
                return receipt_station_id_for_vendor(company_id, v0)
            if len(by_site) == 1:
                return by_site.pop()
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
