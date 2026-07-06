"""Vendor bills: single-entity and multi-entity GL tagging (AUTO-BILL journals)."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    Bill,
    ChartOfAccount,
    Company,
    JournalEntry,
    JournalEntryLine,
    Station,
    Vendor,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.gl_posting import post_bill_journal
from tests.conftest import seed_min_gl_accounts


def _post_bill_via_api(api_client, auth_admin_headers, payload: dict) -> Bill:
    payload = {**payload, "status": "open"}
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(payload),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    bill = Bill.objects.get(pk=r.json()["id"])
    assert post_bill_journal(bill.company_id, bill) is True
    return bill


def _debit_lines(bill_id: int):
    return JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        debit__gt=0,
    ).select_related("account")


def _credit_ap_line(bill_id: int):
    ap = ChartOfAccount.objects.filter(account_code="2000").first()
    return JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        credit__gt=0,
        account=ap,
    ).first()


@pytest.mark.django_db
def test_single_pond_bill_tags_debits_and_ap(api_client, company_tenant_with_gl, auth_admin_headers):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant_with_gl.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant_with_gl.id, name="Single Pond", is_active=True
    )
    vendor = Vendor.objects.create(
        company_id=company_tenant_with_gl.id,
        company_name="V1",
        display_name="V1",
        vendor_number="V-SGL",
        is_active=True,
    )
    bill = _post_bill_via_api(
        api_client,
        auth_admin_headers,
        {
            "vendor_id": vendor.id,
            "bill_date": "2026-02-18",
            "bill_purpose": "pond",
            "lines": [
                {
                    "description": "Electricity",
                    "quantity": 1,
                    "unit_cost": "13036.00",
                    "amount": "13036.00",
                    "aquaculture_pond_id": pond.id,
                    "aquaculture_expense_category": "electricity",
                }
            ],
        },
    )
    debits = list(_debit_lines(bill.id))
    assert len(debits) == 1
    assert debits[0].aquaculture_pond_id == pond.id
    ap = _credit_ap_line(bill.id)
    assert ap is not None
    assert ap.aquaculture_pond_id == pond.id


@pytest.mark.django_db
def test_multi_pond_bill_tags_each_debit_ap_unscoped(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant_with_gl.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant_with_gl.id, name="P1", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant_with_gl.id, name="P2", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant_with_gl.id,
        company_name="V2",
        display_name="V2",
        vendor_number="V-MLT",
        is_active=True,
    )
    bill = _post_bill_via_api(
        api_client,
        auth_admin_headers,
        {
            "vendor_id": vendor.id,
            "bill_date": "2026-02-18",
            "bill_purpose": "mixed",
            "lines": [
                {
                    "description": "Pond A cost",
                    "quantity": 1,
                    "unit_cost": "200.00",
                    "amount": "200.00",
                    "aquaculture_pond_id": p1.id,
                    "aquaculture_expense_category": "electricity",
                },
                {
                    "description": "Pond B cost",
                    "quantity": 1,
                    "unit_cost": "300.00",
                    "amount": "300.00",
                    "aquaculture_pond_id": p2.id,
                    "aquaculture_expense_category": "transportation",
                },
            ],
        },
    )
    debits = list(_debit_lines(bill.id))
    assert len(debits) == 2
    assert {ln.aquaculture_pond_id for ln in debits} == {p1.id, p2.id}
    ap = _credit_ap_line(bill.id)
    assert ap is not None
    assert ap.aquaculture_pond_id is None


@pytest.mark.django_db
def test_mixed_pond_and_station_bill_entity_tags(api_client, company_tenant_with_gl, auth_admin_headers):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant_with_gl.id)
    seed_min_gl_accounts(company_tenant_with_gl)
    ChartOfAccount.objects.get_or_create(
        company_id=company_tenant_with_gl.id,
        account_code="6100",
        defaults={"account_name": "Utilities", "account_type": "expense", "is_active": True},
    )
    pond = AquaculturePond.objects.create(
        company_id=company_tenant_with_gl.id, name="Mix Pond", is_active=True
    )
    station = Station.objects.create(
        company_id=company_tenant_with_gl.id,
        station_name="Fuel Site",
        is_active=True,
        operates_fuel_retail=True,
    )
    vendor = Vendor.objects.create(
        company_id=company_tenant_with_gl.id,
        company_name="V3",
        display_name="V3",
        vendor_number="V-MIX",
        is_active=True,
    )
    bill = _post_bill_via_api(
        api_client,
        auth_admin_headers,
        {
            "vendor_id": vendor.id,
            "bill_date": "2026-02-18",
            "bill_purpose": "mixed",
            "lines": [
                {
                    "description": "Pond power",
                    "quantity": 1,
                    "unit_cost": "100.00",
                    "amount": "100.00",
                    "aquaculture_pond_id": pond.id,
                    "aquaculture_expense_category": "electricity",
                },
                {
                    "description": "Station utilities",
                    "quantity": 1,
                    "unit_cost": "50.00",
                    "amount": "50.00",
                    "line_receipt_station_id": station.id,
                    "fuel_station_expense_category": "utilities",
                },
            ],
        },
    )
    debits = list(_debit_lines(bill.id))
    assert len(debits) == 2
    pond_debit = next(ln for ln in debits if ln.aquaculture_pond_id == pond.id)
    st_debit = next(ln for ln in debits if ln.aquaculture_pond_id is None)
    assert pond_debit.debit == Decimal("100.00")
    assert st_debit.debit == Decimal("50.00")
    assert st_debit.station_id == station.id
    ap = _credit_ap_line(bill.id)
    assert ap is not None
    assert ap.aquaculture_pond_id is None


@pytest.mark.django_db
def test_single_pond_bill_with_tax_tags_remainder_and_ap(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant_with_gl.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant_with_gl.id, name="Tax Pond", is_active=True
    )
    vendor = Vendor.objects.create(
        company_id=company_tenant_with_gl.id,
        company_name="V4",
        display_name="V4",
        vendor_number="V-TAX",
        is_active=True,
    )
    bill = _post_bill_via_api(
        api_client,
        auth_admin_headers,
        {
            "vendor_id": vendor.id,
            "bill_date": "2026-02-18",
            "tax_amount": "15.00",
            "lines": [
                {
                    "description": "Labor",
                    "quantity": 1,
                    "unit_cost": "1000.00",
                    "amount": "1000.00",
                    "aquaculture_pond_id": pond.id,
                    "aquaculture_expense_category": "day_labor",
                }
            ],
        },
    )
    assert bill.total == Decimal("1015.00")
    debits = list(_debit_lines(bill.id).order_by("debit"))
    assert len(debits) == 2
    assert all(ln.aquaculture_pond_id == pond.id for ln in debits)
    assert sum(ln.debit for ln in debits) == Decimal("1015.00")
    ap = _credit_ap_line(bill.id)
    assert ap is not None
    assert ap.aquaculture_pond_id == pond.id
    assert ap.credit == Decimal("1015.00")


@pytest.mark.django_db
def test_shared_equal_pond_split_posts_per_pond_debits(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant_with_gl.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant_with_gl.id, name="Share-A", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant_with_gl.id, name="Share-B", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant_with_gl.id,
        company_name="V5",
        display_name="V5",
        vendor_number="V-SHR",
        is_active=True,
    )
    bill = _post_bill_via_api(
        api_client,
        auth_admin_headers,
        {
            "vendor_id": vendor.id,
            "bill_date": "2026-02-18",
            "bill_purpose": "pond",
            "lines": [
                {
                    "description": "Shared lease",
                    "quantity": 1,
                    "unit_cost": "1000.00",
                    "amount": "1000.00",
                    "aquaculture_cost_mode": "shared_equal",
                    "shared_equal_pond_ids": [p1.id, p2.id],
                    "aquaculture_expense_category": "electricity",
                }
            ],
        },
    )
    assert bill.lines.count() == 2
    debits = list(_debit_lines(bill.id))
    assert len(debits) == 2
    assert {ln.aquaculture_pond_id for ln in debits} == {p1.id, p2.id}
    assert JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill.id}", is_posted=True).exists()
