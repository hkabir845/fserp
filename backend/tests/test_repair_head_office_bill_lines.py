import io
import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from api.models import (
    Bill, BillLine, ChartOfAccount, Item, JournalEntry, JournalEntryLine,
    Payment, PaymentBillAllocation, Station, Vendor,
)
from api.services.gl_posting import CODE_AP, sync_payment_made_gl
from api.services.reporting import report_income_expense_statement

DAY = date(2026, 10, 19)


def legacy_bills(company):
    station = Station.objects.create(company=company, station_name="Adib")
    vendor = Vendor.objects.create(company=company, display_name="Expense vendor", default_station=station)
    expense = ChartOfAccount.objects.get(company=company, account_code="6900")
    payable = ChartOfAccount.objects.get(company=company, account_code=CODE_AP)
    selected, bills, payments = [], [], []
    for number, amounts in [("MEALS", [200]), ("REPAIRS", [100, 100, 75])]:
        bill = Bill.objects.create(company=company, vendor=vendor, bill_number=number,
                                   bill_date=DAY, status="paid", subtotal=sum(amounts),
                                   total=sum(amounts), receipt_station=station)
        entry = JournalEntry.objects.create(company=company, entry_number=f"AUTO-BILL-{bill.id}",
                                            entry_date=DAY, is_posted=True, station=station)
        for amount in amounts:
            line = BillLine.objects.create(bill=bill, description="Generic expense", amount=amount,
                                           unit_price=amount, expense_account=expense)
            JournalEntryLine.objects.create(journal_entry=entry, account=expense,
                                             station=station, debit=amount)
            if amount != 75:
                selected.append(line)
        JournalEntryLine.objects.create(journal_entry=entry, account=payable,
                                         station=station, credit=sum(amounts))
        payment = Payment.objects.create(company=company, vendor=vendor, payment_type="made",
                                         payment_date=DAY, amount=sum(amounts), payment_method="cash",
                                         station=station)
        PaymentBillAllocation.objects.create(payment=payment, bill=bill, amount=sum(amounts))
        assert sync_payment_made_gl(company.id, payment)
        bills.append(bill)
        payments.append(payment)
    return station, bills, payments, selected


def repair(company, selected, **overrides):
    options = dict(company_id=company.id, on_date=DAY,
                   line=[(line.id, line.amount) for line in selected])
    options.update(overrides)
    output = io.StringIO()
    arguments = ["--company-id", str(options.pop("company_id")),
                 "--on-date", str(options.pop("on_date"))]
    for line_id, amount in options.pop("line"):
        arguments.extend(["--line", f"{line_id}:{amount}"])
    call_command("repair_head_office_bill_lines", *arguments, stdout=output, **options)
    return json.loads(output.getvalue())


@pytest.mark.django_db
def test_confirmed_three_lines_repair_paid_bills_payments_and_reports(company_tenant_with_gl):
    company = company_tenant_with_gl
    station, bills, payments, selected = legacy_bills(company)
    before = report_income_expense_statement(company.id, DAY, DAY)
    assert repair(company, selected)["changed_source_line_count"] == 3
    assert not BillLine.objects.filter(pk__in=[line.id for line in selected], charge_to_head_office=True).exists()
    assert report_income_expense_statement(company.id, DAY, DAY, unscoped_dims=True)["total_expense"] == "0.00"

    result = repair(company, selected, apply=True)
    assert result["changed_source_line_count"] == 3
    assert result["changed_journal_count"] == 4
    assert result["financial_totals_unchanged"]
    assert report_income_expense_statement(company.id, DAY, DAY, unscoped_dims=True)["total_expense"] == "400.00"
    assert report_income_expense_statement(company.id, DAY, DAY, station_id=station.id)["total_expense"] == "75.00"
    after = report_income_expense_statement(company.id, DAY, DAY)
    assert after["total_expense"] == before["total_expense"]
    assert sum(Decimal(row["expense"]) for row in after["lines"] if row["entity_type"] == "unscoped") == 400
    # Physical receipt location remains independent of the accounting owner.
    for bill in bills:
        bill.refresh_from_db()
        assert bill.status == "paid"
        assert bill.receipt_station_id == station.id
    for payment in payments:
        payment.refresh_from_db()
        assert payment.station_id is None
        entry = JournalEntry.objects.get(company=company, entry_number=f"AUTO-PAY-{payment.id}-MADE")
        assert sum(entry.lines.filter(station_id__isnull=True).values_list("debit", flat=True)) == 200
    again = repair(company, selected, apply=True)
    assert again["changed_source_line_count"] == again["changed_journal_count"] == 0


@pytest.mark.django_db
@pytest.mark.parametrize("invalid", ["amount", "date", "tenant", "inventory", "journal", "duplicate"])
def test_review_guards_leave_all_sources_and_journals_unchanged(company_tenant_with_gl, invalid):
    company = company_tenant_with_gl
    _, bills, _, selected = legacy_bills(company)
    options = {}
    if invalid == "amount":
        options["line"] = [(selected[0].id, selected[0].amount), (selected[1].id, Decimal("99"))]
    elif invalid == "date":
        options["on_date"] = date(2026, 10, 18)
    elif invalid == "tenant":
        options["company_id"] = company.id + 9999
    elif invalid == "inventory":
        item = Item.objects.create(company=company, name="Inventory", item_type="inventory")
        BillLine.objects.filter(pk=selected[-1].pk).update(item=item)
    elif invalid == "journal":
        JournalEntry.objects.filter(company=company, entry_number=f"AUTO-BILL-{bills[-1].id}").update(is_posted=False)
    else:
        options["line"] = [(selected[0].id, selected[0].amount)] * 2
    before = list(JournalEntryLine.objects.order_by("id").values())
    with pytest.raises(CommandError):
        repair(company, selected, apply=True, **options)
    assert not BillLine.objects.filter(pk__in=[line.id for line in selected], charge_to_head_office=True).exists()
    assert before == list(JournalEntryLine.objects.order_by("id").values())


@pytest.mark.parametrize("value", ["bad", "1:NaN", "1:Infinity", "1:-100", "0:100"])
def test_line_argument_rejects_invalid_review_specifications(value):
    from api.management.commands.repair_head_office_bill_lines import line_spec

    with pytest.raises(CommandError):
        line_spec(value)
