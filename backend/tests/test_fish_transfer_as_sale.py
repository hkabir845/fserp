"""Historical fish transfers are mirrored as AquacultureFishSale without deleting transfer rows."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_fish_transfer_as_sale import materialize_fish_sales_for_company
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

pytestmark = pytest.mark.django_db


def _enable(company):
    Company.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )


def test_materialize_creates_sale_keeps_transfer(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Mirror", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow Mirror", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
        memo="history keep",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=dst,
        weight_kg=Decimal("100.0000"),
        fish_count=1000,
        cost_amount=Decimal("50000.00"),
        sale_amount=Decimal("52000.00"),
        sale_rate_per_kg=Decimal("520.0000"),
    )

    out = materialize_fish_sales_for_company(cid)
    assert out["sales_created"] == 1
    assert AquacultureFishPondTransfer.objects.filter(pk=xfer.id).exists()
    sale = AquacultureFishSale.objects.get(source_fish_pond_transfer_line_id=line.id)
    assert sale.pond_id == src.id
    assert sale.income_type == "fingerling_sale"
    assert sale.total_amount == Decimal("52000.00")
    assert sale.buyer_name

    # Second run is a no-op for missing lines.
    out2 = materialize_fish_sales_for_company(cid)
    assert out2["sales_created"] == 0
    assert AquacultureFishSale.objects.filter(source_fish_pond_transfer_line_id=line.id).count() == 1


def test_mirrored_sale_does_not_double_count_stock(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Stock", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow Stock", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=dst,
        weight_kg=Decimal("50.0000"),
        fish_count=500,
        cost_amount=Decimal("10000.00"),
        sale_amount=Decimal("11000.00"),
    )
    materialize_fish_sales_for_company(cid)
    rows = {r["pond_id"]: r for r in compute_fish_stock_position_rows(cid, include_inactive_ponds=True)}
    # Transfer out only once on source (not again via mirrored sale).
    assert Decimal(rows[src.id]["transfer_out_weight_kg"]) == Decimal("50.0000")
    assert Decimal(rows[src.id]["sale_weight_kg"]) == Decimal("0")
    assert Decimal(rows[dst.id]["transfer_in_weight_kg"]) == Decimal("50.0000")


def test_materialize_head_only_nursing_line(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Heads", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow Heads", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=dst,
        weight_kg=Decimal("0"),
        fish_count=110000,
        cost_amount=Decimal("55000.00"),
        sale_amount=Decimal("60000.00"),
    )
    out = materialize_fish_sales_for_company(cid)
    assert out["sales_created"] == 1
    sale = AquacultureFishSale.objects.get(source_fish_pond_transfer_line_id=line.id)
    assert sale.fish_count == 110000
    assert sale.total_amount == Decimal("60000.00")
    assert sale.income_type == "fingerling_sale"
