"""Loan GL station tagging and entity P&L integration."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.exceptions import GlPostingError
from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Loan, Station
from api.services.entity_gl_scoping import validate_loan_interest_entity_tags_for_gl
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def _loan_ctx(company):
    from api.models import ChartOfAccount, LoanCounterparty

    st = Station.objects.create(company_id=company.id, station_name="Loan Site", is_active=True)
    bank = ChartOfAccount.objects.create(
        company_id=company.id,
        account_code="T1010",
        account_name="Test Bank",
        account_type="asset",
        is_active=True,
    )
    loan_pay = ChartOfAccount.objects.create(
        company_id=company.id,
        account_code="T2300",
        account_name="Test Loan Payable",
        account_type="liability",
        is_active=True,
    )
    int_exp = ChartOfAccount.objects.create(
        company_id=company.id,
        account_code="T6100",
        account_name="Test Interest Expense",
        account_type="expense",
        is_active=True,
    )
    accrued = ChartOfAccount.objects.create(
        company_id=company.id,
        account_code="T2350",
        account_name="Test Accrued Interest Payable",
        account_type="liability",
        is_active=True,
    )
    cp = LoanCounterparty.objects.create(
        company_id=company.id,
        code="CP-ENT-01",
        name="Entity Test Lender",
        role_type="bank",
    )
    return {
        "st": st,
        "bank": bank,
        "loan_pay": loan_pay,
        "int_exp": int_exp,
        "accrued": accrued,
        "cp": cp,
    }


def test_loan_interest_post_blocks_without_station(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    ctx = _loan_ctx(company_tenant_with_gl)
    loan = Loan.objects.create(
        company_id=cid,
        loan_no="LN-NO-SITE",
        direction=Loan.DIRECTION_BORROWED,
        counterparty=ctx["cp"],
        principal_account=ctx["loan_pay"],
        settlement_account=ctx["bank"],
        interest_account=ctx["int_exp"],
        interest_accrual_account=ctx["accrued"],
        annual_interest_rate=Decimal("12"),
        status="active",
        outstanding_principal=Decimal("1000"),
    )
    with pytest.raises(GlPostingError, match="GL segment"):
        validate_loan_interest_entity_tags_for_gl(loan, cid)


def test_loan_disburse_repay_tags_station_and_pl(
    api_client, auth_super_headers, company_tenant_with_gl
):
    cid = company_tenant_with_gl.id
    ctx = _loan_ctx(company_tenant_with_gl)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(cid)}

    r = api_client.post(
        "/api/loans/",
        data=json.dumps(
            {
                "direction": "borrowed",
                "counterparty_id": ctx["cp"].id,
                "principal_account_id": ctx["loan_pay"].id,
                "settlement_account_id": ctx["bank"].id,
                "interest_account_id": ctx["int_exp"].id,
                "interest_accrual_account_id": ctx["accrued"].id,
                "station_id": ctx["st"].id,
                "annual_interest_rate": "12",
                "sanction_amount": "5000",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    loan_id = r.json()["id"]

    r2 = api_client.post(
        f"/api/loans/{loan_id}/disburse/",
        data=json.dumps({"amount": "1000", "post_to_gl": True, "disbursement_date": "2026-06-01"}),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 201, r2.content.decode()
    je_id = r2.json().get("journal_entry_id")
    assert je_id
    lines = JournalEntryLine.objects.filter(journal_entry_id=je_id)
    assert lines.count() >= 2
    assert all(ln.station_id == ctx["st"].id for ln in lines)

    r3 = api_client.post(
        f"/api/loans/{loan_id}/repay/",
        data=json.dumps(
            {
                "amount": "50",
                "principal_amount": "40",
                "interest_amount": "10",
                "post_to_gl": True,
                "repayment_date": "2026-06-15",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r3.status_code == 201, r3.content.decode()
    pmt_je = r3.json().get("journal_entry_id")
    pmt_lines = JournalEntryLine.objects.filter(journal_entry_id=pmt_je)
    assert pmt_lines.filter(debit__gt=0, account=ctx["int_exp"]).exists()
    assert all(ln.station_id == ctx["st"].id for ln in pmt_lines)

    start, end = date(2026, 6, 1), date(2026, 6, 30)
    other_st = Station.objects.create(company_id=cid, station_name="Other Site", is_active=True)
    pl_st = report_income_statement(cid, start, end, station_id=ctx["st"].id)
    pl_other = report_income_statement(cid, start, end, station_id=other_st.id)
    exp_st = Decimal(str(pl_st["expenses"]["total"]))
    exp_other = Decimal(str(pl_other["expenses"]["total"]))
    assert exp_st >= Decimal("10.00")
    assert exp_other == Decimal("0")


def test_loan_station_change_resyncs_posted_gl(api_client, auth_super_headers, company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    ctx = _loan_ctx(company_tenant_with_gl)
    st2 = Station.objects.create(company_id=cid, station_name="Loan Site B", is_active=True)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(cid)}

    r = api_client.post(
        "/api/loans/",
        data=json.dumps(
            {
                "direction": "borrowed",
                "counterparty_id": ctx["cp"].id,
                "principal_account_id": ctx["loan_pay"].id,
                "settlement_account_id": ctx["bank"].id,
                "interest_account_id": ctx["int_exp"].id,
                "interest_accrual_account_id": ctx["accrued"].id,
                "station_id": ctx["st"].id,
                "annual_interest_rate": "12",
                "sanction_amount": "5000",
            }
        ),
        content_type="application/json",
        **h,
    )
    loan_id = r.json()["id"]
    api_client.post(
        f"/api/loans/{loan_id}/disburse/",
        data=json.dumps({"amount": "500", "post_to_gl": True, "disbursement_date": "2026-06-01"}),
        content_type="application/json",
        **h,
    )

    r_patch = api_client.put(
        f"/api/loans/{loan_id}/",
        data=json.dumps({"station_id": st2.id}),
        content_type="application/json",
        **h,
    )
    assert r_patch.status_code == 200, r_patch.content.decode()
    body = r_patch.json()
    assert body.get("gl_station_resynced_journals", 0) >= 1

    je_ids = list(
        JournalEntry.objects.filter(
            company_id=cid, entry_number__startswith="AUTO-LOAN-DISP-"
        ).values_list("id", flat=True)
    )
    assert je_ids
    assert all(
        ln.station_id == st2.id
        for ln in JournalEntryLine.objects.filter(journal_entry_id__in=je_ids)
    )


def test_counterparty_opening_tags_station(api_client, auth_super_headers, company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    ctx = _loan_ctx(company_tenant_with_gl)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(cid)}

    equity = ChartOfAccount.objects.create(
        company_id=cid,
        account_code="T3200",
        account_name="Opening Balance Equity",
        account_type="equity",
        account_sub_type="opening_balance_equity",
        is_active=True,
    )

    r = api_client.post(
        "/api/loans/counterparties/",
        data=json.dumps(
            {
                "name": "Opening Site CP",
                "role_type": "bank",
                "opening_balance_type": "payable",
                "opening_balance": "2500",
                "opening_balance_as_of": "2026-01-01",
                "opening_balance_station_id": ctx["st"].id,
                "opening_principal_account_id": ctx["loan_pay"].id,
                "opening_equity_account_id": equity.id,
                "post_opening_to_gl": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    cp = r.json()
    je_id = cp.get("opening_balance_journal_id")
    assert je_id
    lines = JournalEntryLine.objects.filter(journal_entry_id=je_id)
    assert lines.count() >= 2
    assert all(ln.station_id == ctx["st"].id for ln in lines)


def test_borrow_lent_report_strict_site_filter(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    ctx = _loan_ctx(company_tenant_with_gl)
    st2 = Station.objects.create(company_id=cid, station_name="Alt Site", is_active=True)

    Loan.objects.create(
        company_id=cid,
        loan_no="LN-SITE-A",
        direction=Loan.DIRECTION_BORROWED,
        counterparty=ctx["cp"],
        principal_account=ctx["loan_pay"],
        settlement_account=ctx["bank"],
        station_id=ctx["st"].id,
        annual_interest_rate=Decimal("0"),
        status="active",
        outstanding_principal=Decimal("100"),
    )
    Loan.objects.create(
        company_id=cid,
        loan_no="LN-COMPANY",
        direction=Loan.DIRECTION_BORROWED,
        counterparty=ctx["cp"],
        principal_account=ctx["loan_pay"],
        settlement_account=ctx["bank"],
        station_id=None,
        annual_interest_rate=Decimal("0"),
        status="active",
        outstanding_principal=Decimal("200"),
    )
    Loan.objects.create(
        company_id=cid,
        loan_no="LN-SITE-B",
        direction=Loan.DIRECTION_BORROWED,
        counterparty=ctx["cp"],
        principal_account=ctx["loan_pay"],
        settlement_account=ctx["bank"],
        station_id=st2.id,
        annual_interest_rate=Decimal("0"),
        status="active",
        outstanding_principal=Decimal("50"),
    )

    from api.services.reporting import report_loans_borrow_and_lent

    start, end = date(2026, 1, 1), date(2026, 12, 31)
    inclusive = report_loans_borrow_and_lent(cid, start, end, ctx["st"].id, strict_site=False)
    strict = report_loans_borrow_and_lent(cid, start, end, ctx["st"].id, strict_site=True)

    inc_nos = {row["loan_no"] for row in inclusive["borrowed"]}
    strict_nos = {row["loan_no"] for row in strict["borrowed"]}

    assert inc_nos == {"LN-SITE-A", "LN-COMPANY"}
    assert strict_nos == {"LN-SITE-A"}
    assert strict["filter_strict_site"] is True
