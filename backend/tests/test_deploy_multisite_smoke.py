"""
Post-deploy smoke: two active stations + admin user can load core financial/ops reports.

Complements manual QA; does not replace full regression or PostgreSQL-only runs.
"""
from __future__ import annotations

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


@pytest.fixture
def tenant_two_stations(api_client, auth_admin_headers, company_tenant, user_admin):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="Site A", is_active=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Site B", is_active=True)
    return company_tenant


def _report(client: Client, headers: dict, report_id: str) -> tuple[int, dict]:
    r = client.get(f"/api/reports/{report_id}/", **headers)
    try:
        data = json.loads(r.content) if r.content else {}
    except json.JSONDecodeError:
        data = {}
    return r.status_code, data


def test_reports_smoke_two_active_stations(api_client: Client, auth_admin_headers, tenant_two_stations):
    """Five station-aware or core financial reports return 200 for tenant admin."""
    h = auth_admin_headers
    checks = [
        "trial-balance",
        "balance-sheet",
        "fuel-sales",
        "sales-by-station",
        "daily-summary",
    ]
    for rid in checks:
        status, body = _report(api_client, h, rid)
        assert status == 200, f"{rid}: {status} {body.get('detail', body)}"


def test_shift_open_requires_station_when_multiple_active(api_client: Client, auth_admin_headers, tenant_two_stations):
    """Opening a shift without station_id fails when more than one active site exists."""
    r = api_client.post(
        "/api/shifts/sessions/open/",
        data=json.dumps({"opening_cash_float": "0"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "station_id" in json.loads(r.content).get("detail", "").lower()


def test_inventory_transfer_create_draft_two_active(api_client: Client, auth_admin_headers, tenant_two_stations):
    """Inter-station shop transfer creates draft when two active sites and per-station bin SKU exist."""
    from decimal import Decimal

    from api.models import Item, Station
    from api.services.station_stock import item_uses_station_bins, set_station_stock

    cid = tenant_two_stations.id
    stations = list(Station.objects.filter(company_id=cid, is_active=True).order_by("id")[:2])
    assert len(stations) == 2
    it = Item.objects.create(
        company_id=cid,
        name="Smoke shop SKU",
        item_type="inventory",
        category="General",
    )
    assert item_uses_station_bins(cid, it)
    set_station_stock(cid, stations[0].id, it.id, Decimal("5"))
    r = api_client.post(
        "/api/inventory/transfers/",
        data=json.dumps(
            {
                "from_station_id": stations[0].id,
                "to_station_id": stations[1].id,
                "lines": [{"item_id": it.id, "quantity": "1"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content)
    assert data.get("from_station_id") == stations[0].id
    assert data.get("to_station_id") == stations[1].id
