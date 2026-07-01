"""Journal entry Site column: pond tag must win over receipt station (entity P&L rule)."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest


@pytest.mark.django_db
def test_journal_entry_site_label_prefers_pond_over_receipt_station(
    api_client, company_tenant, auth_admin_headers
):
    from api.models import (
        AquaculturePond,
        ChartOfAccount,
        JournalEntry,
        JournalEntryLine,
        Station,
    )

    cid = company_tenant.id
    shop = Station.objects.create(
        company_id=cid, station_name="Premium Agro", operates_fuel_retail=False, is_active=True
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonto", is_active=True)
    expense = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="6717",
        account_name="Electricity",
        account_type="expense",
        is_active=True,
    )
    ap = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="2000",
        account_name="Accounts Payable",
        account_type="liability",
        is_active=True,
    )

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUTO-BILL-999",
        entry_date="2025-06-03",
        description="Bill BILL-214",
        station_id=shop.id,
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        debit=Decimal("14960.00"),
        credit=Decimal("0"),
        station_id=shop.id,
        aquaculture_pond_id=pond.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=ap,
        debit=Decimal("0"),
        credit=Decimal("14960.00"),
        station_id=shop.id,
        aquaculture_pond_id=pond.id,
    )

    r = api_client.get(f"/api/journal-entries/{je.id}/", **auth_admin_headers)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["station_name"] == "Digonto"
    assert body["lines"][0]["station_name"] == "Digonto"


@pytest.mark.django_db
def test_payment_made_journal_site_shows_pond_from_bill_allocation(
    api_client, company_tenant, auth_admin_headers
):
    from api.models import (
        AquaculturePond,
        Bill,
        BillLine,
        ChartOfAccount,
        JournalEntry,
        JournalEntryLine,
        Payment,
        PaymentBillAllocation,
        Station,
        Vendor,
    )

    cid = company_tenant.id
    shop = Station.objects.create(
        company_id=cid, station_name="Premium Agro", operates_fuel_retail=False, is_active=True
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Ashari - 1", is_active=True)
    vendor = Vendor.objects.create(
        company_id=cid, company_name="Feed Co", display_name="Feed Co", is_active=True
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor_id=vendor.id,
        bill_number="BILL-214",
        bill_date="2025-06-03",
        status="open",
        receipt_station_id=shop.id,
        total=Decimal("14960.00"),
        subtotal=Decimal("14960.00"),
    )
    BillLine.objects.create(
        bill_id=bill.id,
        description="Feed",
        quantity=Decimal("1"),
        unit_price=Decimal("14960.00"),
        amount=Decimal("14960.00"),
        aquaculture_pond_id=pond.id,
    )
    payment = Payment.objects.create(
        company_id=cid,
        vendor_id=vendor.id,
        payment_type="made",
        payment_date="2025-06-03",
        amount=Decimal("14960.00"),
        station_id=shop.id,
    )
    PaymentBillAllocation.objects.create(
        payment_id=payment.id, bill_id=bill.id, amount=Decimal("14960.00")
    )

    ap = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="2000",
        account_name="AP",
        account_type="liability",
        is_active=True,
    )
    cash = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number=f"AUTO-PAY-{payment.id}-MADE",
        entry_date="2025-06-03",
        description=f"Payment made #{payment.id}",
        station_id=shop.id,
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=ap, debit=Decimal("14960.00"), credit=Decimal("0"), station_id=shop.id
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("14960.00"), station_id=shop.id
    )

    r = api_client.get(f"/api/journal-entries/{je.id}/", **auth_admin_headers)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["station_name"] == "Ashari - 1"
