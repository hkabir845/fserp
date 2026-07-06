"""Vendor bill lines: aquaculture expense category → COA account and cost bucket."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, ChartOfAccount, Company, Vendor
from api.services.aquaculture_bill_defaults import (
    apply_aquaculture_expense_category_to_bill_line_row,
    chart_account_id_for_aquaculture_expense_category,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_constants import coa_account_code_for_aquaculture_expense_category


@pytest.mark.django_db
def test_coa_code_for_electricity(company_tenant):
    assert coa_account_code_for_aquaculture_expense_category("electricity", company_id=company_tenant.id) == "6717"
    assert coa_account_code_for_aquaculture_expense_category("repair_maintenance", company_id=company_tenant.id) == "6722"


@pytest.mark.django_db
def test_apply_category_sets_bucket_and_expense_account(company_tenant):
    ensure_aquaculture_chart_accounts(company_tenant.id)
    row = {
        "aquaculture_pond_id": 1,
        "aquaculture_expense_category": "electricity",
        "quantity": 1,
        "amount": "100",
    }
    err = apply_aquaculture_expense_category_to_bill_line_row(company_tenant.id, row)
    assert err is None
    assert row["aquaculture_cost_bucket"] == "electricity"
    assert row.get("expense_account_id") == chart_account_id_for_aquaculture_expense_category(
        company_tenant.id, "electricity"
    )


@pytest.mark.django_db
def test_post_bill_with_pond_category_sets_expense_gl(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow-1", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Pond Supplier",
            display_name="Pond Supplier",
            vendor_number="V-POND-1",
            is_active=True,
        )
    coa6717 = ChartOfAccount.objects.filter(
        company_id=company_tenant.id, account_code="6717", is_active=True
    ).first()
    assert coa6717 is not None

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-10",
                "status": "open",
                "lines": [
                    {
                        "description": "Pump electricity",
                        "quantity": 1,
                        "unit_cost": "2500.00",
                        "amount": "2500.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "electricity",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content.decode())
    line = body["lines"][0]
    assert line["aquaculture_pond_id"] == pond.id
    assert line["aquaculture_cost_bucket"] == "electricity"
    assert line["expense_account_id"] == coa6717.id


@pytest.mark.django_db
def test_post_pond_expense_manual_blocked(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": "electricity",
                "expense_date": "2026-05-01",
                "amount": "2500.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "vendor bill" in r.content.decode().lower()


@pytest.mark.django_db
def test_expense_categories_include_bill_defaults(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    r = api_client.get("/api/aquaculture/expense-categories/", **auth_admin_headers)
    assert r.status_code == 200
    rows = json.loads(r.content.decode())
    elec = next((x for x in rows if x.get("id") == "electricity"), None)
    assert elec is not None
    assert elec.get("bill_create_allowed") is True
    assert elec.get("default_coa_account_code") == "6717"
    assert elec.get("default_coa_account_id") is not None
    lease = next((x for x in rows if x.get("id") == "lease"), None)
    assert lease is not None and lease.get("bill_create_allowed") is False


@pytest.mark.django_db
def test_expense_register_includes_vendor_bill_lines(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P4", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Day Labor Co",
        display_name="Day Labor Co",
        vendor_number="V-DAY-1",
        is_active=True,
    )
    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-01",
                "status": "open",
                "lines": [
                    {
                        "description": "Netting crew",
                        "quantity": 1,
                        "unit_cost": "800.00",
                        "amount": "800.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "day_labor",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert bill.status_code == 201, bill.content.decode()

    all_rows = api_client.get(
        "/api/aquaculture/expenses/",
        {"pond_id": str(pond.id)},
        **auth_admin_headers,
    )
    assert all_rows.status_code == 200
    payload = json.loads(all_rows.content.decode())
    assert payload["count"] >= 1
    assert Decimal(payload["total_amount"]) >= Decimal("800.00")
    hit = next((x for x in payload["rows"] if x.get("source") == "bill"), None)
    assert hit is not None
    assert hit["vendor_name"] == "Day Labor Co"
    assert hit["pond_id"] == pond.id
    assert hit.get("bill_id")

    filtered = api_client.get(
        "/api/aquaculture/expenses/",
        {"pond_id": str(pond.id), "date_from": "2026-06-01", "date_to": "2026-06-01"},
        **auth_admin_headers,
    )
    assert filtered.status_code == 200
    fpayload = json.loads(filtered.content.decode())
    assert fpayload["count"] >= 1
    assert all(
        r.get("expense_date", "").startswith("2026-06-01") for r in fpayload["rows"] if r.get("source") == "bill"
    )


@pytest.mark.django_db
def test_aquaculture_expenses_report_includes_vendor_bill_lines(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Report Pond", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Transport Co",
        display_name="Transport Co",
        vendor_number="V-TR-1",
        is_active=True,
    )
    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-18",
                "status": "paid",
                "lines": [
                    {
                        "description": "Pond transport",
                        "quantity": 1,
                        "unit_cost": "24750.00",
                        "amount": "24750.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "transportation",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert bill.status_code == 201, bill.content.decode()

    r = api_client.get(
        "/api/reports/aquaculture-expenses/",
        {
            "start_date": "2026-02-18",
            "end_date": "2026-02-18",
            "pond_id": str(pond.id),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    payload = json.loads(r.content.decode())
    flat = [ln for g in payload.get("groups", []) for ln in g.get("lines", [])]
    hit = next((x for x in flat if x.get("source") == "bill"), None)
    assert hit is not None
    assert Decimal(hit["amount"]) == Decimal("24750.00")
    assert hit.get("vendor_name") == "Transport Co"


@pytest.mark.django_db
def test_pl_vendor_bill_lines_used_when_journal_missing_pond_tags(company_tenant_with_gl):
    from datetime import date

    from api.models import Bill, BillLine, JournalEntry, JournalEntryLine, Vendor
    from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
    from api.services.gl_posting import post_bill_journal

    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    cid = company_tenant_with_gl.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Untagged JE Pond", is_active=True)
    vendor = Vendor.objects.create(
        company_id=cid,
        company_name="General Vendor",
        vendor_number="V-GEN-PL",
        is_active=True,
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-PL-TEST",
        bill_date=date(2026, 2, 18),
        status="paid",
        total=Decimal("5600.00"),
    )
    BillLine.objects.create(
        bill=bill,
        description="Misc pond cost",
        quantity=Decimal("1"),
        unit_price=Decimal("5600.00"),
        amount=Decimal("5600.00"),
        aquaculture_pond_id=pond.id,
        aquaculture_cost_bucket="miscellaneous",
    )
    assert post_bill_journal(cid, bill) is True
    JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill.id}",
        debit__gt=0,
    ).update(aquaculture_pond_id=None, aquaculture_cost_bucket="")

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 2, 18),
        date(2026, 2, 18),
        pond_filter_id=pond.id,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    exp_cats = {c["category"]: c["amount"] for c in payload["expenses_by_category"]}
    assert Decimal(exp_cats.get("vendor_bill_pond", "0")) >= Decimal("5600.00")
