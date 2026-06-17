"""Payroll site (station) resolution from HR employee work sites."""
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Company, Employee, PayrollRun, Station
from api.services.employee_payroll_station import (
    employee_work_site_label,
    resolve_payroll_station_id_from_employees,
    sync_payroll_station_from_employees,
)


@pytest.mark.django_db
def test_work_site_label_all_ponds_manager(company_tenant):
    cid = company_tenant.id
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="EMP-00001",
        employee_number="EMP-00001",
        first_name="Yunus",
        last_name="Khan",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    assert employee_work_site_label(emp) == "All ponds (equal share)"


@pytest.mark.django_db
def test_work_site_label_assigned_pond(company_tenant):
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonta")
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="EMP-00006",
        employee_number="EMP-00006",
        first_name="Baro",
        last_name="Babu",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond,
    )
    assert employee_work_site_label(emp) == "Digonta"
    cid = company_tenant.id
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="ACC",
        employee_number="ACC",
        first_name="Site",
        last_name="Accountant",
        salary=Decimal("85000.00"),
        is_active=True,
        aquaculture_labor_scope="not_applicable",
    )
    assert employee_work_site_label(emp) == ""


@pytest.mark.django_db
def test_resolve_station_from_site_staff_home_station(company_tenant):
    cid = company_tenant.id
    st = Station.objects.create(company_id=cid, station_name="Premium Agro Shop", operates_fuel_retail=False)
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="SHOP",
        employee_number="SHOP",
        first_name="Shop",
        last_name="Staff",
        salary=Decimal("12000.00"),
        is_active=True,
        home_station=st,
        aquaculture_labor_scope="not_applicable",
    )
    assert resolve_payroll_station_id_from_employees([emp]) == st.id


@pytest.mark.django_db
def test_resolve_station_none_for_all_ponds_only(company_tenant):
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True)
    AquaculturePond.objects.create(company_id=cid, name="Digonta")
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="EMP-00001",
        employee_number="EMP-00001",
        first_name="Shared",
        last_name="Manager",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    assert resolve_payroll_station_id_from_employees([emp], company_site_gross=Decimal("0")) is None


@pytest.mark.django_db
def test_sync_payroll_station_clears_default_for_pond_only_manager(company_tenant):
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True)
    fuel = Station.objects.create(company_id=cid, station_name="Main Fuel", operates_fuel_retail=True)
    AquaculturePond.objects.create(company_id=cid, name="Pond A")
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="EMP-00001",
        employee_number="EMP-00001",
        first_name="Shared",
        last_name="Manager",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    pr = PayrollRun.objects.create(
        company_id=cid,
        pay_period_start="2026-06-01",
        pay_period_end="2026-06-30",
        payment_date="2026-06-30",
        total_gross=Decimal("20000.00"),
        total_deductions=Decimal("0"),
        total_net=Decimal("20000.00"),
        station_id=fuel.id,
    )
    from api.services.employee_payroll_allocations import sync_single_payroll_employee_allocation

    sync_single_payroll_employee_allocation(cid, pr, emp, gross_amount=Decimal("20000.00"))
    sync_payroll_station_from_employees(cid, pr, company_site_gross=Decimal("0"))
    pr.refresh_from_db()
    assert pr.station_id is None
