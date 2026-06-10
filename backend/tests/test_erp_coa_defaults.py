"""ERP built-in COA purpose registry."""
from __future__ import annotations

import pytest

from api.models import ChartOfAccount
from api.services.erp_coa_defaults import (
    ErpCoaCode,
    chart_account_id_for_purpose,
    coa_code_for_purpose,
    erp_coa_defaults_payload,
)


@pytest.mark.django_db
def test_coa_code_for_purpose_keys():
    assert coa_code_for_purpose("bank.operating") == ErpCoaCode.BANK_OP
    assert coa_code_for_purpose("loan.principal_borrowed") == ErpCoaCode.LOAN_PAYABLE
    assert coa_code_for_purpose("loan.interest_expense") == ErpCoaCode.INTEREST_EXPENSE_LOAN
    assert coa_code_for_purpose("equity.owner_capital") == ErpCoaCode.OWNER_EQUITY
    assert coa_code_for_purpose("fixed_asset.disposal_loss") == ErpCoaCode.ASSET_DISPOSAL_LOSS


@pytest.mark.django_db
def test_erp_defaults_api_payload(api_client, company_tenant, auth_admin_headers):
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code=ErpCoaCode.BANK_OP,
        account_name="Bank Operating",
        account_type="asset",
        is_active=True,
    )
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code=ErpCoaCode.LOAN_PAYABLE,
        account_name="Loans Payable",
        account_type="loan",
        account_sub_type="loan_payable",
        is_active=True,
    )
    r = api_client.get("/api/chart-of-accounts/erp-defaults/", **auth_admin_headers)
    assert r.status_code == 200
    data = r.json()
    assert "purposes" in data
    assert "by_module" in data
    assert "by_account_type" in data
    assert "aquaculture_expense_category_coa" in data
    assert data["fuel_station_expense_rollup_coa"]["utilities"] == "6100"
    bank_op = next(p for p in data["purposes"] if p["key"] == "bank.operating")
    assert bank_op["account_code"] == "1030"
    assert bank_op["resolved"] is True
    assert bank_op["account_id"] is not None
    assert bank_op["account_type"] == "asset"
    assert "asset" in data["by_account_type"]
    assert any(p["key"] == "bank.operating" for p in data["by_account_type"]["asset"])
    assert "6716" in data["aquaculture_expense_category_coa"].values()
    borrowed = next(p for p in data["purposes"] if p["key"] == "loan.principal_borrowed")
    assert borrowed["resolved"] is True


@pytest.mark.django_db
def test_chart_account_id_for_purpose(company_tenant):
    acc = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code=ErpCoaCode.OWNER_EQUITY,
        account_name="Owner Equity",
        account_type="equity",
        is_active=True,
    )
    assert chart_account_id_for_purpose(company_tenant.id, "equity.owner_capital") == acc.id
