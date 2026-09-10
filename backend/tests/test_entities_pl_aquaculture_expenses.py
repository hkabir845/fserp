"""All Entities P&L / expense & income detail include aquaculture register categories."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquacultureFishSale, AquaculturePond
from api.services.reporting import (
    report_entities_pl_summary,
    report_expense_detail,
    report_income_detail,
)


@pytest.mark.django_db
def test_entities_pl_aquaculture_management_lists_all_expense_and_income_categories(
    company_tenant,
):
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid,
        name="P-Expense Gap",
        is_active=True,
        sort_order=1,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 3, 10),
        expense_category="electricity",
        amount=Decimal("1500.00"),
        memo="power",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 3, 11),
        expense_category="transportation",
        amount=Decimal("800.00"),
        memo="haul",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 3, 15),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        weight_kg=Decimal("100"),
        total_amount=Decimal("12000.00"),
    )

    start, end = date(2026, 3, 1), date(2026, 3, 31)
    pl = report_entities_pl_summary(cid, start, end)
    mgmt = pl.get("aquaculture_management") or {}
    exp_cats = {r["category"]: Decimal(str(r["amount"])) for r in (mgmt.get("expenses_by_category") or [])}
    inc_cats = {r["category"]: Decimal(str(r["amount"])) for r in (mgmt.get("income_by_category") or [])}

    assert exp_cats.get("electricity", 0) == Decimal("1500.00")
    assert exp_cats.get("transportation", 0) == Decimal("800.00")
    assert inc_cats.get("fish_harvest_sale", 0) == Decimal("12000.00")
    assert "electricity" in {c["category"] for c in (mgmt.get("expenses_by_category") or [])}
    assert len(mgmt.get("expenses_by_category") or []) >= 2
    assert len(mgmt.get("income_by_category") or []) >= 1

    exp_detail = report_expense_detail(cid, start, end)
    assert exp_detail.get("aquaculture_management")
    assert any(
        Decimal(str(r["amount"])) == Decimal("1500.00")
        for r in (exp_detail["aquaculture_management"].get("expenses_by_category") or [])
        if r.get("category") == "electricity"
    )

    inc_detail = report_income_detail(cid, start, end)
    assert inc_detail.get("aquaculture_management")
    assert any(
        Decimal(str(r["amount"])) == Decimal("12000.00")
        for r in (inc_detail["aquaculture_management"].get("income_by_category") or [])
        if r.get("category") == "fish_harvest_sale"
    )


@pytest.mark.django_db
def test_income_statement_all_entities_includes_aquaculture_register_categories(
    company_tenant,
):
    from api.services.reporting import report_income_statement

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid,
        name="P-Fisherman",
        is_active=True,
        sort_order=1,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 5, 8),
        expense_category="fisherman",
        amount=Decimal("4200.00"),
        memo="harvest crew",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=None,
        expense_date=date(2026, 5, 9),
        expense_category="lease",
        amount=Decimal("3000.00"),
        memo="company-wide lease, no pond shares",
    )
    start, end = date(2026, 5, 1), date(2026, 5, 31)
    pl = report_income_statement(cid, start, end)
    mgmt = pl.get("aquaculture_management") or {}
    exp_cats = {
        r["category"]: Decimal(str(r["amount"]))
        for r in (mgmt.get("expenses_by_category") or [])
    }
    assert exp_cats.get("fisherman", 0) == Decimal("4200.00")
    assert exp_cats.get("lease", 0) == Decimal("3000.00")

    entities = report_entities_pl_summary(cid, start, end)
    ent_cats = {
        r["category"]: Decimal(str(r["amount"]))
        for r in ((entities.get("aquaculture_management") or {}).get("expenses_by_category") or [])
    }
    assert ent_cats.get("fisherman", 0) == Decimal("4200.00")
    assert ent_cats.get("lease", 0) == Decimal("3000.00")


@pytest.mark.django_db
def test_aquaculture_pl_includes_inactive_pond_with_period_expense(company_tenant):
    from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

    cid = company_tenant.id
    closed = AquaculturePond.objects.create(
        company_id=cid,
        name="Closed Pond With Cost",
        is_active=False,
        sort_order=99,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=closed,
        expense_date=date(2026, 4, 5),
        expense_category="security",
        amount=Decimal("250.00"),
        memo="guard",
    )
    out = compute_aquaculture_pl_summary_dict(
        cid, date(2026, 4, 1), date(2026, 4, 30), None, None, None, False
    )
    pond_ids = {int(p["pond_id"]) for p in (out.get("ponds") or [])}
    assert closed.id in pond_ids
    exp = {
        r["category"]: Decimal(str(r["amount"]))
        for r in (out.get("expenses_by_category") or [])
    }
    assert exp.get("security", 0) == Decimal("250.00")


@pytest.mark.django_db
def test_fisherman_vendor_bills_are_period_expenses_on_all_entities_pl(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """Harvest/fisherman bills stay on 6719 (not 1581) so All Entities P&L and expense detail list them."""
    import json

    from api.models import Company, JournalEntryLine, Vendor
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from api.services.aquaculture_pond_bio_capitalization import pond_cost_bucket_capitalizes_to_bio
    from api.services.reporting import report_income_statement

    assert pond_cost_bucket_capitalizes_to_bio("fisherman") is False

    cid = company_tenant_with_gl.id
    Company.objects.filter(pk=cid).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
        aquaculture_capitalize_pond_consumption_to_bioasset=True,
    )
    ensure_aquaculture_chart_accounts(cid)
    pond = AquaculturePond.objects.create(company_id=cid, name="Harvest Pond", is_active=True)
    vendor = Vendor.objects.create(
        company_id=cid,
        company_name="Crew",
        display_name="Fisherman Crew",
        vendor_number="V-FISH",
        is_active=True,
    )
    h = auth_admin_headers
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-20",
                "subtotal": "4200.00",
                "tax_total": "0",
                "total": "4200.00",
                "status": "open",
                "bill_purpose": "pond",
                "lines": [
                    {
                        "description": "Harvest crew",
                        "quantity": 1,
                        "unit_cost": "4200.00",
                        "amount": "4200.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "fisherman",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    bill_id = r.json()["id"]

    debit_1581 = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        account__account_code="1581",
        debit__gt=0,
    )
    debit_6719 = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        account__account_code="6719",
        debit__gt=0,
    ).first()
    assert not debit_1581.exists()
    assert debit_6719 is not None
    assert debit_6719.debit == Decimal("4200.00")
    assert debit_6719.aquaculture_cost_bucket == "fisherman"

    start, end = date(2026, 5, 1), date(2026, 5, 31)
    pl = report_income_statement(cid, start, end)
    gl_6719 = next(
        (
            Decimal(str(a["balance"]))
            for a in pl["expenses"]["accounts"]
            if a.get("account_code") == "6719"
        ),
        Decimal("0"),
    )
    assert gl_6719 == Decimal("4200.00")
    mgmt = pl.get("aquaculture_management") or {}
    exp_cats = {r["category"]: Decimal(str(r["amount"])) for r in (mgmt.get("expenses_by_category") or [])}
    assert exp_cats.get("fisherman", 0) == Decimal("4200.00")

    entities = report_entities_pl_summary(cid, start, end)
    ent_cats = {
        r["category"]: Decimal(str(r["amount"]))
        for r in ((entities.get("aquaculture_management") or {}).get("expenses_by_category") or [])
    }
    assert ent_cats.get("fisherman", 0) == Decimal("4200.00")

    exp_detail = report_expense_detail(cid, start, end)
    ed_6719 = next(
        (
            Decimal(str(a["balance"]))
            for a in (exp_detail.get("expenses") or {}).get("accounts") or []
            if a.get("account_code") == "6719"
        ),
        Decimal("0"),
    )
    assert ed_6719 == Decimal("4200.00")
    ed_cats = {
        r["category"]: Decimal(str(r["amount"]))
        for r in ((exp_detail.get("aquaculture_management") or {}).get("expenses_by_category") or [])
    }
    assert ed_cats.get("fisherman", 0) == Decimal("4200.00")


@pytest.mark.django_db
def test_all_entities_register_includes_unallocated_fisherman_bill(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    import json

    from api.models import Company, Vendor
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts

    cid = company_tenant_with_gl.id
    Company.objects.filter(pk=cid).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
        aquaculture_capitalize_pond_consumption_to_bioasset=True,
    )
    ensure_aquaculture_chart_accounts(cid)
    vendor = Vendor.objects.create(
        company_id=cid,
        company_name="Crew HO",
        display_name="Fisherman Crew HO",
        vendor_number="V-FISH-HO",
        is_active=True,
    )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-21",
                "subtotal": "11670.00",
                "tax_total": "0",
                "total": "11670.00",
                "status": "open",
                "lines": [
                    {
                        "description": "Company-wide harvest crew",
                        "quantity": 1,
                        "unit_cost": "11670.00",
                        "amount": "11670.00",
                        "aquaculture_expense_category": "fisherman",
                        "aquaculture_cost_bucket": "fisherman",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    start, end = date(2026, 5, 1), date(2026, 5, 31)
    entities = report_entities_pl_summary(cid, start, end)
    ent_cats = {
        r["category"]: Decimal(str(r["amount"]))
        for r in ((entities.get("aquaculture_management") or {}).get("expenses_by_category") or [])
    }
    assert ent_cats.get("fisherman", 0) == Decimal("11670.00")

