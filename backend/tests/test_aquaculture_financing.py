"""
Aquaculture financing: loan flag, repayment worksheet allocation, apply with profit transfers.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFinancingAllocation,
    AquacultureFishSale,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    ChartOfAccount,
    Company,
    Loan,
    LoanCounterparty,
)


def _headers(auth_super_headers, company):
    return {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company.id)}


def _enable_aquaculture(company):
    Company.objects.filter(pk=company.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _loan_setup(company):
    bank = ChartOfAccount.objects.create(
        company=company,
        account_code="AF1010",
        account_name="AF Bank",
        account_type="asset",
        account_sub_type="checking",
    )
    loan_pay = ChartOfAccount.objects.create(
        company=company,
        account_code="AF2300",
        account_name="AF Loan Payable",
        account_type="liability",
        account_sub_type="loan_payable",
    )
    clearing = ChartOfAccount.objects.create(
        company=company,
        account_code="AF1200",
        account_name="AF Clearing",
        account_type="asset",
        account_sub_type="other_current_assets",
    )
    cp = LoanCounterparty.objects.create(
        company=company,
        code="AF-CP",
        name="Aquaculture Lender",
        role_type="bank",
    )
    return {"bank": bank, "loan_pay": loan_pay, "clearing": clearing, "cp": cp}


@pytest.mark.django_db
def test_repayment_worksheet_profit_share(api_client, auth_super_headers, company_tenant):
    _enable_aquaculture(company_tenant)
    h = _headers(auth_super_headers, company_tenant)
    ctx = _loan_setup(company_tenant)

    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P-A", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P-B", is_active=True)

    end = date.today()
    start = end - timedelta(days=30)
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=p1,
        sale_date=end,
        weight_kg=Decimal("100"),
        total_amount=Decimal("1000"),
        income_type="harvest",
    )
    AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=p1,
        expense_date=end,
        amount=Decimal("200"),
        expense_category="feed",
    )
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=p2,
        sale_date=end,
        weight_kg=Decimal("50"),
        total_amount=Decimal("500"),
        income_type="harvest",
    )
    AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=p2,
        expense_date=end,
        amount=Decimal("100"),
        expense_category="feed",
    )

    r = api_client.post(
        "/api/loans/",
        data=json.dumps(
            {
                "direction": "borrowed",
                "counterparty_id": ctx["cp"].id,
                "principal_account_id": ctx["loan_pay"].id,
                "settlement_account_id": ctx["bank"].id,
                "sanction_amount": "50000",
                "annual_interest_rate": "0",
                "aquaculture_financing": True,
                "status": "active",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content
    loan_id = r.json()["id"]
    assert r.json().get("aquaculture_financing") is True

    Loan.objects.filter(pk=loan_id).update(outstanding_principal=Decimal("1000"))

    ws = api_client.get(
        "/api/aquaculture/financing/repayment-worksheet/",
        {
            "loan_id": loan_id,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "method": "profit_share",
            "total_amount": "300",
        },
        **h,
    )
    assert ws.status_code == 200, ws.content
    body = ws.json()
    assert body["method"] == "profit_share"
    assert body["sum_suggested"] == "300.00"
    ponds = {p["pond_id"]: Decimal(p["suggested_amount"]) for p in body["ponds"]}
    assert ponds[p1.id] + ponds[p2.id] == Decimal("300")
    assert ponds[p1.id] > ponds[p2.id]

    apply_r = api_client.post(
        "/api/aquaculture/financing/repayment-apply/",
        data=json.dumps(
            {
                "loan_id": loan_id,
                "transfer_date": end.isoformat(),
                "debit_account_id": ctx["bank"].id,
                "credit_account_id": ctx["clearing"].id,
                "ponds": [
                    {"pond_id": p1.id, "amount": str(ponds[p1.id]), "include": True},
                    {"pond_id": p2.id, "amount": str(ponds[p2.id]), "include": True},
                ],
                "loan_repay": {
                    "amount": "300",
                    "principal_amount": "300",
                    "interest_amount": "0",
                    "repayment_date": end.isoformat(),
                    "post_to_gl": False,
                },
            }
        ),
        content_type="application/json",
        **h,
    )
    assert apply_r.status_code == 201, apply_r.content
    assert len(apply_r.json()["profit_transfers"]) == 2
    assert AquaculturePondProfitTransfer.objects.filter(company_id=company_tenant.id).count() == 2
    assert AquacultureFinancingAllocation.objects.filter(
        company_id=company_tenant.id, allocation_kind="repayment"
    ).count() == 2
    lo = Loan.objects.get(pk=loan_id)
    assert lo.outstanding_principal == Decimal("700")


@pytest.mark.django_db
def test_financing_overview_and_allocations(api_client, auth_super_headers, company_tenant):
    _enable_aquaculture(company_tenant)
    h = _headers(auth_super_headers, company_tenant)
    ctx = _loan_setup(company_tenant)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)

    r = api_client.post(
        "/api/loans/",
        data=json.dumps(
            {
                "direction": "borrowed",
                "counterparty_id": ctx["cp"].id,
                "principal_account_id": ctx["loan_pay"].id,
                "settlement_account_id": ctx["bank"].id,
                "sanction_amount": "10000",
                "annual_interest_rate": "0",
                "aquaculture_financing": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    loan_id = r.json()["id"]

    ov = api_client.get("/api/aquaculture/financing/", **h)
    assert ov.status_code == 200
    assert ov.json()["totals"]["loan_count"] >= 1

    alloc = api_client.post(
        "/api/aquaculture/financing/allocations/",
        data=json.dumps(
            {
                "loan_id": loan_id,
                "allocation_date": date.today().isoformat(),
                "allocation_kind": "use",
                "rows": [{"pond_id": pond.id, "amount": "1500", "memo": "Feed advance"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert alloc.status_code == 201, alloc.content
    assert len(alloc.json()) == 1
