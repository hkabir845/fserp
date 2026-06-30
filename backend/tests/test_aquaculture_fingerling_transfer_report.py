"""Fingerling transfer report: nursing → grow-out reconciliation."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquaculturePond,
)
from api.services.aquaculture_fingerling_transfer_report import (
    compute_fingerling_transfer_report,
    parse_fingerling_transfer_report_filters,
)

from tests.test_aquaculture_fish_bioasset_gl import (
    _enable_aquaculture_with_coa,
    _fish_item,
    _post_open_fish_bill,
    _vendor,
)

pytestmark = pytest.mark.django_db


@pytest.mark.django_db
def test_fingerling_transfer_report_balances_nursing_and_growout(
    api_client, company_tenant, auth_admin_headers, monkeypatch
):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Rpt", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Rpt", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Rpt")
    fry = _fish_item(cid, name="Fry Rpt")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, nursing.id, amount="100000.00")

    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._nursing_stocked_heads_basis",
        lambda **kwargs: 500000,
    )
    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._live_fingerling_heads_basis",
        lambda **kwargs: 500000,
    )

    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 5, 20),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=grow,
        weight_kg=Decimal("50"),
        fish_count=250000,
        cost_amount=Decimal("50000.00"),
    )

    payload = compute_fingerling_transfer_report(
        cid, start=date(2026, 5, 1), end=date(2026, 5, 31)
    )
    assert len(payload["transfers"]) == 1
    assert len(payload["statement_lines"]) == 1
    t = payload["transfers"][0]
    assert t["transfer_balanced"] is True
    assert t["nursing_cost_out"] == t["growout_liability_in"] == "50000.00"
    assert payload["reconciliation"]["balanced"] is True
    line = payload["statement_lines"][0]
    assert line["fish_count"] == 250000
    assert line["to_pond_name"] == "Grow Rpt"
    assert Decimal(line["purchase_cost"]) + Decimal(line["other_expenses_cost"]) == Decimal(
        line["total_cost"]
    )

    filtered = compute_fingerling_transfer_report(
        cid,
        start=date(2026, 5, 1),
        end=date(2026, 5, 31),
        filters=parse_fingerling_transfer_report_filters(search_q="Grow Rpt"),
    )
    assert len(filtered["statement_lines"]) == 1

    empty = compute_fingerling_transfer_report(
        cid,
        start=date(2026, 5, 1),
        end=date(2026, 5, 31),
        filters=parse_fingerling_transfer_report_filters(search_q="no-match-xyz"),
    )
    assert empty["statement_lines"] == []


@pytest.mark.django_db
def test_fingerling_report_min_cost_filter(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Min", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Min", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=grow,
        weight_kg=Decimal("10"),
        fish_count=1000,
        cost_amount=Decimal("100.00"),
    )
    payload = compute_fingerling_transfer_report(
        cid,
        start=date(2026, 6, 1),
        end=date(2026, 6, 30),
        filters=parse_fingerling_transfer_report_filters(min_cost_raw="500"),
    )
    assert payload["statement_lines"] == []


@pytest.mark.django_db
def test_fingerling_report_excludes_grow_out_to_grow_out(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    g1 = AquaculturePond.objects.create(company_id=cid, name="G1", pond_role="grow_out", is_active=True)
    g2 = AquaculturePond.objects.create(company_id=cid, name="G2", pond_role="grow_out", is_active=True)
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=g1,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=g2,
        weight_kg=Decimal("10"),
        fish_count=1000,
        cost_amount=Decimal("100.00"),
    )
    payload = compute_fingerling_transfer_report(
        cid, start=date(2026, 6, 1), end=date(2026, 6, 30)
    )
    assert payload["transfers"] == []
    assert payload["statement_lines"] == []
