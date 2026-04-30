"""Default site on contacts, payment register site, and cross-site payment policy."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_customer_put_default_station(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Customer, Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Default Site", is_active=True)
    c = Customer.objects.create(
        company_id=company_tenant.id, display_name="ACME", current_balance=Decimal("0")
    )
    r = api_client.put(
        f"/api/customers/{c.id}/",
        data=json.dumps({"default_station_id": st.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content
    d = json.loads(r.content)
    assert d.get("default_station_id") == st.id
    assert d.get("default_station_name") == "Default Site"


def test_apply_payment_register_station_from_invoice(company_tenant):
    from api.models import (
        Customer,
        Invoice,
        Payment,
        PaymentInvoiceAllocation,
        Station,
    )
    from api.services.payment_station import apply_payment_register_station

    st = Station.objects.create(company_id=company_tenant.id, station_name="PAY-REG", is_active=True)
    cust = Customer.objects.create(
        company_id=company_tenant.id, display_name="PayTest", current_balance=Decimal("0")
    )
    inv = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=st.id,
        invoice_number="INV-PST-1",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("10"),
        tax_total=Decimal("0"),
        total=Decimal("10"),
    )
    inv.save()
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type="received",
        customer_id=cust.id,
        amount=Decimal("10"),
        payment_date=date.today(),
    )
    PaymentInvoiceAllocation.objects.create(payment_id=p.id, invoice_id=inv.id, amount=Decimal("10"))
    apply_payment_register_station(company_tenant.id, p)
    p.refresh_from_db()
    assert p.station_id == st.id


def test_cannot_apply_one_receipt_to_two_invoices_different_sites(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Customer, Invoice, Station

    s1 = Station.objects.create(company_id=company_tenant.id, station_name="Site-A", is_active=True)
    s2 = Station.objects.create(company_id=company_tenant.id, station_name="Site-B", is_active=True)
    cust = Customer.objects.create(
        company_id=company_tenant.id, display_name="Multi", current_balance=Decimal("200")
    )
    i1 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=s1.id,
        invoice_number="MIX-1",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("10"),
        tax_total=Decimal("0"),
        total=Decimal("10"),
    )
    i1.save()
    i2 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=s2.id,
        invoice_number="MIX-2",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("5"),
        tax_total=Decimal("0"),
        total=Decimal("5"),
    )
    i2.save()
    r = api_client.post(
        "/api/payments/received/",
        data=json.dumps(
            {
                "customer_id": cust.id,
                "amount": "15",
                "payment_date": str(date.today()),
                "invoice_allocations": [
                    {"invoice_id": i1.id, "amount": "10"},
                    {"invoice_id": i2.id, "amount": "5"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content
    assert b"different site" in r.content.lower()


def test_apply_payment_register_station_prefers_customer_default_among_invoices(company_tenant):
    """When allocations touch multiple invoice sites, header station prefers customer's default if it matches one."""
    from api.models import Customer, Invoice, Payment, PaymentInvoiceAllocation, Station
    from api.services.payment_station import apply_payment_register_station

    s1 = Station.objects.create(company_id=company_tenant.id, station_name="P-A", is_active=True)
    s2 = Station.objects.create(company_id=company_tenant.id, station_name="P-B", is_active=True)
    cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Split payer",
        current_balance=Decimal("0"),
        default_station_id=s1.id,
    )
    i1 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=s1.id,
        invoice_number="PS-1",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("1"),
        tax_total=Decimal("0"),
        total=Decimal("1"),
    )
    i1.save()
    i2 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=s2.id,
        invoice_number="PS-2",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("1"),
        tax_total=Decimal("0"),
        total=Decimal("1"),
    )
    i2.save()
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type=Payment.PAYMENT_TYPE_RECEIVED,
        customer_id=cust.id,
        amount=Decimal("2"),
        payment_date=date.today(),
    )
    PaymentInvoiceAllocation.objects.create(payment_id=p.id, invoice_id=i1.id, amount=Decimal("1"))
    PaymentInvoiceAllocation.objects.create(payment_id=p.id, invoice_id=i2.id, amount=Decimal("1"))
    apply_payment_register_station(company_tenant.id, p)
    p.refresh_from_db()
    assert p.station_id == s1.id


def test_apply_payment_register_station_min_id_when_no_matching_default(company_tenant):
    from api.models import Customer, Invoice, Payment, PaymentInvoiceAllocation, Station
    from api.services.payment_station import apply_payment_register_station

    s1 = Station.objects.create(company_id=company_tenant.id, station_name="Q-A", is_active=True)
    s2 = Station.objects.create(company_id=company_tenant.id, station_name="Q-B", is_active=True)
    cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="No default match",
        current_balance=Decimal("0"),
        default_station_id=None,
    )
    lo, hi = (s1, s2) if s1.id < s2.id else (s2, s1)
    i1 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=hi.id,
        invoice_number="PSX-1",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("1"),
        tax_total=Decimal("0"),
        total=Decimal("1"),
    )
    i1.save()
    i2 = Invoice(
        company_id=company_tenant.id,
        customer_id=cust.id,
        station_id=lo.id,
        invoice_number="PSX-2",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("1"),
        tax_total=Decimal("0"),
        total=Decimal("1"),
    )
    i2.save()
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type=Payment.PAYMENT_TYPE_RECEIVED,
        customer_id=cust.id,
        amount=Decimal("2"),
        payment_date=date.today(),
    )
    PaymentInvoiceAllocation.objects.create(payment_id=p.id, invoice_id=i1.id, amount=Decimal("1"))
    PaymentInvoiceAllocation.objects.create(payment_id=p.id, invoice_id=i2.id, amount=Decimal("1"))
    apply_payment_register_station(company_tenant.id, p)
    p.refresh_from_db()
    assert p.station_id == lo.id
