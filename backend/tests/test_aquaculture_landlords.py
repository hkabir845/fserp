"""Aquaculture landlords: pond shares, ledger balance, sync to pond lease_paid_to_landlord."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import AquaculturePond, BankAccount, ChartOfAccount, Company, JournalEntryLine
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_landlord_payment_updates_pond_lease_paid_and_ledger_balance(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Lease pond",
        is_active=True,
        leasing_area_decimal=Decimal("1.0000"),
        lease_contract_start=date(2025, 1, 1),
        lease_contract_end=date(2030, 12, 31),
        lease_price_per_decimal_per_year=Decimal("10000.0000"),
        lease_paid_to_landlord=Decimal("0"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "Mr. Owner", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "0.5"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201, r0.content.decode()
    lid = json.loads(r0.content.decode())["id"]

    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "payment",
                "amount": "2500.00",
                "entry_date": "2026-05-01",
                "pond_id": pond.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201, r_pay.content.decode()
    body = json.loads(r_pay.content.decode())
    assert body["balance_signed"] == "-2500.00"
    assert body["balance_status"] == "credit"
    pond.refresh_from_db()
    assert pond.lease_paid_to_landlord == Decimal("2500.00")

    r_pond = api_client.get(f"/api/aquaculture/ponds/{pond.id}/", **auth_admin_headers)
    assert r_pond.status_code == 200
    pj = json.loads(r_pond.content.decode())
    assert pj["lease_payment_status"]["paid_total"] == "2500.00"
    assert len(pj["landlord_pond_shares"]) == 1
    assert pj["landlord_pond_shares"][0]["landlord_id"] == lid


@pytest.mark.django_db
def test_landlord_payment_without_pond_share_cannot_apply_to_lease_paid(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "No share yet"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]

    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "payment",
                "amount": "100.00",
                "pond_id": pond.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 400


@pytest.mark.django_db
def test_delete_ledger_payment_reverses_lease_paid(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="P2",
        is_active=True,
        lease_paid_to_landlord=Decimal("50.00"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "L", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "0.25"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]
    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {"kind": "payment", "amount": "100.00", "entry_date": "2026-05-02", "pond_id": pond.id}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201
    pond.refresh_from_db()
    assert pond.lease_paid_to_landlord == Decimal("150.00")
    entries = json.loads(r_pay.content.decode())["ledger"]
    entry_id = next(e["id"] for e in entries if e["kind"] == "payment")

    r_del = api_client.delete(
        f"/api/aquaculture/landlords/{lid}/ledger/{entry_id}/",
        **auth_admin_headers,
    )
    assert r_del.status_code == 200, r_del.content.decode()
    pond.refresh_from_db()
    assert pond.lease_paid_to_landlord == Decimal("50.00")


@pytest.mark.django_db
def test_landlord_code_auto_generated_when_omitted(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "Auto Code LL"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201, r0.content.decode()
    body = json.loads(r0.content.decode())
    lid = body["id"]
    assert body["code"] == f"LL-{lid:04d}"


@pytest.mark.django_db
def test_landlord_multi_pond_payment_allocations(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    p1 = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="A", is_active=True, lease_paid_to_landlord=Decimal("0")
    )
    p2 = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="B", is_active=True, lease_paid_to_landlord=Decimal("0")
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps(
            {
                "name": "Multi",
                "pond_shares": [
                    {"pond_id": p1.id, "land_area_decimal": "0.5"},
                    {"pond_id": p2.id, "land_area_decimal": "0.25"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]

    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "payment",
                "entry_date": "2026-05-03",
                "memo": "split",
                "allocations": [
                    {"pond_id": p1.id, "amount": "1000"},
                    {"pond_id": p2.id, "amount": "500"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201, r_pay.content.decode()
    p1.refresh_from_db()
    p2.refresh_from_db()
    assert p1.lease_paid_to_landlord == Decimal("1000.00")
    assert p2.lease_paid_to_landlord == Decimal("500.00")
    body = json.loads(r_pay.content.decode())
    pays = [e for e in body["ledger"] if e["kind"] == "payment"]
    assert len(pays) == 2


@pytest.mark.django_db
def test_landlord_ledger_patch_updates_amount_and_lease_paid(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="P",
        is_active=True,
        lease_paid_to_landlord=Decimal("0"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "Patch", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "1"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]
    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {"kind": "payment", "amount": "100.00", "entry_date": "2026-05-04", "pond_id": pond.id}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201
    pond.refresh_from_db()
    assert pond.lease_paid_to_landlord == Decimal("100.00")
    entry_id = next(e["id"] for e in json.loads(r_pay.content.decode())["ledger"] if e["kind"] == "payment")

    r_patch = api_client.patch(
        f"/api/aquaculture/landlords/{lid}/ledger/{entry_id}/",
        data=json.dumps({"kind": "payment", "amount": "250.00", "pond_id": pond.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_patch.status_code == 200, r_patch.content.decode()
    pond.refresh_from_db()
    assert pond.lease_paid_to_landlord == Decimal("250.00")
    assert json.loads(r_patch.content.decode())["balance_signed"] == "-250.00"


@pytest.mark.django_db
def test_pond_share_includes_implied_annual_lease(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Rated",
        is_active=True,
        lease_price_per_decimal_per_year=Decimal("10000.0000"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "R", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "0.5"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    body = json.loads(r0.content.decode())
    sh = body["pond_shares"][0]
    assert sh["implied_annual_lease"] == "5000.00"
    assert sh["lease_price_per_decimal_per_year"] == "10000.00"


@pytest.mark.django_db
def test_landlord_payment_with_bank_posts_lease_expense_journal(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    today = timezone.now().date()
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash on Hand",
        account_type="asset",
        account_sub_type="cash_on_hand",
        opening_balance=Decimal("0"),
        opening_balance_date=today,
        is_active=True,
    )
    cash = ChartOfAccount.objects.get(company_id=company_tenant.id, account_code="1010")
    bank = BankAccount.objects.create(
        company_id=company_tenant.id,
        chart_account=cash,
        account_name="Test register",
        account_number="001",
        bank_name="Test Bank",
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="GL pond",
        is_active=True,
        lease_paid_to_landlord=Decimal("0"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "Lessor", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "1"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]

    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "payment",
                "amount": "100.00",
                "entry_date": "2026-05-10",
                "pond_id": pond.id,
                "bank_account_id": bank.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201, r_pay.content.decode()
    body = json.loads(r_pay.content.decode())
    pay_row = next(e for e in body["ledger"] if e["kind"] == "payment")
    assert pay_row.get("journal_entry_number", "").startswith("AUTO-LL-PAY-")
    je_id = pay_row.get("journal_entry_id")
    assert je_id
    debit_line = JournalEntryLine.objects.filter(journal_entry_id=je_id, debit__gt=0).first()
    assert debit_line is not None
    assert debit_line.account.account_code == "6711"
    assert debit_line.aquaculture_pond_id == pond.id
    assert debit_line.aquaculture_cost_bucket == "lease"


@pytest.mark.django_db
def test_landlord_list_includes_ytd_and_remaining_contract_metrics(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Lease pond",
        is_active=True,
        leasing_area_decimal=Decimal("1.0000"),
        lease_contract_start=date(2026, 1, 1),
        lease_contract_end=date(2026, 12, 31),
        lease_price_per_decimal_per_year=Decimal("10000"),
        lease_paid_to_landlord=Decimal("0"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps(
            {"name": "Metrics LL", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "0.5"}]}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]

    r_ch = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "rent_charge",
                "amount": "1000.00",
                "entry_date": "2026-03-01",
                "pond_id": pond.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_ch.status_code == 201
    r_pay = api_client.post(
        f"/api/aquaculture/landlords/{lid}/ledger/",
        data=json.dumps(
            {
                "kind": "payment",
                "amount": "400.00",
                "entry_date": "2026-04-01",
                "pond_id": pond.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_pay.status_code == 201

    r_list = api_client.get(
        "/api/aquaculture/landlords/?year=2026&as_of=2026-06-15",
        **auth_admin_headers,
    )
    assert r_list.status_code == 200
    rows = json.loads(r_list.content.decode())
    row = next(r for r in rows if r["id"] == lid and r["pond_id"] == pond.id)
    assert row["land_share_decimal"] == "0.5000"
    assert row["implied_annual_lease"] == "5000.00"
    assert row["ytd_receivable"] == "1000.00"
    assert row["ytd_paid"] == "400.00"
    assert row["ytd_balance"] == "600.00"
    assert row["remaining_contract_excludes_open_ended"] is False
    assert row["remaining_contract_payable"] == "2739.73"
    assert row["metrics_year"] == 2026
    assert row["metrics_as_of"] == "2026-06-15"


@pytest.mark.django_db
def test_landlord_list_period_all_vs_calendar_year(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="P",
        is_active=True,
        leasing_area_decimal=Decimal("1.0000"),
        lease_price_per_decimal_per_year=Decimal("1000"),
        lease_paid_to_landlord=Decimal("0"),
    )
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps({"name": "L", "pond_shares": [{"pond_id": pond.id, "land_area_decimal": "1"}]}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    lid = json.loads(r0.content.decode())["id"]
    for body in [
        {"kind": "rent_charge", "amount": "100.00", "entry_date": "2025-06-01", "pond_id": pond.id},
        {"kind": "rent_charge", "amount": "200.00", "entry_date": "2026-06-01", "pond_id": pond.id},
    ]:
        r = api_client.post(
            f"/api/aquaculture/landlords/{lid}/ledger/",
            data=json.dumps(body),
            content_type="application/json",
            **auth_admin_headers,
        )
        assert r.status_code == 201

    r_all = api_client.get("/api/aquaculture/landlords/?year=all", **auth_admin_headers)
    r_2026 = api_client.get("/api/aquaculture/landlords/?year=2026", **auth_admin_headers)
    assert r_all.status_code == 200
    assert r_2026.status_code == 200
    row_all = next(r for r in json.loads(r_all.content.decode()) if r["pond_id"] == pond.id)
    row_2026 = next(r for r in json.loads(r_2026.content.decode()) if r["pond_id"] == pond.id)
    assert row_all["ytd_receivable"] == "300.00"
    assert row_2026["ytd_receivable"] == "200.00"
    assert row_all["metrics_year"] is None
    assert row_2026["metrics_year"] == 2026


@pytest.mark.django_db
def test_landlord_list_pond_id_filter(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="A", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="B", is_active=True)
    r0 = api_client.post(
        "/api/aquaculture/landlords/",
        data=json.dumps(
            {
                "name": "Two ponds",
                "pond_shares": [
                    {"pond_id": p1.id, "land_area_decimal": "0.5"},
                    {"pond_id": p2.id, "land_area_decimal": "0.25"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    r_list = api_client.get(f"/api/aquaculture/landlords/?year=all&pond_id={p1.id}", **auth_admin_headers)
    assert r_list.status_code == 200
    rows = json.loads(r_list.content.decode())
    assert len(rows) == 1
    assert rows[0]["pond_id"] == p1.id
    assert rows[0]["land_share_decimal"] == "0.5000"
