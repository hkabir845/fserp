"""Employee pond assignment and payroll labor splits."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

from api.models import (
    AquaculturePond,
    ChartOfAccount,
    Company,
    Employee,
    JournalEntryLine,
    PayrollRunPondAllocation,
)


@pytest.mark.django_db
def test_employee_home_pond_and_payroll_split(
    api_client: Client, auth_admin_headers, user_admin
):
    from api.models import BankAccount

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    bank = BankAccount.objects.create(
        company_id=cid,
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0001",
        bank_name="Test Bank",
    )
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond Alpha", code="PA")
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond Beta", code="PB")
    Employee.objects.create(
        company_id=cid,
        employee_code="E-PA",
        employee_number="E-PA",
        first_name="Worker",
        last_name="Alpha",
        salary=Decimal("3000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=p1,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E-PB",
        employee_number="E-PB",
        first_name="Worker",
        last_name="Beta",
        salary=Decimal("2000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=p2,
    )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-05-01",
                "pay_period_end": "2026-05-31",
                "payment_date": "2026-05-31",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 5000.0
    allocs = {a["pond_id"]: Decimal(a["amount"]) for a in d["pond_allocations"]}
    assert allocs[p1.id] == Decimal("3000.00")
    assert allocs[p2.id] == Decimal("2000.00")

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    lines = JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-PAYROLL-{pid}",
        aquaculture_pond_id__isnull=False,
    )
    assert lines.count() == 2
    assert set(lines.values_list("aquaculture_pond_id", flat=True)) == {p1.id, p2.id}
    assert all(l.aquaculture_cost_bucket == "worker_salary" for l in lines)


@pytest.mark.django_db
def test_shared_manager_salary_split_all_ponds(
    api_client: Client, auth_admin_headers, user_admin
):
    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond A")
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond B")
    p3 = AquaculturePond.objects.create(company_id=cid, name="Pond C")
    Employee.objects.create(
        company_id=cid,
        employee_code="MGR",
        employee_number="MGR",
        first_name="Pond",
        last_name="Manager",
        salary=Decimal("9000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    from api.services.employee_pond_labor import compute_pond_labor_allocations_from_employees

    allocs, warnings = compute_pond_labor_allocations_from_employees(cid)
    assert not warnings
    by_pond = {a["pond_id"]: Decimal(a["amount"]) for a in allocs}
    assert set(by_pond.keys()) == {p1.id, p2.id, p3.id}
    assert sum(by_pond.values()) == Decimal("9000.00")
    assert by_pond[p1.id] == Decimal("3000.00")
    assert by_pond[p2.id] == Decimal("3000.00")
    assert by_pond[p3.id] == Decimal("3000.00")


@pytest.mark.django_db
def test_fuel_station_accountant_excluded_from_pond_payroll(
    api_client: Client, auth_admin_headers, user_admin
):
    from api.models import Station

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    AquaculturePond.objects.create(company_id=cid, name="Pond A")
    fuel = Station.objects.create(
        company_id=cid,
        station_name="Main Station",
        operates_fuel_retail=True,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="ACC",
        employee_number="ACC",
        first_name="Fuel",
        last_name="Accountant",
        salary=Decimal("14000.00"),
        is_active=True,
        home_station=fuel,
        aquaculture_labor_scope="not_applicable",
    )
    from api.services.employee_pond_labor import compute_pond_labor_allocations_from_employees

    allocs, warnings = compute_pond_labor_allocations_from_employees(cid)
    assert allocs == []
    assert not warnings


@pytest.mark.django_db
def test_mixed_payroll_posts_pond_6712_and_site_6400(
    api_client: Client, auth_admin_headers, user_admin
):
    """Pond workers → 6712 per pond; fuel/site staff (not applicable) → 6400."""
    from api.models import BankAccount, Station

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    bank = BankAccount.objects.create(
        company_id=cid,
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0001",
        bank_name="Test Bank",
    )
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond One", code="P1")
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond Two", code="P2")
    fuel = Station.objects.create(
        company_id=cid,
        station_name="Main Station",
        operates_fuel_retail=True,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="POND-1",
        employee_number="POND-1",
        first_name="Pond",
        last_name="One",
        salary=Decimal("3000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=p1,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="POND-2",
        employee_number="POND-2",
        first_name="Pond",
        last_name="Two",
        salary=Decimal("2000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=p2,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="FUEL-ACC",
        employee_number="FUEL-ACC",
        first_name="Main",
        last_name="Accountant",
        salary=Decimal("14000.00"),
        is_active=True,
        home_station=fuel,
        aquaculture_labor_scope="not_applicable",
    )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-05-01",
                "pay_period_end": "2026-05-31",
                "payment_date": "2026-05-31",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 19000.0
    allocs = {a["pond_id"]: Decimal(a["amount"]) for a in d["pond_allocations"]}
    assert allocs == {p1.id: Decimal("3000.00"), p2.id: Decimal("2000.00")}
    assert d.get("is_mixed_entity_payroll") is True
    assert float(d.get("company_payroll_portion", 0)) == 14000.0

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    lines = JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-PAYROLL-{pid}",
    ).select_related("account")
    debits = {
        (ln.account.account_code, ln.aquaculture_pond_id): ln.debit
        for ln in lines
        if ln.debit and ln.debit > 0
    }
    assert debits[("6712", p1.id)] == Decimal("3000.00")
    assert debits[("6712", p2.id)] == Decimal("2000.00")
    assert debits[("6400", None)] == Decimal("14000.00")
    assert sum(debits.values()) == Decimal("19000.00")


@pytest.mark.django_db
def test_shop_station_default_pond_for_assigned_worker(
    api_client: Client, auth_admin_headers, user_admin
):
    """Agro shop (no fuel) with default pond: pond worker wages follow shop pond link."""
    from api.models import Station

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Premium Agro Pond", code="AG")
    shop = Station.objects.create(
        company_id=cid,
        station_name="Premium Agro",
        operates_fuel_retail=False,
        default_aquaculture_pond=pond,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="SHOP-1",
        employee_number="SHOP-1",
        first_name="Agro",
        last_name="Seller",
        salary=Decimal("12000.00"),
        is_active=True,
        home_station=shop,
        aquaculture_labor_scope="assigned_pond",
    )
    from api.services.employee_pond_labor import compute_pond_labor_allocations_from_employees

    allocs, warnings = compute_pond_labor_allocations_from_employees(cid)
    assert not warnings
    assert len(allocs) == 1
    assert allocs[0]["pond_id"] == pond.id
    assert Decimal(allocs[0]["amount"]) == Decimal("12000.00")


@pytest.mark.django_db
def test_employee_put_home_pond(api_client: Client, auth_admin_headers, user_admin):
    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Grow-out 1")
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="E-X",
        employee_number="E-X",
        first_name="Test",
        last_name="User",
        is_active=True,
    )
    r = api_client.put(
        f"/api/employees/{emp.id}/",
        data=json.dumps(
            {
                "aquaculture_labor_scope": "assigned_pond",
                "home_aquaculture_pond_id": pond.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data["home_aquaculture_pond_id"] == pond.id
    assert data["home_aquaculture_pond_name"] == "Grow-out 1"


@pytest.mark.django_db
def test_manual_partial_pond_worker_payroll_auto_allocates_and_posts_6712(
    api_client: Client, auth_admin_headers, user_admin
):
    """Manual gross for the only assigned-pond worker posts to 6712 on that pond, not site 6400."""
    from api.models import BankAccount, Station

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    bank = BankAccount.objects.create(
        company_id=cid,
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0002",
        bank_name="Test Bank",
    )
    Station.objects.create(company_id=cid, station_name="Main Station", operates_fuel_retail=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonta", code="DG")
    Employee.objects.create(
        company_id=cid,
        employee_code="POND-1",
        employee_number="POND-1",
        first_name="Pond",
        last_name="Worker",
        salary=Decimal("14000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond,
    )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
                "total_gross": "8000.00",
                "total_deductions": "0",
                "total_net": "8000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["pond_allocations_total"] == 8000.0
    assert len(d["pond_allocations"]) == 1
    assert d["pond_allocations"][0]["pond_id"] == pond.id

    je_lines = JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-PAYROLL-{pid}",
    ).select_related("account", "journal_entry")
    labor = je_lines.filter(account__account_code="6712", debit__gt=0)
    assert labor.count() == 1
    assert labor.first().aquaculture_pond_id == pond.id
    assert labor.first().station_id is None
    assert je_lines.filter(account__account_code="6400").count() == 0
    assert je_lines.first().journal_entry.station_id is None

    r = api_client.get("/api/journal-entries/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    rows = json.loads(r.content)
    je_row = next(x for x in rows if x.get("entry_number") == f"AUTO-PAYROLL-{pid}")
    assert je_row["station_name"] == "Digonta Pond"
    assert je_row["lines"][0]["station_name"] == "Digonta Pond"

    alloc = PayrollRunPondAllocation.objects.get(payroll_run_id=pid)
    assert alloc.pond_id == pond.id
    assert alloc.amount == Decimal("8000.00")


@pytest.mark.django_db
def test_post_uses_picked_employee_amounts_not_full_hr_salaries(
    api_client: Client, auth_admin_headers, user_admin
):
    """Partial payroll run: pond split from saved employee rows, not sum of all HR salaries."""
    from api.models import BankAccount

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    bank = BankAccount.objects.create(
        company_id=cid,
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0002",
        bank_name="Test Bank",
    )
    pond_a = AquaculturePond.objects.create(company_id=cid, name="Digonta")
    pond_b = AquaculturePond.objects.create(company_id=cid, name="Ashari-1")
    emp_a = Employee.objects.create(
        company_id=cid,
        employee_code="EMP-A",
        employee_number="EMP-A",
        first_name="A",
        last_name="Worker",
        salary=Decimal("70000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond_a,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="EMP-B",
        employee_number="EMP-B",
        first_name="B",
        last_name="Worker",
        salary=Decimal("35000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond_b,
    )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
                "total_gross": "34000.00",
                "total_deductions": "0",
                "total_net": "34000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.put(
        f"/api/payroll/{pid}/",
        data=json.dumps(
            {
                "employee_allocations": [
                    {"employee_id": emp_a.id, "amount": "34000.00"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["pond_allocations_total"] == 34000.0
    assert len(d["pond_allocations"]) == 1
    assert d["pond_allocations"][0]["pond_id"] == pond_a.id
