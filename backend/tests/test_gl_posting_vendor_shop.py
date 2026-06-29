"""Vendor bill/payment GL for shop and aquaculture sites (not fuel-only)."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    Bill,
    ChartOfAccount,
    JournalEntry,
    JournalEntryLine,
    Payment,
    Station,
    Vendor,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.gl_posting import GlPostingError, post_bill_journal, sync_payment_made_gl
from api.services.gl_posting_audit import audit_company_gl_gaps, find_vendor_bill_gaps


@pytest.mark.django_db
def test_shop_bill_without_gl_does_not_increment_ap_only(company_tenant):
    """Posted bills must not bump vendor A/P when the AUTO-BILL journal cannot be built."""
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro Shop",
        station_number="SH-1",
        is_active=True,
        operates_fuel_retail=False,
    )
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Feed Supplier",
        display_name="Feed Supplier",
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor_id=v.id,
        receipt_station_id=shop.id,
        bill_number="BILL-NOGL-1",
        bill_date=date(2026, 6, 1),
        status="open",
        subtotal=Decimal("1000.00"),
        tax_total=Decimal("0"),
        total=Decimal("1000.00"),
    )
    # No COA seeded — journal build fails; A/P subledger must stay untouched.
    with pytest.raises(GlPostingError):
        post_bill_journal(company_tenant.id, bill)
    bill.refresh_from_db()
    v.refresh_from_db()
    assert bill.vendor_ap_incremented is False
    assert v.current_balance == Decimal("0")
    assert not JournalEntry.objects.filter(
        company_id=company_tenant.id, entry_number=f"AUTO-BILL-{bill.id}"
    ).exists()


@pytest.mark.django_db
def test_shop_vendor_cash_payment_posts_auto_pay_made_journal(company_tenant):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Aquaculture Shop Hub",
        station_number="AQ-SH",
        is_active=True,
        operates_fuel_retail=False,
    )
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Medicine Co",
        display_name="Medicine Co",
        default_station_id=shop.id,
    )
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type="made",
        vendor_id=v.id,
        amount=Decimal("273000.00"),
        payment_date=date(2026, 6, 15),
        payment_method="cash",
    )
    assert sync_payment_made_gl(company_tenant.id, p) is True
    p.refresh_from_db()
    je = JournalEntry.objects.get(
        company_id=company_tenant.id,
        entry_number=f"AUTO-PAY-{p.id}-MADE",
    )
    assert je.is_posted is True
    assert je.station_id == shop.id
    cash = ChartOfAccount.objects.get(company_id=company_tenant.id, account_code="1010")
    ap = ChartOfAccount.objects.get(company_id=company_tenant.id, account_code="2000")
    lines = list(je.lines.all())
    assert JournalEntryLine.objects.filter(journal_entry=je, account=ap, debit=Decimal("273000.00")).exists()
    assert JournalEntryLine.objects.filter(journal_entry=je, account=cash, credit=Decimal("273000.00")).exists()
    assert len(lines) == 2
    report = audit_company_gl_gaps(company_tenant.id, gap_types=["vendor_payment_made"])
    assert report["total_gaps"] == 0


@pytest.mark.django_db
def test_aquaculture_bill_gap_detected_when_ap_flag_without_journal(company_tenant):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    ensure_aquaculture_chart_accounts(company_tenant.id)
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Legacy Gap Vendor",
        display_name="Legacy Gap Vendor",
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor_id=v.id,
        bill_number="BILL-GAP-1",
        bill_date=date(2026, 5, 1),
        status="open",
        subtotal=Decimal("500.00"),
        tax_total=Decimal("0"),
        total=Decimal("500.00"),
        vendor_ap_incremented=True,
    )
    gaps = find_vendor_bill_gaps(company_tenant.id)
    assert any(g["record_id"] == bill.id for g in gaps)
    row = next(g for g in gaps if g["record_id"] == bill.id)
    assert row["vendor_ap_incremented"] is True


@pytest.mark.django_db
def test_api_payments_made_cash_posts_journal_for_shop_station(
    api_client, company_tenant, auth_admin_headers
):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    h = {**auth_admin_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Retail Shop",
        station_number="RS-1",
        is_active=True,
        operates_fuel_retail=False,
    )
    v_resp = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Shop Vendor", "default_station_id": shop.id}),
        content_type="application/json",
        **h,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    pay = api_client.post(
        "/api/payments/made/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "amount": "99.00",
                "payment_method": "cash",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pay.status_code == 201, pay.content
    pay_id = pay.json()["id"]
    assert JournalEntry.objects.filter(
        company_id=company_tenant.id,
        entry_number=f"AUTO-PAY-{pay_id}-MADE",
        is_posted=True,
    ).exists()
