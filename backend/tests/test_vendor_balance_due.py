"""Vendor A/P balance must match vendor ledger all-time closing."""
from decimal import Decimal

import pytest

from api.models import Bill, Payment, Vendor
from api.services.contact_ledgers import build_vendor_ledger, vendor_ap_balance
from api.services.payment_allocation import compute_vendor_balance_due


def _assert_balance_matches_ledger(company_id: int, vendor_id: int) -> Decimal:
    due = compute_vendor_balance_due(company_id, vendor_id)
    ap = vendor_ap_balance(company_id, vendor_id)
    payload = build_vendor_ledger(company_id, vendor_id)
    closing = Decimal(payload["closing_balance_all_time"])
    profile = Decimal(payload["stored_current_balance"])
    assert due == ap == closing == profile
    return due


@pytest.mark.django_db
def test_open_bill_counts_in_vendor_balance(company_tenant):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Credit supplier",
        display_name="Credit supplier",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        bill_number="BILL-TEST-OPEN",
        bill_date="2026-05-17",
        status="open",
        subtotal=Decimal("500"),
        tax_total=Decimal("0"),
        total=Decimal("500"),
    )
    assert _assert_balance_matches_ledger(company_tenant.id, v.id) == Decimal("500.00")


@pytest.mark.django_db
def test_opening_balance_minus_on_account_payment_matches_ledger(company_tenant):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Opening AP",
        display_name="Opening AP",
        opening_balance=Decimal("1000.00"),
        opening_balance_date="2026-01-01",
        current_balance=Decimal("1000.00"),
    )
    Payment.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        payment_type="made",
        amount=Decimal("400.00"),
        payment_date="2026-02-01",
        payment_method="cash",
        reference="ON-ACCT-V1",
        memo="Opening payment",
    )
    assert _assert_balance_matches_ledger(company_tenant.id, v.id) == Decimal("600.00")


@pytest.mark.django_db
def test_bill_and_payment_net_to_ledger(company_tenant):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Net AP",
        display_name="Net AP",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        bill_number="BILL-NET-1",
        bill_date="2026-05-01",
        status="open",
        subtotal=Decimal("300"),
        tax_total=Decimal("0"),
        total=Decimal("300"),
    )
    Payment.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        payment_type="made",
        amount=Decimal("100.00"),
        payment_date="2026-05-02",
        payment_method="cash",
        reference="PAY-PARTIAL",
    )
    assert _assert_balance_matches_ledger(company_tenant.id, v.id) == Decimal("200.00")


@pytest.mark.django_db
def test_overpayment_allows_vendor_credit_balance(company_tenant):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Overpay",
        display_name="Overpay",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        bill_number="BILL-CREDIT",
        bill_date="2026-05-01",
        status="open",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )
    Payment.objects.create(
        company_id=company_tenant.id,
        vendor=v,
        payment_type="made",
        amount=Decimal("150.00"),
        payment_date="2026-05-02",
        payment_method="cash",
        reference="OVERPAY-1",
    )
    assert _assert_balance_matches_ledger(company_tenant.id, v.id) == Decimal("-50.00")
