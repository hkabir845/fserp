"""Wave C remaining control gaps + Wave D VAT working paper.

See `docs/ACCOUNTING_AUDIT_BACKLOG.md` (A1-2, A1-7, A1-10–A1-13, A1-15–A1-18, A2-1).
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


def _station(company_id, label="Main Site"):
    from api.models import Station

    return Station.objects.create(company_id=company_id, station_name=label, is_active=True)


# ----------------------------------------------- A1-2: Walk-in receipts cannot credit A/R


def test_a_receipt_against_walk_in_is_refused(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Customer, Payment

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "1100", "AR", "asset", "accounts_receivable")
    walk = Customer.objects.create(
        company_id=cid, customer_number="WALK-PAY", display_name="Walk-in", is_active=True
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        "/api/payments/received/",
        data={
            "customer_id": walk.id,
            "amount": "500",
            "payment_date": "2026-05-01",
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "walk-in" in r.content.decode().lower()
    assert not Payment.objects.filter(company_id=cid).exists()


# -------------------------------- A1-7: a posted journal records who posted it


def test_posting_a_journal_records_who_posted_it(
    api_client, auth_super_headers, company_tenant
):
    cid = company_tenant.id
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    cap = _acc(cid, "3000", "Capital", "equity", "owners_equity")
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    created = api_client.post(
        "/api/journal-entries/",
        data={
            "entry_date": "2026-05-01",
            "description": "Owner contribution",
            "lines": [
                {"debit_account_id": cash.id, "amount": "100"},
                {"credit_account_id": cap.id, "amount": "100"},
            ],
        },
        content_type="application/json",
        **headers,
    )
    assert created.status_code == 201, created.content.decode()
    je_id = created.json()["id"]
    assert created.json()["created_by_id"] is not None

    posted = api_client.post(
        f"/api/journal-entries/{je_id}/post/",
        data={},
        content_type="application/json",
        **headers,
    )
    assert posted.status_code == 200, posted.content.decode()
    body = posted.json()
    assert body["posted_by_id"] is not None
    assert body["is_posted"] is True


# -------------- A1-10: reversing depreciation unblocks the month and does not revive disposed


def test_reversing_depreciation_clears_the_month_and_last_run_date(
    api_client, auth_super_headers, company_tenant
):
    from api.models import FixedAsset, FixedAssetDepreciationRun

    cid = company_tenant.id
    asset_acc = _acc(cid, "1500", "Equipment", "asset", "machinery_and_equipment")
    accum_acc = _acc(cid, "1550", "Accum dep", "asset", "accumulated_depreciation")
    dep_acc = _acc(cid, "6320", "Depreciation", "expense", "other_business_expenses")
    asset = FixedAsset.objects.create(
        company_id=cid,
        station=_station(cid, "FA Site"),
        asset_number="FA-C2-1",
        name="Pump",
        asset_account=asset_acc,
        accumulated_depreciation_account=accum_acc,
        depreciation_expense_account=dep_acc,
        acquisition_date=date(2026, 1, 1),
        in_service_date=date(2026, 1, 1),
        acquisition_cost=Decimal("12000"),
        salvage_value=Decimal("0"),
        useful_life_months=12,
        depreciation_method="straight_line",
        status=FixedAsset.STATUS_ACTIVE,
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/depreciate/",
        data={"run_date": "2026-01-31"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    run_id = r.json()["run"]["id"]
    asset.refresh_from_db()
    assert asset.last_depreciation_date == date(2026, 1, 31)

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/depreciation-runs/{run_id}/reverse/",
        data={},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 200, r.content.decode()
    asset.refresh_from_db()
    assert asset.last_depreciation_date is None
    assert asset.status == FixedAsset.STATUS_ACTIVE
    assert FixedAssetDepreciationRun.objects.get(pk=run_id).reversed_at is not None

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/depreciate/",
        data={"run_date": "2026-01-31"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    later_run_id = r.json()["run"]["id"]

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/dispose/",
        data={
            "disposal_date": "2026-02-01",
            "proceeds_amount": "0",
            "loss_account_id": dep_acc.id,
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 200, r.content.decode()
    asset.refresh_from_db()
    assert asset.status == FixedAsset.STATUS_DISPOSED
    assert asset.acquisition_cost == Decimal("0")
    assert asset.accumulated_depreciation == Decimal("0")

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/depreciation-runs/{later_run_id}/reverse/",
        data={},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "disposed" in r.content.decode().lower()


# ------------------------- A1-12 / A1-13: loan close and duplicate accrual


def test_paying_principal_to_zero_does_not_close_while_interest_is_unsettled(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Loan, LoanCounterparty

    cid = company_tenant.id
    bank = _acc(cid, "1030", "Bank", "asset", "bank")
    principal = _acc(cid, "2410", "Loan payable", "liability", "long_term_liability")
    interest = _acc(cid, "6620", "Interest expense", "expense", "other_business_expenses")
    accrued = _acc(cid, "2300", "Accrued interest", "liability", "other_current_liability")
    cp = LoanCounterparty.objects.create(
        company_id=cid, name="Lender", role_type="lender", is_active=True
    )
    loan = Loan.objects.create(
        company_id=cid,
        counterparty=cp,
        station=_station(cid, "Loan site"),
        loan_no="LN-CLOSE-1",
        direction=Loan.DIRECTION_BORROWED,
        sanction_amount=Decimal("1000"),
        outstanding_principal=Decimal("1000"),
        settlement_account=bank,
        principal_account=principal,
        interest_account=interest,
        interest_accrual_account=accrued,
        status="active",
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        f"/api/loans/{loan.id}/accrue-interest/",
        data={"amount": "50", "accrual_date": "2026-05-31"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()

    dup = api_client.post(
        f"/api/loans/{loan.id}/accrue-interest/",
        data={"amount": "50", "accrual_date": "2026-05-15"},
        content_type="application/json",
        **headers,
    )
    assert dup.status_code == 400, dup.content.decode()
    assert "already accrued" in dup.content.decode().lower()

    r = api_client.post(
        f"/api/loans/{loan.id}/repay/",
        data={
            "amount": "1000",
            "principal_amount": "1000",
            "interest_amount": "0",
            "repayment_date": "2026-06-01",
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    loan.refresh_from_db()
    assert loan.status == "active", "unpaid accrued interest must keep the loan open"
    assert loan.outstanding_principal == Decimal("0.00")

    r = api_client.post(
        f"/api/loans/{loan.id}/repay/",
        data={
            "amount": "50",
            "principal_amount": "0",
            "interest_amount": "50",
            "repayment_date": "2026-06-05",
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    loan.refresh_from_db()
    assert loan.status == "closed"


# --------- A1-15: a site trial balance is presented as a balanced entity


def test_site_trial_balance_gets_a_due_to_from_head_office_line(company_tenant):
    from api.models import JournalEntry, JournalEntryLine, Station
    from api.services.reporting import report_trial_balance

    cid = company_tenant.id
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    rev = _acc(cid, "4100", "Fuel sales", "income", "sales_of_product_income")
    site = Station.objects.create(
        company_id=cid, station_name="Forecourt", is_active=True
    )
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="TEST-SITE-TB",
        entry_date=date(2026, 5, 1),
        description="mixed",
        is_posted=True,
        station_id=None,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=rev,
        debit=Decimal("0"),
        credit=Decimal("80"),
        station_id=site.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        debit=Decimal("80"),
        credit=Decimal("0"),
        station_id=None,
    )

    tb = report_trial_balance(cid, date(2026, 5, 1), date(2026, 5, 31), station_id=site.id)
    codes = [a["account_code"] for a in tb["accounts"]]
    assert "HO-DUE" in codes, tb
    assert tb["debits_equal_credits"] is True
    assert tb.get("scope_balanced_via") == "due_to_from_head_office"


# --------------- A1-17 / A1-16: quantity is not a free-typed field


def test_item_put_cannot_invent_stock_without_an_adjustment(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Item

    cid = company_tenant.id
    it = Item.objects.create(
        company_id=cid,
        name="Shop SKU",
        item_type="inventory",
        category="General",
        cost=Decimal("4"),
        quantity_on_hand=Decimal("0"),
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)
    r = api_client.put(
        f"/api/items/{it.id}/",
        data={"quantity_on_hand": "5", "cost": "4.00"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "inventory adjustment" in r.content.decode().lower()
    it.refresh_from_db()
    assert it.quantity_on_hand == Decimal("0")


def test_negative_station_stock_is_rejected(company_tenant):
    from api.models import Item
    from api.services.station_stock import set_station_stock

    cid = company_tenant.id
    it = Item.objects.create(
        company_id=cid, name="Clamp", item_type="inventory", category="General"
    )
    site = _station(cid, "Bin site")
    with pytest.raises(ValueError, match="negative"):
        set_station_stock(cid, site.id, it.id, Decimal("-3"))


# --------------- A1-18: a future-dated chart opening is invisible as-of yesterday


def test_chart_opening_dated_after_as_of_is_excluded_from_the_balance_sheet(company_tenant):
    from api.services.reporting import _ending_balance

    cid = company_tenant.id
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    cash.opening_balance = Decimal("5000")
    cash.opening_balance_date = date(2026, 6, 1)
    cash.save(update_fields=["opening_balance", "opening_balance_date"])

    assert _ending_balance(cash, cid, date(2026, 5, 31)) == Decimal("0")
    assert _ending_balance(cash, cid, date(2026, 6, 1)) == Decimal("5000")


# ------------------------------------------- A2-1: bill tax is input VAT, not expense


def test_bill_tax_debits_vat_input_not_office_expense(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Bill, JournalEntryLine, Vendor
    from api.services.gl_posting import CODE_VAT_INPUT
    from api.services.reporting import report_vat_return

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "2000", "AP", "liability", "accounts_payable")
    _acc(cid, "6900", "Office", "expense", "office_general_administrative_expenses")
    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-VAT", display_name="Mill", is_active=True
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)
    r = api_client.post(
        "/api/bills/",
        data={
            "vendor_id": vendor.id,
            "bill_date": "2026-05-10",
            "status": "open",
            "tax_amount": "15.00",
            "lines": [
                {
                    "description": "Office supplies",
                    "quantity": "1",
                    "unit_cost": "100.00",
                    "amount": "100.00",
                }
            ],
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    bill = Bill.objects.get(pk=r.json()["id"])
    vat = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid, account__account_code=CODE_VAT_INPUT
    )
    assert vat.exists()
    assert sum((ln.debit for ln in vat), Decimal("0")) == Decimal("15.00")
    office = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid, account__account_code="6900"
    )
    assert all(ln.debit != Decimal("15.00") for ln in office)

    paper = report_vat_return(cid, date(2026, 5, 1), date(2026, 5, 31))
    assert paper["report_id"] == "vat-return"
    assert Decimal(str(paper["input_vat"]["net_recoverable"])) == Decimal("15")
    assert Decimal(str(paper["net_payable_to_authority"])) == Decimal("-15")
