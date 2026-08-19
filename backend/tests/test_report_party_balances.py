"""Tests for the consolidated party balances report (A/R, A/P, banks, loans)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    Bill,
    ChartOfAccount,
    Customer,
    Invoice,
    Loan,
    LoanCounterparty,
    Vendor,
)
from api.services.reporting import report_party_balances


def _section(out: dict, key: str) -> dict:
    return next(s for s in out["sections"] if s["key"] == key)


@pytest.mark.django_db
def test_party_balances_has_all_sections(company_tenant):
    out = report_party_balances(company_tenant.id, date(2026, 1, 1), date(2026, 1, 31))
    assert out["report_id"] == "party-balances"
    assert out["balances_as_of"] == "2026-01-31"
    assert [s["key"] for s in out["sections"]] == [
        "customers",
        "vendors",
        "bank_accounts",
        "loans",
        "internal_customers",
        "internal_vendors",
    ]
    assert [s["internal"] for s in out["sections"]] == [
        False,
        False,
        False,
        False,
        True,
        True,
    ]
    assert out["parties"] == []
    assert out["summary"]["net_position"] == 0.0


@pytest.mark.django_db
def test_customer_receivable_is_positive_and_vendor_payable_is_negative(company_tenant):
    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid,
        display_name="Rahman Traders",
        customer_number="C-PB-1",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-PB-1",
        invoice_date=date(2026, 1, 5),
        due_date=date(2026, 1, 20),
        status="sent",
        total=Decimal("1000.00"),
    )
    vendor = Vendor.objects.create(
        company_id=cid,
        company_name="Delta Feeds Ltd",
        vendor_number="V-PB-1",
        current_balance=Decimal("0"),
    )
    Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-PB-1",
        bill_date=date(2026, 1, 6),
        due_date=date(2026, 1, 25),
        status="open",
        total=Decimal("400.00"),
    )

    out = report_party_balances(cid, date(2026, 1, 1), date(2026, 1, 31))

    customers = _section(out, "customers")
    assert customers["count"] == 1
    crow = customers["rows"][0]
    assert crow["party_type"] == "customer"
    assert crow["name"] == "Rahman Traders"
    assert crow["balance"] == 1000.0
    assert crow["net_position"] == 1000.0

    vendors = _section(out, "vendors")
    assert vendors["count"] == 1
    vrow = vendors["rows"][0]
    assert vrow["party_type"] == "vendor"
    assert vrow["balance"] == 400.0
    # Money we owe is a negative position for the company.
    assert vrow["net_position"] == -400.0
    assert vendors["total_payable"] == 400.0

    summary = out["summary"]
    assert summary["party_count"] == 2
    assert summary["customer_receivable"] == 1000.0
    assert summary["vendor_payable"] == 400.0
    assert summary["total_receivable"] == 1000.0
    assert summary["total_payable"] == 400.0
    assert summary["net_position"] == 600.0


@pytest.mark.django_db
def test_loans_split_by_direction_and_draft_excluded(company_tenant):
    cid = company_tenant.id
    bank = LoanCounterparty.objects.create(company_id=cid, code="CP-1", name="Agrani Bank")
    sister = LoanCounterparty.objects.create(company_id=cid, code="CP-2", name="Sister Concern")
    principal = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="2100",
        account_name="Loan payable",
        account_type="liability",
        account_sub_type="loan_payable",
    )
    settlement = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="1100",
        account_name="Settlement bank",
        account_type="asset",
        account_sub_type="checking",
    )
    Loan.objects.create(
        company_id=cid,
        loan_no="LN-BORROW-1",
        direction=Loan.DIRECTION_BORROWED,
        status="active",
        counterparty=bank,
        principal_account=principal,
        settlement_account=settlement,
        outstanding_principal=Decimal("1250000.00"),
    )
    Loan.objects.create(
        company_id=cid,
        loan_no="LN-LENT-1",
        direction=Loan.DIRECTION_LENT,
        status="active",
        counterparty=sister,
        principal_account=principal,
        settlement_account=settlement,
        outstanding_principal=Decimal("300000.00"),
    )
    Loan.objects.create(
        company_id=cid,
        loan_no="LN-DRAFT-1",
        direction=Loan.DIRECTION_BORROWED,
        status="draft",
        counterparty=bank,
        principal_account=principal,
        settlement_account=settlement,
        outstanding_principal=Decimal("999999.00"),
    )

    out = report_party_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    loans = _section(out, "loans")

    assert loans["count"] == 2
    assert {r["loan_no"] for r in loans["rows"]} == {"LN-BORROW-1", "LN-LENT-1"}
    borrowed = next(r for r in loans["rows"] if r["loan_no"] == "LN-BORROW-1")
    lent = next(r for r in loans["rows"] if r["loan_no"] == "LN-LENT-1")
    assert borrowed["party_type"] == "loan_borrowed"
    assert borrowed["name"] == "Agrani Bank"
    assert borrowed["net_position"] == -1250000.0
    assert lent["party_type"] == "loan_lent"
    assert lent["net_position"] == 300000.0

    assert loans["total_payable"] == 1250000.0
    assert loans["total_receivable"] == 300000.0
    assert loans["net_position"] == -950000.0
    assert out["summary"]["loans_borrowed_outstanding"] == 1250000.0
    assert out["summary"]["loans_lent_outstanding"] == 300000.0


@pytest.mark.django_db
def test_zero_balance_parties_are_omitted(company_tenant):
    cid = company_tenant.id
    Customer.objects.create(
        company_id=cid,
        display_name="Dormant Customer",
        customer_number="C-PB-Z",
        current_balance=Decimal("0"),
    )
    Vendor.objects.create(
        company_id=cid,
        company_name="Dormant Vendor",
        vendor_number="V-PB-Z",
        current_balance=Decimal("0"),
    )

    out = report_party_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert _section(out, "customers")["count"] == 0
    assert _section(out, "vendors")["count"] == 0
    assert out["summary"]["party_count"] == 0


@pytest.mark.django_db
def test_bank_registers_listed_and_other_account_types_excluded(company_tenant):
    cid = company_tenant.id
    ChartOfAccount.objects.create(
        company_id=cid,
        account_code="1010",
        account_name="Islami Bank — CD 3341",
        account_type="bank_account",
        account_sub_type="checking",
        opening_balance=Decimal("412900.00"),
    )
    # Not a bank register — must not appear in the bank section.
    ChartOfAccount.objects.create(
        company_id=cid,
        account_code="1500",
        account_name="Delivery van",
        account_type="asset",
        account_sub_type="fixed_asset",
        opening_balance=Decimal("800000.00"),
    )

    out = report_party_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    banks = _section(out, "bank_accounts")

    assert banks["count"] == 1
    row = banks["rows"][0]
    assert row["party_type"] == "bank"
    assert row["code"] == "1010"
    assert row["name"] == "Islami Bank — CD 3341"
    assert row["balance"] == 412900.0
    assert row["net_position"] == 412900.0
    assert out["summary"]["bank_cash_on_hand"] == 412900.0
    assert out["summary"]["net_position"] == 412900.0


@pytest.mark.django_db
def test_consolidated_financial_statement_shape(company_tenant):
    from api.models import Station
    from api.services.reporting import report_entities_financial_statement

    cid = company_tenant.id
    st = Station.objects.create(company_id=cid, station_name="Savar Depot", is_active=True)

    out = report_entities_financial_statement(cid, date(2026, 1, 1), date(2026, 1, 31))

    assert out["report_id"] == "entities-financial-statement"
    assert out["balance_sheet_as_of"] == "2026-01-31"
    assert [g["key"] for g in out["groups"]] == [
        "fuel_stations",
        "shop_hubs",
        "ponds",
        "head_office",
    ]

    # The station shows up exactly once across the groups, with all three statement blocks.
    named = [r for r in out["rows"] if r["entity_name"] == "Savar Depot"]
    assert len(named) == 1
    row = named[0]
    for key in (
        "income",
        "cost_of_goods_sold",
        "expenses",
        "gross_profit",
        "net_income",
        "total_assets",
        "total_liabilities",
        "total_equity",
        "trial_balance_debit",
        "trial_balance_credit",
    ):
        assert key in row, key
    assert row["station_id"] == st.id
    assert row["trial_balance_balanced"] is True

    assert out["summary"]["entity_count"] == len(out["rows"])
    assert out["summary"]["unbalanced_entities"] == []
    assert set(out["company_total"]).issuperset({"income", "net_income", "total_assets"})
