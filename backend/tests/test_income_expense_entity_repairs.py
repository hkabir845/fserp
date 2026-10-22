import io
import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from api.models import (
    AquaculturePond, Bill, BillLine, ChartOfAccount, Item,
    JournalEntry, JournalEntryLine, Station, Vendor,
)
from api.services.aquaculture_cost_per_kg import posted_unallocated_vendor_bill_bucket_additions

DAY = date(2026, 10, 19)


@pytest.mark.django_db
def test_inventory_purchases_are_not_unallocated_pond_expenses(company_tenant_with_gl):
    company = company_tenant_with_gl
    vendor = Vendor.objects.create(company=company, display_name="Feed vendor")
    bill = Bill.objects.create(company=company, vendor=vendor, bill_number="MIXED", bill_date=DAY,
                               status="open", total=Decimal("120"))
    inventory = ChartOfAccount.objects.create(company=company, account_code="1599",
                                               account_name="Feed stock", account_type="asset")
    item = Item.objects.create(company=company, name="Feed", item_type="inventory", inventory_account=inventory)
    BillLine.objects.create(bill=bill, item=item, amount=100, aquaculture_cost_bucket="feed")
    BillLine.objects.create(bill=bill, amount=20, aquaculture_cost_bucket="transportation")
    JournalEntry.objects.create(company=company, entry_number=f"AUTO-BILL-{bill.id}",
                                entry_date=DAY, is_posted=True)
    assert posted_unallocated_vendor_bill_bucket_additions(
        company_id=company.id, start=DAY, end=DAY,
    ) == {"transportation": Decimal("20")}
    # Selling those inputs to the pond still recognizes the cost at that pond.
    pond = AquaculturePond.objects.create(company=company, name="Mynuddin Pond")
    sale_cost = JournalEntry.objects.create(company=company, entry_number="AUTO-INV-TEST-COGS",
                                             entry_date=DAY, is_posted=True)
    cogs = ChartOfAccount.objects.get(company=company, account_code="5100")
    JournalEntryLine.objects.create(journal_entry=sale_cost, account=cogs, debit=100,
                                     aquaculture_pond=pond, aquaculture_cost_bucket="feed")
    JournalEntryLine.objects.create(journal_entry=sale_cost, account=inventory, credit=100,
                                     aquaculture_pond=pond)
    from api.services.reporting import report_income_expense_statement
    report = report_income_expense_statement(company.id, DAY, DAY)
    feed_rows = [row for row in report["lines"] if "feed" in row["account_code"].lower()]
    assert sum(Decimal(row["expense"]) for row in feed_rows) == Decimal("100")
    assert {row["entity_id"] for row in feed_rows} == {pond.id}


@pytest.mark.django_db
def test_repair_is_dry_by_default_idempotent_and_preserves_amounts(company_tenant_with_gl):
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name="Adib")
    vendor = Vendor.objects.create(company=company, display_name="Office vendor")
    bill = Bill.objects.create(company=company, vendor=vendor, bill_number="OFFICE", bill_date=DAY,
                               status="open", total=50, receipt_station=station)
    source = BillLine.objects.create(bill=bill, description="Electricity for Head Office", amount=50)
    entry = JournalEntry.objects.create(company=company, entry_number=f"AUTO-BILL-{bill.id}",
                                        entry_date=DAY, is_posted=True, station=station)
    expense = ChartOfAccount.objects.get(company=company, account_code="6900")
    cash = ChartOfAccount.objects.get(company=company, account_code="1010")
    for account, debit, credit in [(expense, 50, 0), (cash, 0, 50)]:
        JournalEntryLine.objects.create(journal_entry=entry, account=account, station=station,
                                         debit=debit, credit=credit)
    donation = JournalEntry.objects.create(company=company, entry_number="AUTO-POS-DON-TEST",
                                           entry_date=DAY, is_posted=True)
    for account, debit, credit in [(expense, 10, 0), (cash, 0, 10)]:
        JournalEntryLine.objects.create(journal_entry=donation, account=account, debit=debit, credit=credit)
    before = list(JournalEntryLine.objects.order_by("id").values_list("id", "debit", "credit"))
    options = dict(company_id=company.id, through=DAY,
                   head_office_bill_number=["OFFICE"], donation_station_id=station.id)
    call_command("repair_income_expense_entities", **options, stdout=io.StringIO())
    entry.refresh_from_db()
    assert entry.station_id == station.id
    call_command("repair_income_expense_entities", **options, apply=True, stdout=io.StringIO())
    entry.refresh_from_db(); bill.refresh_from_db(); source.refresh_from_db(); donation.refresh_from_db()
    assert entry.station_id is bill.receipt_station_id is source.receipt_station_id is None
    assert set(entry.lines.values_list("station_id", flat=True)) == {None}
    assert donation.station_id == station.id
    assert set(donation.lines.values_list("station_id", flat=True)) == {station.id}
    assert before == list(JournalEntryLine.objects.order_by("id").values_list("id", "debit", "credit"))
    output = io.StringIO()
    call_command("repair_income_expense_entities", **options, apply=True, stdout=output)
    assert json.loads(output.getvalue())["changed_field_count"] == 0
    # Tenant mismatch must fail before any changes.
    with pytest.raises(CommandError):
        call_command("repair_income_expense_entities", company_id=company.id + 1000,
                     through=DAY, donation_station_id=station.id, apply=True, stdout=io.StringIO())


@pytest.mark.django_db
def test_donation_without_shift_keeps_selected_station(api_client, company_tenant_with_gl, auth_admin_headers):
    station = Station.objects.create(company=company_tenant_with_gl, station_name="Selected register")
    other = Station.objects.create(company=company_tenant_with_gl, station_name="Other register")
    response = api_client.post("/api/cashier/cash-donation/", data=json.dumps({
        "amount": "10", "entry_date": DAY.isoformat(), "station_id": station.id,
    }), content_type="application/json", **auth_admin_headers)
    assert response.status_code == 201, response.content
    entry = JournalEntry.objects.get(pk=response.json()["journal_id"])
    assert entry.station_id == station.id
    assert set(entry.lines.values_list("station_id", flat=True)) == {station.id}
    response = api_client.post("/api/cashier/cash-donation/", data=json.dumps({
        "amount": "10", "station_id": other.id + 9999,
    }), content_type="application/json", **auth_admin_headers)
    assert response.status_code == 400
