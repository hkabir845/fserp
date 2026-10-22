import io
import json
from datetime import date

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext

from api.models import Bill, BillLine, ChartOfAccount, JournalEntry, JournalEntryLine, Payment, PaymentBillAllocation, Station, Vendor


@pytest.mark.django_db
def test_audit_checks_all_dates_and_head_office_without_writing(company_tenant_with_gl):
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name="Adib")
    vendor = Vendor.objects.create(company=company, display_name="Power vendor")
    expense = ChartOfAccount.objects.get(company=company, account_code="6900")
    cash = ChartOfAccount.objects.get(company=company, account_code="1010")
    bill = Bill.objects.create(company=company, vendor=vendor, bill_number="OFFICE",
                               bill_date=date(2026, 9, 4), status="open", total=100)
    BillLine.objects.create(bill=bill, description="Electricity for Head Office", amount=100,
                             charge_to_head_office=True)
    entry = JournalEntry.objects.create(company=company, entry_number=f"AUTO-BILL-{bill.id}",
                                        entry_date=bill.bill_date, station=station, is_posted=True)
    JournalEntryLine.objects.create(journal_entry=entry, account=expense, debit=100, station=station)
    JournalEntryLine.objects.create(journal_entry=entry, account=cash, credit=100, station=station)
    payment = Payment.objects.create(company=company, vendor=vendor, payment_type="made",
                                     payment_date=bill.bill_date, amount=100)
    PaymentBillAllocation.objects.create(payment=payment, bill=bill, amount=100)
    paid = JournalEntry.objects.create(company=company, entry_number=f"AUTO-PAY-{payment.id}-MADE",
                                       entry_date=bill.bill_date, station=station, is_posted=True)
    payable = ChartOfAccount.objects.get(company=company, account_code="2000")
    JournalEntryLine.objects.create(journal_entry=paid, account=payable, debit=100, station=station)
    JournalEntryLine.objects.create(journal_entry=paid, account=cash, credit=100, station=station)
    historical = JournalEntry.objects.create(company=company, entry_number="WRONG-YEAR",
                                             entry_date=date(205, 3, 24), is_posted=True)
    JournalEntryLine.objects.create(journal_entry=historical, account=expense, debit=25)
    JournalEntryLine.objects.create(journal_entry=historical, account=cash, credit=25)
    before = list(JournalEntryLine.objects.order_by("id").values())
    out = io.StringIO()
    with CaptureQueriesContext(connection) as queries:
        call_command("audit_income_expense_entities", company_id=company.id, stdout=out)
    assert not any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "ALTER", "CREATE")) for q in queries)
    assert list(JournalEntryLine.objects.order_by("id").values()) == before
    result = json.loads(out.getvalue())
    assert result["read_only"] is True
    data = result["companies"][0]
    assert data["period"]["start"] == "0205-03-24"
    assert data["issue_counts"]["bill_charge_to_mismatch"] == 2
    assert data["issue_counts"]["payment_charge_to_mismatch"] == 2
    assert data["head_office_report"]["expense"] == "25.00"
    assert all(check["passed"] for check in data["report_checks"])
    assert data["head_office_description_checks"][0]["charge_to"] == "ho"
    assert len(data["suspect_dates"]) == 1
    # A historical bill outside an October-only view is not silently included.
    out = io.StringIO()
    call_command("audit_income_expense_entities", company_id=company.id,
                 start_date=date(2026, 10, 19), end_date=date(2026, 10, 19), stdout=out)
    october = json.loads(out.getvalue())["companies"][0]
    assert october["posted_journal_count"] == 0
    assert october["issues"] == []
    assert october["head_office_report"]["lines"] == []


@pytest.mark.django_db
def test_head_office_description_does_not_reassign_a_bill(company_tenant_with_gl):
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name="Adib")
    vendor = Vendor.objects.create(company=company, display_name="Vendor")
    bill = Bill.objects.create(company=company, vendor=vendor, bill_number="TRANSPORT",
                               bill_date=date(2026, 8, 23), receipt_station=station, total=220)
    line = BillLine.objects.create(bill=bill, description="Transport for Head Office", amount=220)
    JournalEntry.objects.create(company=company, entry_number="TEST", entry_date=bill.bill_date, is_posted=True)
    out = io.StringIO()
    call_command("audit_income_expense_entities", company_id=company.id, stdout=out)
    data = json.loads(out.getvalue())["companies"][0]
    assert data["head_office_description_checks"][0]["needs_review"] is True
    bill.refresh_from_db(); line.refresh_from_db()
    assert bill.receipt_station_id == station.id
    assert line.charge_to_head_office is False


@pytest.mark.django_db
def test_deleted_pond_opening_is_flagged_instead_of_assumed_head_office(company_tenant_with_gl):
    company = company_tenant_with_gl
    entry = JournalEntry.objects.create(company=company, entry_number="AUTO-POND-PL-OB-999999",
                                        entry_date=date(2025, 2, 28), is_posted=True)
    expense = ChartOfAccount.objects.get(company=company, account_code="6900")
    cash = ChartOfAccount.objects.get(company=company, account_code="1010")
    JournalEntryLine.objects.create(journal_entry=entry, account=expense, debit=100)
    JournalEntryLine.objects.create(journal_entry=entry, account=cash, credit=100)
    out = io.StringIO()
    call_command("audit_income_expense_entities", company_id=company.id, stdout=out)
    data = json.loads(out.getvalue())["companies"][0]
    assert data["issue_counts"]["orphaned_pond_opening_journal"] == 1
    assert data["issues"][0]["expense"] == "100.00"
    assert data["issues"][0]["pond_exists"] is False
    assert entry.lines.filter(aquaculture_pond_id__isnull=True).count() == 2
