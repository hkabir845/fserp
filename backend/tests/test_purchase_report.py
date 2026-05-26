"""Purchase Report: cash vs credit vendor totals in a date range."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import Bill, Payment, PaymentBillAllocation, Vendor
from api.services.reporting import report_purchase_report


@pytest.mark.django_db
def test_purchase_report_splits_cash_and_credit_vendors(company_tenant):
    cash_vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Cash Supplier Ltd",
        display_name="Cash Supplier",
        vendor_number="V-CASH",
    )
    credit_vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Credit Supplier Ltd",
        display_name="Credit Supplier",
        vendor_number="V-CR",
    )

    paid_bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=cash_vendor,
        bill_number="BILL-PAID-1",
        bill_date=date(2026, 5, 10),
        status="paid",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )
    open_bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=credit_vendor,
        bill_number="BILL-OPEN-1",
        bill_date=date(2026, 5, 12),
        status="open",
        subtotal=Decimal("250"),
        tax_total=Decimal("0"),
        total=Decimal("250"),
    )
    partial_bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=credit_vendor,
        bill_number="BILL-PART-1",
        bill_date=date(2026, 5, 15),
        status="partial",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )

    pay = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type=Payment.PAYMENT_TYPE_MADE,
        vendor=cash_vendor,
        amount=Decimal("100"),
        payment_date=date(2026, 5, 10),
        payment_method="cash",
    )
    PaymentBillAllocation.objects.create(payment=pay, bill=paid_bill, amount=Decimal("100"))

    pay2 = Payment.objects.create(
        company_id=company_tenant.id,
        payment_type=Payment.PAYMENT_TYPE_MADE,
        vendor=credit_vendor,
        amount=Decimal("40"),
        payment_date=date(2026, 5, 16),
        payment_method="transfer",
    )
    PaymentBillAllocation.objects.create(payment=pay2, bill=partial_bill, amount=Decimal("40"))

    # Outside range — excluded
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=cash_vendor,
        bill_number="BILL-OLD",
        bill_date=date(2026, 4, 1),
        status="open",
        subtotal=Decimal("999"),
        tax_total=Decimal("0"),
        total=Decimal("999"),
    )
    # Draft — excluded
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=cash_vendor,
        bill_number="BILL-DRAFT",
        bill_date=date(2026, 5, 11),
        status="draft",
        subtotal=Decimal("10"),
        tax_total=Decimal("0"),
        total=Decimal("10"),
    )

    payload = report_purchase_report(
        company_tenant.id,
        start=date(2026, 5, 1),
        end=date(2026, 5, 31),
    )

    assert payload["report_id"] == "purchase-report"
    assert payload["summary"]["cash_bill_count"] == 2
    assert payload["summary"]["credit_bill_count"] == 2
    assert Decimal(str(payload["summary"]["cash_purchase_total"])) == Decimal("140")
    assert Decimal(str(payload["summary"]["credit_purchase_total"])) == Decimal("310")
    assert Decimal(str(payload["summary"]["grand_total"])) == Decimal("450")

    assert len(payload["cash_vendors"]) == 2
    cash_by_name = {r["display_name"]: r for r in payload["cash_vendors"]}
    assert Decimal(str(cash_by_name["Cash Supplier"]["total"])) == Decimal("100")
    assert Decimal(str(cash_by_name["Credit Supplier"]["total"])) == Decimal("40")

    assert len(payload["credit_vendors"]) == 1
    assert payload["credit_vendors"][0]["display_name"] == "Credit Supplier"
    assert payload["credit_vendors"][0]["bill_count"] == 2
    assert Decimal(str(payload["credit_vendors"][0]["total"])) == Decimal("310")
