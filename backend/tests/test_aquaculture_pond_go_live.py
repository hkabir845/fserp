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
def test_go_live_pl_zero_confirmed_marks_complete(company_tenant):
    from datetime import date

    set_company_cutover_date(company_tenant.id, date(2026, 5, 22))
    pond = AquaculturePond.objects.create(
        company=company_tenant,
        name="Fresh Pond",
        code="FP01",
        is_active=True,
        pond_role="grow_out",
        prior_pl_zero_confirmed_at=date(2026, 5, 22),
    )
    payload = build_opening_balances_payload(company_tenant.id)
    gl = next(p["go_live"] for p in payload["ponds"] if p["pond_id"] == pond.id)
    pl = next(c for c in gl["checks"] if c["id"] == "pl")
    assert pl["status"] == "complete"
    assert "confirmed zero" in pl["detail"].lower()


@pytest.mark.django_db
def test_opening_balances_put_confirms_zero_prior_pl(api_client, auth_admin_headers, company_tenant):
    import json
    from datetime import date

    from api.models import Company

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    set_company_cutover_date(company_tenant.id, date(2026, 6, 16))
    pond = AquaculturePond.objects.create(
        company=company_tenant,
        name="Zero PL Pond",
        code="ZP01",
        is_active=True,
        pond_role="grow_out",
    )
    body = {
        "cutover_date": "2026-06-16",
        "updates": [{"pond_id": pond.id, "confirm_prior_pl_zero": True}],
    }
    r = api_client.put(
        "/api/aquaculture/ponds/opening-balances/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data.get("errors") == []
    assert data.get("saved", 0) >= 1
    pond.refresh_from_db()
    assert pond.prior_pl_zero_confirmed_at == date(2026, 6, 16)
    row = next(p for p in data["ponds"] if p["pond_id"] == pond.id)
    assert row["prior_pl_zero_confirmed_at"] == "2026-06-16"
    pl = next(c for c in row["go_live"]["checks"] if c["id"] == "pl")
    assert pl["status"] == "complete"


@pytest.mark.django_db
def test_opening_balances_put_posts_pl_to_gl_without_pl_patch(api_client, auth_admin_headers, company_tenant):
    import json
    from datetime import date
    from decimal import Decimal

    from api.models import ChartOfAccount, Company
    from api.services.aquaculture_pond_pl_opening import sync_pond_pl_openings

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    set_company_cutover_date(company_tenant.id, date(2026, 6, 16))
    for code, name, atype in [
        ("4240", "Fish sales", "income"),
        ("6716", "Feed", "expense"),
        ("3200", "OBE", "equity"),
    ]:
        ChartOfAccount.objects.create(
            company_id=company_tenant.id,
            account_code=code,
            account_name=name,
            account_type=atype,
            account_sub_type="opening_balance_equity" if code == "3200" else "",
            is_active=True,
        )
    pond = AquaculturePond.objects.create(
        company=company_tenant,
        name="GL Pond",
        code="GLP01",
        is_active=True,
        pond_role="grow_out",
    )
    sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "500", "as_of_date": "2026-06-16"}],
    )
    body = {
        "cutover_date": "2026-06-16",
        "updates": [{"pond_id": pond.id, "post_pl_opening_to_gl": True}],
    }
    r = api_client.put(
        "/api/aquaculture/ponds/opening-balances/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data.get("errors") == []
    assert data.get("saved", 0) >= 1
    pond.refresh_from_db()
    assert pond.pl_opening_journal_id is not None
    row = next(p for p in data["ponds"] if p["pond_id"] == pond.id)
    assert row["pl_openings"]["pl_opening_gl_locked"] is True
    assert row["pl_openings"]["pl_opening_journal_number"] == f"AUTO-POND-PL-OB-{pond.id}"


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
