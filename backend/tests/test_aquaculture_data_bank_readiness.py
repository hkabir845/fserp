"""Data Bank year close requires an empty pond (global harvest → renovate → restock practice)."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
    Item,
    ItemPondStock,
)
from api.services.aquaculture_data_bank_service import (
    close_pond,
    pond_year_close_readiness,
    preview_pond_close,
)
from tests.test_aquaculture_fish_bioasset_gl import (
    _enable_aquaculture_with_coa,
    _fish_item,
    _post_open_fish_bill,
    _vendor,
)


@pytest.mark.django_db
def test_year_close_blocked_when_fish_remain(api_client, company_tenant, auth_admin_headers):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    company = Company.objects.get(pk=cid)
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Stocked Pond", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Ready")
    fry = _fish_item(cid, name="Tilapia Fry Ready")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    readiness = pond_year_close_readiness(cid, pond.id, date(2026, 12, 31))
    assert readiness["is_ready"] is False
    assert any("live fish" in b.lower() for b in readiness["blockers"])

    preview = preview_pond_close(company, pond, date(2026, 12, 31), date(2026, 1, 1))
    assert preview["is_ready"] is False

    close, err = close_pond(
        company_id=cid,
        pond_id=pond.id,
        period_end=date(2026, 12, 31),
        period_start=date(2026, 1, 1),
        user=None,
    )
    assert close is None
    assert err is not None
    assert "not ready" in err.lower()


@pytest.mark.django_db
def test_year_close_blocked_when_warehouse_has_feed(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Feed Pond", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Grower Feed",
        item_type="inventory",
        pos_category="feed",
        unit="kg",
    )
    ItemPondStock.objects.create(
        company_id=cid,
        pond=pond,
        item=feed,
        quantity=Decimal("25.0000"),
    )

    readiness = pond_year_close_readiness(cid, pond.id, date(2026, 12, 31))
    assert readiness["is_ready"] is False
    assert any("warehouse" in b.lower() for b in readiness["blockers"])


@pytest.mark.django_db
def test_year_close_auto_ends_open_production_cycles(
    api_client, company_tenant, auth_admin_headers
):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Empty Pond", pond_role="grow_out", is_active=True
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="Completed batch",
        start_date=date(2026, 2, 1),
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Empty")
    fry = _fish_item(cid, name="Tilapia Fry Empty")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 11, 30),
        weight_kg=Decimal("20"),
        fish_count=5000,
        total_amount=Decimal("5000"),
        income_type="fish_harvest_sale",
    )
    sale = AquacultureFishSale.objects.filter(pond_id=pond.id).order_by("-id").first()
    assert sale is not None

    from api.services.gl_posting import post_aquaculture_fish_sale_bio_relief_journal

    post_aquaculture_fish_sale_bio_relief_journal(
        cid,
        sale.id,
        date(2026, 11, 30),
        relief_amount=Decimal("500.00"),
        pond_id=pond.id,
        production_cycle_id=None,
        pond_label=pond.name,
        weight_kg=Decimal("20"),
        cost_per_kg=Decimal("25"),
    )
    readiness = pond_year_close_readiness(cid, pond.id, date(2026, 12, 31))

    assert readiness["is_ready"] is True, readiness["blockers"]

    close, err = close_pond(
        company_id=cid,
        pond_id=pond.id,
        period_end=date(2026, 12, 31),
        period_start=date(2026, 1, 1),
        user=None,
    )
    assert err is None, err
    assert close is not None
    assert close.settlement_fish_count == 0
    assert close.settlement_bioasset_value == Decimal("0.00")

    cycle.refresh_from_db()
    assert cycle.end_date == date(2026, 12, 31)
    assert cycle.is_active is False
