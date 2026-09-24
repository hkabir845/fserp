"""Contra-asset accounts must REDUCE total assets on the balance sheet.

Accumulated depreciation and the allowance for doubtful accounts are stored with
``account_type="asset"`` and a contra sub-type, and they carry credit balances. A balance
sheet that signs them by their *normal balance* rather than by the section they are printed
in reports them as a positive asset, so total assets are overstated by twice the accumulated
depreciation and the sheet stops balancing.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def _acc(company_id, code, name, typ, sub=""):
    from api.models import ChartOfAccount

    return ChartOfAccount.objects.get_or_create(
        company_id=company_id,
        account_code=code,
        defaults={
            "account_name": name,
            "account_type": typ,
            "account_sub_type": sub,
            "is_active": True,
        },
    )[0]


def _seed_books_with_depreciation(company_tenant):
    """Equipment 100,000 funded by equity, then 30,000 of accumulated depreciation."""
    from api.models import JournalEntry, JournalEntryLine

    cid = company_tenant.id
    equip = _acc(cid, "1500", "Equipment", "asset", "machinery_and_equipment")
    accum = _acc(cid, "1550", "Accumulated Depreciation", "asset", "accumulated_depreciation")
    capital = _acc(cid, "3000", "Owner Capital", "equity", "owners_equity")
    dep_exp = _acc(cid, "6500", "Depreciation Expense", "expense", "other_business_expenses")

    def entry(number, rows):
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=number,
            entry_date=date(2026, 3, 31),
            description=number,
            is_posted=True,
        )
        for acc, d, c in rows:
            JournalEntryLine.objects.create(
                journal_entry=je, account=acc, debit=d, credit=c, description=number
            )

    entry("TEST-ASSET-BUY", [(equip, Decimal("100000"), Decimal("0")),
                            (capital, Decimal("0"), Decimal("100000"))])
    entry("TEST-DEPRECIATION", [(dep_exp, Decimal("30000"), Decimal("0")),
                                (accum, Decimal("0"), Decimal("30000"))])
    return company_tenant


def test_accumulated_depreciation_reduces_total_assets(company_tenant):
    from api.services.reporting import report_balance_sheet

    books_with_depreciation = _seed_books_with_depreciation(company_tenant)

    bs = report_balance_sheet(
        books_with_depreciation.id, date(2026, 1, 1), date(2026, 12, 31)
    )
    row = next(
        r for r in bs["assets"]["accounts"] if r["account_code"] == "1550"
    )
    assert row["balance"] == "-30000.00", (
        "Accumulated depreciation is a contra-asset: it must print as a negative "
        "balance inside the asset section, not as a positive asset."
    )
    # Equipment 100,000 less 30,000 accumulated depreciation = 70,000 net book value.
    assert bs["assets"]["total"] == "70000.00"


def test_balance_sheet_with_depreciation_needs_no_plug(company_tenant):
    from api.services.reporting import report_balance_sheet

    books_with_depreciation = _seed_books_with_depreciation(company_tenant)

    bs = report_balance_sheet(
        books_with_depreciation.id, date(2026, 1, 1), date(2026, 12, 31)
    )
    assert bs["auto_plug_amount"] == "0.00", (
        "Assets 70,000 = Equity 100,000 capital - 30,000 depreciation expense. "
        "Nothing should need plugging."
    )
    assert bs["is_balanced"] is True


def test_station_and_pond_sheets_subtract_accumulated_depreciation(company_tenant):
    from api.models import AquaculturePond, JournalEntry, Station
    from api.services.reporting import report_balance_sheet

    cid = company_tenant.id
    equip = _acc(cid, "1500", "Equipment", "asset", "machinery_and_equipment")
    accum = _acc(cid, "1550", "Accumulated Depreciation", "asset", "accumulated_depreciation")
    station = Station.objects.create(company_id=cid, station_name="Dep Bay", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Dep Pond", is_active=True)

    def entry(number, station_id=None, pond_id=None):
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=number,
            entry_date=date(2026, 3, 31),
            description=number,
            is_posted=True,
            station_id=station_id,
        )
        from api.models import JournalEntryLine

        JournalEntryLine.objects.create(
            journal_entry=je, account=equip, debit=Decimal("100000"), credit=Decimal("0"),
            aquaculture_pond_id=pond_id,
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=accum, debit=Decimal("0"), credit=Decimal("30000"),
            aquaculture_pond_id=pond_id,
        )

    entry("TEST-SITE-DEP", station_id=station.id)
    site = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31), station_id=station.id)
    site_accum = next(r for r in site["assets"]["accounts"] if r["account_code"] == "1550")
    assert site_accum["balance"] == "-30000.00"
    assert site["assets"]["total"] == "70000.00"

    entry("TEST-POND-DEP", pond_id=pond.id)
    pond_bs = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31), pond_id=pond.id)
    pond_accum = next(r for r in pond_bs["assets"]["accounts"] if r["account_code"] == "1550")
    assert pond_accum["balance"] == "-30000.00"
    assert pond_bs["assets"]["total"] == "70000.00"
