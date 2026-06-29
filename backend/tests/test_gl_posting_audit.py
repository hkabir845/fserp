"""GL posting gap audit and backfill."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import ChartOfAccount, JournalEntry, Payment, Vendor
from api.services.gl_posting import post_payment_made_journal
from api.services.gl_posting_audit import (
    audit_company_gl_gaps,
    find_vendor_payment_made_gaps,
)


@pytest.mark.django_db
def test_find_vendor_payment_made_gap_when_no_journal(company_tenant):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Gap Vendor",
        display_name="Gap Vendor",
    )
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type="made",
        vendor_id=v.id,
        amount=Decimal("500.00"),
        payment_date=date(2026, 6, 1),
        payment_method="cash",
        vendor_ap_decremented=True,
    )
    gaps = find_vendor_payment_made_gaps(company_tenant.id)
    assert len(gaps) == 1
    assert gaps[0]["record_id"] == p.id
    assert gaps[0]["expected_entry_number"] == f"AUTO-PAY-{p.id}-MADE"
    assert gaps[0]["vendor_ap_decremented"] is True


@pytest.mark.django_db
def test_vendor_payment_made_posts_auto_pay_journal(company_tenant):
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="2000",
        account_name="Accounts Payable",
        account_type="liability",
        is_active=True,
    )
    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash on Hand",
        account_type="asset",
        is_active=True,
    )
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Pay Vendor",
        display_name="Pay Vendor",
    )
    p = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type="made",
        vendor_id=v.id,
        amount=Decimal("273000.00"),
        payment_date=date(2026, 6, 1),
        payment_method="cash",
    )
    assert post_payment_made_journal(company_tenant.id, p) is True
    je = JournalEntry.objects.filter(
        company_id=company_tenant.id,
        entry_number=f"AUTO-PAY-{p.id}-MADE",
    ).first()
    assert je is not None
    assert je.is_posted is True
    lines = list(je.lines.all())
    assert len(lines) == 2
    debits = sum(l.debit for l in lines)
    credits = sum(l.credit for l in lines)
    assert debits == credits == Decimal("273000.00")
    credit_line = next(l for l in lines if l.credit > 0)
    assert credit_line.account_id == cash.id

    report = audit_company_gl_gaps(company_tenant.id, gap_types=["vendor_payment_made"])
    assert report["total_gaps"] == 0
