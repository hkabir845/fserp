"""Additional fixed asset API tests: opening balance, disposal, reversal."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import ChartOfAccount, FixedAsset, JournalEntry, Station


def _headers(auth_super_headers, company):
    return {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company.id)}


def _fa_ctx(company, station):
    equity = ChartOfAccount.objects.create(
        company=company,
        account_code="T3200",
        account_name="Opening Balance Equity",
        account_type="equity",
        account_sub_type="opening_balance_equity",
    )
    asset = ChartOfAccount.objects.create(
        company=company,
        account_code="T1510",
        account_name="Buildings",
        account_type="asset",
        account_sub_type="fixed_asset",
    )
    accum = ChartOfAccount.objects.create(
        company=company,
        account_code="T1550",
        account_name="Accum Depr",
        account_type="asset",
        account_sub_type="accumulated_depreciation",
    )
    expense = ChartOfAccount.objects.create(
        company=company,
        account_code="T6320",
        account_name="Depreciation Expense",
        account_type="expense",
        account_sub_type="other_business_expenses",
    )
    gain = ChartOfAccount.objects.create(
        company=company,
        account_code="T4410",
        account_name="Gain",
        account_type="income",
        account_sub_type="other_income",
    )
    loss = ChartOfAccount.objects.create(
        company=company,
        account_code="T6900",
        account_name="Loss on disposal",
        account_type="expense",
        account_sub_type="other_business_expenses",
    )
    bank = ChartOfAccount.objects.create(
        company=company,
        account_code="T1030",
        account_name="Bank",
        account_type="bank_account",
        account_sub_type="checking",
    )
    return {
        "equity": equity,
        "asset": asset,
        "accum": accum,
        "expense": expense,
        "gain": gain,
        "loss": loss,
        "bank": bank,
        "station": station,
    }


@pytest.mark.django_db
def test_fixed_asset_opening_accumulated_depreciation(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    station = Station.objects.create(
        company=company_master, station_number="OB-1", station_name="OB Site", is_active=True
    )
    ctx = _fa_ctx(company_master, station)

    r = api_client.post(
        "/api/fixed-assets/",
        data=json.dumps(
            {
                "name": "Used Generator",
                "station_id": station.id,
                "asset_account_id": ctx["asset"].id,
                "accumulated_depreciation_account_id": ctx["accum"].id,
                "depreciation_expense_account_id": ctx["expense"].id,
                "acquisition_cost": "100000",
                "opening_accumulated_depreciation": "40000",
                "useful_life_months": 60,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    asset_id = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/place-in-service/",
        data=json.dumps({"post_acquisition_gl": False}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    assert JournalEntry.objects.filter(company=company_master, entry_number=f"AUTO-FA-OB-DEP-{asset_id}").exists()
    fa = FixedAsset.objects.get(pk=asset_id)
    assert fa.accumulated_depreciation == Decimal("40000")


@pytest.mark.django_db
def test_fixed_asset_dispose_and_reverse_depreciation(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    station = Station.objects.create(
        company=company_master, station_number="D-1", station_name="Disp Site", is_active=True
    )
    ctx = _fa_ctx(company_master, station)

    r = api_client.post(
        "/api/fixed-assets/",
        data=json.dumps(
            {
                "name": "Old POS",
                "station_id": station.id,
                "asset_account_id": ctx["asset"].id,
                "accumulated_depreciation_account_id": ctx["accum"].id,
                "depreciation_expense_account_id": ctx["expense"].id,
                "settlement_account_id": ctx["bank"].id,
                "acquisition_cost": "10000",
                "useful_life_months": 10,
            }
        ),
        content_type="application/json",
        **h,
    )
    asset_id = json.loads(r.content)["id"]
    api_client.post(f"/api/fixed-assets/{asset_id}/place-in-service/", data="{}", content_type="application/json", **h)
    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/depreciate/",
        data=json.dumps({"run_date": "2025-07-31"}),
        content_type="application/json",
        **h,
    )
    run_id = json.loads(r.content)["run"]["id"]

    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/depreciation-runs/{run_id}/reverse/",
        data="{}",
        content_type="application/json",
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    fa = FixedAsset.objects.get(pk=asset_id)
    assert fa.status == FixedAsset.STATUS_ACTIVE
    assert fa.accumulated_depreciation == Decimal("0")

    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/dispose/",
        data=json.dumps(
            {
                "disposal_date": "2025-08-01",
                "proceeds_amount": "3000",
                "proceeds_account_id": ctx["bank"].id,
                "loss_account_id": ctx["loss"].id,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    fa.refresh_from_db()
    assert fa.status == FixedAsset.STATUS_DISPOSED
    assert fa.disposal_journal_entry_id


@pytest.mark.django_db
def test_fixed_asset_lifecycle(api_client, auth_super_headers, company_master):
    h = _headers(auth_super_headers, company_master)
    station = Station.objects.filter(company=company_master, is_active=True).first()
    if not station:
        station = Station.objects.create(
            company=company_master,
            station_number="T-ST-1",
            station_name="Test Station",
            is_active=True,
        )
    ctx = _fa_ctx(company_master, station)

    r = api_client.post(
        "/api/fixed-assets/",
        data=json.dumps(
            {
                "name": "POS Terminal",
                "station_id": station.id,
                "asset_account_id": ctx["asset"].id,
                "accumulated_depreciation_account_id": ctx["accum"].id,
                "depreciation_expense_account_id": ctx["expense"].id,
                "settlement_account_id": ctx["bank"].id,
                "acquisition_cost": "120000.00",
                "salvage_value": "0",
                "useful_life_months": 60,
                "in_service_date": "2025-06-01",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    asset = json.loads(r.content)
    asset_id = asset["id"]
    assert asset["status"] == "draft"

    r = api_client.post(f"/api/fixed-assets/{asset_id}/place-in-service/", data="{}", content_type="application/json", **h)
    assert r.status_code == 200, r.content.decode()
    assert json.loads(r.content)["acquisition_journal_entry_id"]
    assert JournalEntry.objects.filter(company=company_master, entry_number=f"AUTO-FA-ACQ-{asset_id}").exists()

    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/depreciate/",
        data=json.dumps({"run_date": "2025-06-30"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert Decimal(json.loads(r.content)["run"]["amount"]) == Decimal("2000.00")

    r = api_client.post(
        f"/api/fixed-assets/{asset_id}/depreciate/",
        data=json.dumps({"run_date": "2025-06-15"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
