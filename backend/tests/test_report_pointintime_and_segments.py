"""
Regressions for three reporting defects:

1. A/R and A/P aging must be point-in-time — a document paid after the end date was still
   open on that date, and a document dated after the end date was not open yet.
2. Per-entity statements must still show a site or pond that was deactivated but still
   carries posted GL, or the segment rows stop adding up to the company total.
3. The depreciation projection must not repeat the month that was already posted.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    ChartOfAccount,
    Customer,
    Invoice,
    JournalEntry,
    JournalEntryLine,
    Payment,
    PaymentInvoiceAllocation,
    Vendor,
    Bill,
    PaymentBillAllocation,
)
from api.services.reporting import (
    report_ap_aging,
    report_ar_aging,
    report_entities_pl_summary,
    report_income_statement,
)


def _customer(cid: int, name: str = "Aging Co") -> Customer:
    return Customer.objects.create(
        company_id=cid, display_name=name, customer_number=name.replace(" ", "-"),
        current_balance=Decimal("0"),
    )


@pytest.mark.django_db
def test_ar_aging_counts_an_invoice_paid_after_the_end_date(company_tenant):
    cid = company_tenant.id
    cust = _customer(cid)
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-LATE-PAY",
        invoice_date=date(2026, 1, 10), due_date=date(2026, 1, 20),
        status="paid", total=Decimal("1000.00"),
    )
    pay = Payment.objects.create(
        company_id=cid, payment_type="received", customer=cust,
        amount=Decimal("1000.00"), payment_date=date(2026, 3, 5),
    )
    PaymentInvoiceAllocation.objects.create(payment=pay, invoice=inv, amount=Decimal("1000.00"))

    # End of January: the receipt is still two months away, so the invoice was open.
    jan = report_ar_aging(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert jan["totals"]["total"] == 1000.0

    # End of March: settled, so it drops out.
    mar = report_ar_aging(cid, date(2026, 1, 1), date(2026, 3, 31))
    assert mar["totals"]["total"] == 0.0


@pytest.mark.django_db
def test_ar_aging_excludes_invoices_issued_after_the_end_date(company_tenant):
    cid = company_tenant.id
    cust = _customer(cid, "Future Co")
    Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-FUTURE",
        invoice_date=date(2026, 6, 1), due_date=date(2026, 6, 15),
        status="sent", total=Decimal("500.00"),
    )
    out = report_ar_aging(cid, date(2026, 1, 1), date(2026, 5, 31))
    assert out["totals"]["total"] == 0.0
    assert report_ar_aging(cid, date(2026, 1, 1), date(2026, 6, 30))["totals"]["total"] == 500.0


@pytest.mark.django_db
def test_ar_aging_ignores_a_cash_sale_that_never_touched_receivables(company_tenant):
    cid = company_tenant.id
    cust = _customer(cid, "Walk In")
    Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-CASH",
        invoice_date=date(2026, 2, 1), status="paid", total=Decimal("250.00"),
        payment_method="cash",
    )
    out = report_ar_aging(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert out["totals"]["total"] == 0.0


@pytest.mark.django_db
def test_ar_aging_reports_its_reconciliation_to_the_control_account(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    cust = _customer(cid, "Recon Co")
    Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-RECON",
        invoice_date=date(2026, 2, 1), status="sent", total=Decimal("300.00"),
    )
    out = report_ar_aging(cid, date(2026, 1, 1), date(2026, 12, 31))
    recon = out["gl_reconciliation"]
    assert recon["control_account_code"] == "1100"
    assert recon["subledger_total"] == 300.0
    assert recon["unapplied_payments"] == 0.0


@pytest.mark.django_db
def test_ap_aging_counts_a_bill_paid_after_the_end_date(company_tenant):
    cid = company_tenant.id
    vend = Vendor.objects.create(
        company_id=cid, company_name="Late Paid Vendor", display_name="Late Paid Vendor",
        vendor_number="V-LATE",
    )
    bill = Bill.objects.create(
        company_id=cid, vendor=vend, bill_number="BILL-LATE",
        bill_date=date(2026, 1, 10), due_date=date(2026, 1, 25),
        status="paid", total=Decimal("800.00"),
    )
    pay = Payment.objects.create(
        company_id=cid, payment_type="made", vendor=vend,
        amount=Decimal("800.00"), payment_date=date(2026, 4, 2),
    )
    PaymentBillAllocation.objects.create(payment=pay, bill=bill, amount=Decimal("800.00"))

    assert report_ap_aging(cid, date(2026, 1, 1), date(2026, 1, 31))["totals"]["total"] == 800.0
    assert report_ap_aging(cid, date(2026, 1, 1), date(2026, 4, 30))["totals"]["total"] == 0.0


@pytest.mark.django_db
def test_entity_pl_rows_still_include_a_closed_pond_with_gl_history(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Retired Pond", is_active=False)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid, entry_number="JE-CLOSED-POND", entry_date=date(2026, 3, 1),
        description="Cost booked on a pond that was later closed", is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("1500.00"), credit=Decimal("0"),
        aquaculture_pond_id=pond.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("1500.00"),
    )

    out = report_entities_pl_summary(cid, date(2026, 1, 1), date(2026, 12, 31))
    pond_rows = [r for r in out["by_pond"] if r["entity_id"] == pond.id]
    assert pond_rows, "a closed pond carrying posted GL must still appear as an entity row"
    assert pond_rows[0]["expenses"] == 1500.0
    assert pond_rows[0]["is_active"] is False

    # The whole point: the slices have to add back up to the company.
    company = report_income_statement(cid, date(2026, 1, 1), date(2026, 12, 31))
    segments = (
        out["stations_total"]["expenses"]
        + out["ponds_total"]["expenses"]
        + out["unscoped"]["expenses"]
    )
    assert segments == pytest.approx(company["expenses"]["total"])


@pytest.mark.django_db
def test_depreciation_projection_starts_after_the_last_posted_month(company_tenant):
    from api.models import FixedAsset
    from api.services.fixed_asset_schedule import depreciation_schedule

    asset_acct = ChartOfAccount.objects.create(
        company_id=company_tenant.id, account_code="1500", account_name="Equipment", account_type="asset",
    )
    accum_acct = ChartOfAccount.objects.create(
        company_id=company_tenant.id, account_code="1590", account_name="Accum Depreciation",
        account_type="asset", account_sub_type="accumulated_depreciation",
    )
    dep_acct = ChartOfAccount.objects.create(
        company_id=company_tenant.id, account_code="6100", account_name="Depreciation Expense",
        account_type="expense",
    )
    asset = FixedAsset(
        company_id=company_tenant.id,
        name="Generator",
        asset_account=asset_acct,
        accumulated_depreciation_account=accum_acct,
        depreciation_expense_account=dep_acct,
        acquisition_cost=Decimal("120000.00"),
        salvage_value=Decimal("0"),
        useful_life_months=24,
        acquisition_date=date(2026, 1, 31),
        in_service_date=date(2026, 1, 31),
        accumulated_depreciation=Decimal("5000.00"),
        last_depreciation_date=date(2026, 5, 31),
    )
    asset.save()
    rows = depreciation_schedule(asset, max_rows=3)
    assert rows, "an asset with book value left should still project runs"
    assert rows[0]["run_date"] == "2026-06-28", rows[0]
    assert rows[1]["run_date"] == "2026-07-28", rows[1]
