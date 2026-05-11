"""Unified fish biomass ledger: aggregates ledger losses, transfers, sales (no schema change)."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    Company,
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_fish_biomass_ledger_lists_loss_sale_and_transfer_rows(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Src", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Dst", is_active=True)

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 5, 5),
        entry_kind="loss",
        loss_reason="predator_snake",
        fish_species="tilapia",
        fish_count_delta=-12,
        weight_kg_delta=Decimal("-3.50"),
        book_value=Decimal("250.00"),
        memo="snake at dawn",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        sale_date=date(2026, 5, 8),
        weight_kg=Decimal("40.00"),
        fish_count=80,
        total_amount=Decimal("8000.00"),
        memo="local market",
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 5, 3),
        fish_species="tilapia",
        memo="nursing -> grow-out",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("25.00"),
        fish_count=200,
        cost_amount=Decimal("1500.00"),
    )

    r = api_client.get("/api/aquaculture/fish-biomass-ledger/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    rows = body["rows"]
    by_source = {row["source"] for row in rows}
    assert {"ledger_loss", "sale", "transfer_in", "transfer_out"} <= by_source

    loss = next(r for r in rows if r["source"] == "ledger_loss")
    assert loss["pond_id"] == src.id
    assert loss["fish_count_delta"] == -12
    assert loss["loss_reason"] == "predator_snake"
    assert "Predators" in (loss["loss_reason_label"] or "")
    assert loss["value_amount"] == "250.00"

    sale_row = next(r for r in rows if r["source"] == "sale")
    assert sale_row["pond_id"] == src.id
    assert sale_row["fish_count_delta"] == -80
    assert sale_row["weight_kg_delta"].startswith("-40")

    out_row = next(r for r in rows if r["source"] == "transfer_out")
    in_row = next(r for r in rows if r["source"] == "transfer_in")
    assert out_row["pond_id"] == src.id and out_row["fish_count_delta"] == -200
    assert in_row["pond_id"] == dst.id and in_row["fish_count_delta"] == 200


@pytest.mark.django_db
def test_fish_biomass_ledger_filters_by_pond_and_source(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Src2", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Dst2", is_active=True)

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 5, 1),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="tilapia",
        fish_count_delta=-1,
        weight_kg_delta=Decimal("-0.10"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=src, transfer_date=date(2026, 5, 2), fish_species="tilapia"
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr, to_pond=dst, weight_kg=Decimal("5"), fish_count=10
    )

    r = api_client.get(
        f"/api/aquaculture/fish-biomass-ledger/?pond_id={dst.id}", **auth_admin_headers
    )
    body = json.loads(r.content.decode())
    assert {row["source"] for row in body["rows"]} == {"transfer_in"}

    r = api_client.get(
        "/api/aquaculture/fish-biomass-ledger/?sources=ledger_loss", **auth_admin_headers
    )
    body = json.loads(r.content.decode())
    assert {row["source"] for row in body["rows"]} == {"ledger_loss"}


@pytest.mark.django_db
def test_fish_biomass_ledger_date_range_validation(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    r = api_client.get(
        "/api/aquaculture/fish-biomass-ledger/?date_from=2026-05-10&date_to=2026-05-01",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "date_from" in r.content.decode()
