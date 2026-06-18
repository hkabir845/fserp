"""Pond performance dashboard report: FCR, load, ADG, biomass, bioasset per pond."""
import json

import pytest
from decimal import Decimal

from api.models import AquaculturePond, Company


@pytest.mark.django_db
def test_pond_performance_report(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True)
    cid = company_tenant.id
    AquaculturePond.objects.create(
        company_id=cid,
        name="Perf Pond",
        water_area_decimal=Decimal("2.0"),
        pond_role="grow_out",
        is_active=True,
    )
    h = auth_admin_headers
    r = api_client.get(
        "/api/reports/aquaculture-pond-performance/",
        {"start_date": "2026-01-01", "end_date": "2026-06-19"},
        **h,
    )
    assert r.status_code == 200, r.content[:500]
    data = json.loads(r.content)
    assert data.get("report_id") == "aquaculture-pond-performance"
    assert "ponds" in data
    assert "summary" in data
    assert "fcr" in data
    assert len(data["ponds"]) >= 1
    row = data["ponds"][0]
    assert "biomass_kg" in row
    assert "bioasset_value" in row
    assert "fcr_biomass" in row
    assert "load_level_label" in row
    assert "adg_g_per_fish_per_day" in row
