"""Fry vendor bills (Dr 1581) must count toward inter-pond transfer cost."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishStockLedger, AquaculturePond
from api.services.aquaculture_transfer_cost import resolve_auto_transfer_line_cost
from tests.test_aquaculture_fish_bioasset_gl import (
    _enable_aquaculture_with_coa,
    _fish_item,
    _post_open_fish_bill,
    _vendor,
)


@pytest.mark.django_db
def test_transfer_includes_fry_from_vendor_bill_1581(
    api_client, company_tenant, auth_admin_headers, monkeypatch
):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Fry Bill", pond_role="nursing", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Transfer")
    fry = _fish_item(cid, name="Fry Xfer Test")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, src.id, amount="350000.00")

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("250"),
        memo="Opening stock aligned with fry bill",
    )

    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._nursing_stocked_heads_basis",
        lambda **kwargs: 500000,
    )

    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        weight_kg=Decimal("100"),
        submitted_cost=Decimal("0"),
        fish_count=250000,
    )
    assert cost == Decimal("175000.00") or abs(cost - Decimal("175000.00")) < Decimal("5000")


@pytest.mark.django_db
def test_transfer_includes_uncycled_fry_bill_when_transfer_has_cycle(
    api_client, company_tenant, auth_admin_headers, monkeypatch
):
    """Fry Dr 1581 without production_cycle on JE still counts when transfer is cycle-scoped."""
    from api.models import AquacultureProductionCycle

    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Cycle Fry", pond_role="nursing", is_active=True
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=src,
        name="C01",
        start_date=date(2026, 4, 15),
        fish_species="tilapia",
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Cycle")
    fry = _fish_item(cid, name="Fry Cycle Test")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, src.id, amount="350000.00")

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        production_cycle=cycle,
        entry_date=date(2026, 4, 15),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("250"),
        memo="Opening stock for cycle transfer test",
    )

    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._nursing_stocked_heads_basis",
        lambda **kwargs: 500000,
    )

    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=cycle,
        weight_kg=Decimal("100"),
        submitted_cost=Decimal("0"),
        fish_count=250000,
    )
    assert cost == Decimal("175000.00") or abs(cost - Decimal("175000.00")) < Decimal("5000")
