"""Tests for pond go-live readiness payload."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Employee
from api.services.aquaculture_pond_go_live_service import (
    build_opening_balances_payload,
    get_company_cutover_date,
    set_company_cutover_date,
)


@pytest.mark.django_db
def test_go_live_payload_includes_readiness(company_tenant):
    pond = AquaculturePond.objects.create(
        company=company_tenant,
        name="Go-live Pond",
        code="GL01",
        is_active=True,
        pond_role="grow_out",
    )
    payload = build_opening_balances_payload(company_tenant.id)
    assert "cutover_date" in payload
    assert payload["go_live"]["total_ponds"] == 1
    assert len(payload["ponds"]) == 1
    gl = payload["ponds"][0]["go_live"]
    assert "readiness_percent" in gl
    assert "checks" in gl
    assert any(c["id"] == "pl" for c in gl["checks"])
    assert gl["biology"]["has_biomass"] is False


@pytest.mark.django_db
def test_go_live_payload_with_employee_does_not_500(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="P", code="P01")
    Employee.objects.create(
        company=company_tenant,
        home_aquaculture_pond=pond,
        first_name="A",
        last_name="B",
        opening_balance=Decimal("10"),
        opening_balance_date="2025-01-01",
    )
    payload = build_opening_balances_payload(company_tenant.id)
    assert payload["ponds"][0]["go_live"]["readiness_percent"] >= 0


@pytest.mark.django_db
def test_cutover_date_round_trip(company_tenant):
    set_company_cutover_date(company_tenant.id, None)
    company_tenant.refresh_from_db()
    assert get_company_cutover_date(company_tenant) is not None
    set_company_cutover_date(company_tenant.id, date(2026, 5, 22))
    company_tenant.refresh_from_db()
    assert company_tenant.aquaculture_go_live_cutover_date.isoformat() == "2026-05-22"
    payload = build_opening_balances_payload(company_tenant.id)
    assert payload["cutover_date"] == "2026-05-22"


@pytest.mark.django_db
def test_go_live_customer_check_when_no_pos_customer(company_tenant):
    pond = AquaculturePond.objects.create(
        company=company_tenant,
        name="No POS",
        code="NP01",
        is_active=True,
        pond_role="grow_out",
    )
    payload = build_opening_balances_payload(company_tenant.id)
    gl = next(p["go_live"] for p in payload["ponds"] if p["pond_id"] == pond.id)
    cust = next(c for c in gl["checks"] if c["id"] == "customer")
    assert cust["status"] == "optional"


@pytest.mark.django_db
def test_go_live_parties_check_when_vendor_linked_zero_balance(company_tenant):
    from api.models import Vendor

    pond = AquaculturePond.objects.create(company=company_tenant, name="V Pond", code="VP01")
    Vendor.objects.create(
        company=company_tenant,
        company_name="Supplier",
        default_aquaculture_pond=pond,
        opening_balance=Decimal("0"),
    )
    payload = build_opening_balances_payload(company_tenant.id)
    gl = payload["ponds"][0]["go_live"]
    parties = next(c for c in gl["checks"] if c["id"] == "parties")
    assert parties["status"] == "complete"
