"""Cash-flow statement: sections tie to cash, pond sales are not a cash proxy."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    ChartOfAccount,
    JournalEntry,
    JournalEntryLine,
)
from api.services.reporting import report_cash_flow

pytestmark = pytest.mark.django_db

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)
CENT = Decimal("0.02")


def _m(v) -> Decimal:
    return Decimal(str(v))


def _coa(company, code: str, name: str, account_type: str) -> ChartOfAccount:
    acc, _ = ChartOfAccount.objects.get_or_create(
        company=company,
        account_code=code,
        defaults={"account_name": name, "account_type": account_type, "is_active": True},
    )
    return acc


def _post(company_id: int, number: str, lines: list[tuple[ChartOfAccount, str, str]], pond_id: int | None = None):
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_date=date(2026, 6, 15),
        entry_number=number,
        description=number,
        is_posted=True,
    )
    for acc, debit, credit in lines:
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=acc,
            debit=Decimal(debit),
            credit=Decimal(credit),
            aquaculture_pond_id=pond_id,
        )
    return je


def test_cash_flow_sections_classify_and_tie_to_ending_cash(company_tenant_with_gl):
    company = company_tenant_with_gl
    cid = company.id
    cash = _coa(company, "1010", "Cash on Hand", "asset")
    revenue = _coa(company, "4100", "Fuel Sales", "income")
    equipment = _coa(company, "1520", "Equipment", "asset")
    loan = _coa(company, "2410", "Loan Payable", "liability")

    _post(cid, "CF-OP-1", [(cash, "400.00", "0"), (revenue, "0", "400.00")])
    _post(cid, "CF-INV-1", [(equipment, "150.00", "0"), (cash, "0", "150.00")])
    _post(cid, "CF-FIN-1", [(cash, "200.00", "0"), (loan, "0", "200.00")])

    cf = report_cash_flow(cid, PERIOD_START, PERIOD_END)
    cs = cf["cash_summary"]
    assert cf["statement_method"] == "direct"
    assert abs(_m(cs["cash_from_operating"]) - Decimal("400.00")) <= CENT
    assert abs(_m(cs["cash_from_investing"]) - Decimal("-150.00")) <= CENT
    assert abs(_m(cs["cash_from_financing"]) - Decimal("200.00")) <= CENT
    sections = (
        _m(cs["cash_from_operating"])
        + _m(cs["cash_from_investing"])
        + _m(cs["cash_from_financing"])
        + _m(cs["cash_transfers"])
    )
    assert abs((_m(cs["beginning_cash"]) + sections) - _m(cs["ending_cash"])) <= CENT
    assert abs(_m(cs["ending_cash"]) - Decimal("450.00")) <= CENT


def test_pond_registered_fish_sale_is_not_treated_as_cash(company_tenant_with_gl):
    company = company_tenant_with_gl
    cid = company.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="CF Sale Pond", pond_role="grow_out", is_active=True
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 7, 1),
        weight_kg=Decimal("20"),
        fish_count=100,
        total_amount=Decimal("8000.00"),
        income_type="fish_harvest_sale",
    )

    cf = report_cash_flow(cid, PERIOD_START, PERIOD_END, pond_id=pond.id)
    assert cf["filter_pond_id"] == pond.id
    assert abs(_m(cf["operating"]["customer_payments_received"])) <= CENT
    assert abs(_m(cf["cash_summary"]["cash_from_operating"])) <= CENT
    assert abs(_m(cf["cash_summary"]["ending_cash"])) <= CENT
    assert "aquaculture_sales_in_period" not in cf["operating"]


def test_cash_to_cash_transfer_nets_out_of_the_three_sections(company_tenant_with_gl):
    company = company_tenant_with_gl
    cid = company.id
    till = _coa(company, "1010", "Cash on Hand", "asset")
    bank = _coa(company, "1030", "Bank Operating", "asset")
    _post(cid, "CF-XFER-1", [(bank, "75.00", "0"), (till, "0", "75.00")])

    cf = report_cash_flow(cid, PERIOD_START, PERIOD_END)
    cs = cf["cash_summary"]
    assert abs(_m(cs["cash_from_operating"])) <= CENT
    assert abs(_m(cs["cash_from_investing"])) <= CENT
    assert abs(_m(cs["cash_from_financing"])) <= CENT
    assert abs(_m(cs["net_change_in_cash"])) <= CENT
    assert abs(_m(cs["total_deposits"]) - Decimal("75.00")) <= CENT
    assert abs(_m(cs["total_withdrawals"]) - Decimal("75.00")) <= CENT
