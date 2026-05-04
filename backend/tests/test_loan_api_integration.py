"""
HTTP integration tests for Loans: counterparty, create loan, disburse, repay, GL keys, schedule preview.
Uses the same auth + X-Selected-Company-Id pattern as test_api_production_audit.
"""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import JournalEntry, Loan, LoanCounterparty


def _headers(auth_super_headers, company):
    return {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company.id)}


def _coa_and_counterparty(company):
    """Minimal COA for a borrowed loan + one counterparty (ORM for speed)."""
    from api.models import ChartOfAccount

    bank = ChartOfAccount.objects.create(
        company=company,
        account_code="T1010",
        account_name="Test Bank",
        account_type="asset",
        account_sub_type="checking",
    )
    loan_pay = ChartOfAccount.objects.create(
        company=company,
        account_code="T2300",
        account_name="Test Loan Payable",
        account_type="liability",
        account_sub_type="loan_payable",
    )
    int_exp = ChartOfAccount.objects.create(
        company=company,
        account_code="T6100",
        account_name="Test Interest Expense",
        account_type="expense",
        account_sub_type="other_expense",
    )
    accrued = ChartOfAccount.objects.create(
        company=company,
        account_code="T2350",
        account_name="Test Accrued Interest Payable",
        account_type="liability",
        account_sub_type="other_current_liabilities",
    )
    cp = LoanCounterparty.objects.create(
        company=company,
        code="CP-INT-01",
        name="Integration Test Lender",
        role_type="bank",
    )
    return {
        "bank": bank,
        "loan_pay": loan_pay,
        "int_exp": int_exp,
        "accrued": accrued,
        "cp": cp,
    }


@pytest.mark.django_db
def test_borrowed_loan_disburse_repay_and_gl(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    ctx = _coa_and_counterparty(company_master)

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
                "annual_interest_rate": "12",
                "sanction_amount": "10000",
                "term_months": 12,
                "product_type": "general",
                "status": "draft",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    loan = json.loads(r.content)
    loan_id = loan["id"]
    assert Decimal(str(loan["outstanding_principal"])) == Decimal("0")
    assert loan["status"] in ("draft", "active")

    r = api_client.post(
        f"/api/loans/{loan_id}/disburse/",
        data=json.dumps(
            {
                "amount": "5000.00",
                "disbursement_date": "2025-01-10",
                "reference": "TEST-DISP",
                "post_to_gl": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content)
    d_id = body.get("disbursement_id")
    assert d_id
    assert body.get("journal_entry_id")
    lo2 = body["loan"]
    assert Decimal(str(lo2["outstanding_principal"])) == Decimal("5000.00")
    assert Decimal(str(lo2["total_disbursed"])) == Decimal("5000.00")
    assert lo2["status"] == "active"

    je_d = JournalEntry.objects.filter(
        company_id=company_master.id, entry_number=f"AUTO-LOAN-DISP-{d_id}"
    ).first()
    assert je_d is not None
    assert je_d.lines.count() == 2

    r = api_client.post(
        f"/api/loans/{loan_id}/repay/",
        data=json.dumps(
            {
                "amount": "1100.00",
                "principal_amount": "800.00",
                "interest_amount": "300.00",
                "repayment_date": "2025-02-15",
                "post_to_gl": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    rep = json.loads(r.content)
    rid = rep.get("repayment_id")
    assert rid
    assert rep.get("journal_entry_id")
    final = rep["loan"]
    assert Decimal(str(final["outstanding_principal"])) == Decimal("4200.00")
    assert Decimal(str(final["total_repaid_principal"])) == Decimal("800.00")
    assert final["status"] == "active"

    je_p = JournalEntry.objects.filter(
        company_id=company_master.id, entry_number=f"AUTO-LOAN-PMT-{rid}"
    ).first()
    assert je_p is not None
    lines = list(je_p.lines.all().order_by("id"))
    assert len(lines) >= 2
    t_deb = sum((x.debit for x in lines), Decimal("0"))
    t_cred = sum((x.credit for x in lines), Decimal("0"))
    assert t_deb == t_cred
    assert t_deb == Decimal("1100.00")


@pytest.mark.django_db
def test_islamic_facility_and_deal_lifecycle(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    ctx = _coa_and_counterparty(company_master)

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
                "annual_interest_rate": "0",
                "sanction_amount": "20000",
                "product_type": "islamic_facility",
                "banking_model": "islamic",
                "status": "active",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    fac = json.loads(r.content)
    fac_id = fac["id"]
    assert fac["product_type"] == "islamic_facility"

    r = api_client.post(
        f"/api/loans/{fac_id}/disburse/",
        data=json.dumps({"amount": "1000", "disbursement_date": "2025-01-01"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    err = json.loads(r.content)
    assert "deal" in (err.get("detail") or "").lower() or "facility" in (err.get("detail") or "").lower()

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
                "annual_interest_rate": "0",
                "sanction_amount": "5000",
                "product_type": "islamic_deal",
                "parent_loan_id": fac_id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    deal = json.loads(r.content)
    deal_id = deal["id"]
    assert deal["parent_loan_id"] == fac_id

    r = api_client.post(
        f"/api/loans/{deal_id}/disburse/",
        data=json.dumps(
            {
                "amount": "2000.00",
                "disbursement_date": "2025-01-20",
                "post_to_gl": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    out = json.loads(r.content)
    assert Decimal(str(out["loan"]["outstanding_principal"])) == Decimal("2000.00")

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
                "annual_interest_rate": "0",
                "sanction_amount": "25000",
                "product_type": "islamic_deal",
                "parent_loan_id": fac_id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    djson = json.loads(r.content)
    assert "exceed" in djson.get("detail", "").lower() or "limit" in djson.get("detail", "").lower()


@pytest.mark.django_db
def test_loan_schedule_preview_rejects_negative_principal(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    r = api_client.get(
        "/api/loans/schedule-preview/?principal=-100&rate=5&months=12", **h
    )
    assert r.status_code == 400
    d = json.loads(r.content)
    assert "positive" in d.get("detail", "").lower() or "principal" in d.get("detail", "").lower()


@pytest.mark.django_db
def test_loan_cannot_delete_after_disbursement(
    api_client, auth_super_headers, company_master
):
    h = _headers(auth_super_headers, company_master)
    ctx = _coa_and_counterparty(company_master)

    r = api_client.post(
        "/api/loans/",
        data=json.dumps(
            {
                "direction": "borrowed",
                "counterparty_id": ctx["cp"].id,
                "principal_account_id": ctx["loan_pay"].id,
                "settlement_account_id": ctx["bank"].id,
                "annual_interest_rate": "0",
                "sanction_amount": "1000",
                "product_type": "general",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    loan = json.loads(r.content)
    lid = loan["id"]
    r = api_client.post(
        f"/api/loans/{lid}/disburse/",
        data=json.dumps({"amount": "100", "post_to_gl": True}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    r = api_client.delete(f"/api/loans/{lid}/", **h)
    assert r.status_code == 400
    assert Loan.objects.filter(id=lid, company_id=company_master.id).exists()
