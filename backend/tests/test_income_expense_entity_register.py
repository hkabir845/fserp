"""The combined sheet preserves entity ownership and the pond register cost basis."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquaculturePond, ChartOfAccount, JournalEntry, JournalEntryLine, Station
from api.services.reporting import report_income_expense_statement


@pytest.mark.django_db
def test_combined_sheet_keeps_entity_costs_and_includes_capitalized_pond_inputs(company_tenant_with_gl):
    company = company_tenant_with_gl
    company.aquaculture_capitalize_pond_consumption_to_bioasset = True
    company.save(update_fields=["aquaculture_capitalize_pond_consumption_to_bioasset"])
    station = Station.objects.create(company=company, station_name="Adib Filling Station")
    pond = AquaculturePond.objects.create(company=company, name="Aquaculture Pond")
    accounts = {a.account_code: a for a in ChartOfAccount.objects.filter(company=company)}
    day = date(2026, 4, 2)

    def post(tag, amount, *, header_station=None, line_station=None, pond_id=None, code="6900"):
        entry = JournalEntry.objects.create(
            company=company, entry_number=tag, entry_date=day,
            station_id=header_station, is_posted=True,
        )
        for account, debit, credit in [(accounts[code], amount, "0"), (accounts["1010"], "0", amount)]:
            JournalEntryLine.objects.create(
                journal_entry=entry, account=account, station_id=line_station,
                aquaculture_pond_id=pond_id, debit=Decimal(debit), credit=Decimal(credit),
            )

    post("SHEET-HO", "70")
    # Legacy station lines inherit their journal header.
    post("SHEET-STATION", "50", header_station=station.id)
    # Pond ownership wins even when the receipt was at the filling station.
    post("SHEET-POND-COGS", "40", header_station=station.id, line_station=station.id, pond_id=pond.id, code="5100")
    AquacultureExpense.objects.create(
        company=company, pond=pond, expense_date=day,
        expense_category="miscellaneous", amount=Decimal("120"),
    )

    combined = report_income_expense_statement(company.id, day, day)
    individual = report_income_expense_statement(company.id, day, day, pond_id=pond.id)
    station_sheet = report_income_expense_statement(company.id, day, day, station_id=station.id)
    office_sheet = report_income_expense_statement(company.id, day, day, unscoped_dims=True)
    pond_lines = [r for r in combined["lines"] if r["entity_type"] == "pond"]
    assert pond_lines
    assert {r["entity_name"] for r in pond_lines} == {pond.name}
    assert sum(Decimal(r["expense"]) for r in pond_lines) == Decimal(individual["total_expense"]) == Decimal("120")
    assert Decimal(station_sheet["total_expense"]) == Decimal("50")
    assert Decimal(office_sheet["total_expense"]) == Decimal("70")
    assert Decimal(combined["total_expense"]) == Decimal("240")
    assert sum(Decimal(r["expense"]) for r in combined["lines"]) == Decimal("240")
    for row in combined["lines"]:
        if row["entity_type"] == "station":
            assert row["entity_id"] == station.id
            assert row["entity_name"] == station.station_name
            assert Decimal(row["expense"]) == Decimal("50")
        elif row["entity_type"] == "unscoped":
            assert "Head office" in row["entity_name"]
            assert Decimal(row["expense"]) == Decimal("70")
