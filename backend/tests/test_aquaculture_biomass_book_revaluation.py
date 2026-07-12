"""Sample-driven book biomass revaluation (world-class growth accrual)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishStockLedger,
    AquaculturePond,
    Bill,
    BillLine,
    Item,
    Vendor,
)
from api.services.aquaculture_biomass_book_revaluation_service import (
    REVAL_MEMO_PREFIX,
    sync_biomass_book_weight_from_sample,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


@pytest.mark.django_db
def test_biomass_revaluation_fixes_negative_book_kg_after_fingerling_transfers(company_tenant):
    src = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Nursing Reval",
        pond_role="nursing",
        water_area_decimal=Decimal("100"),
        is_active=True,
    )
    dst = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Grow Reval",
        pond_role="grow_out",
        is_active=True,
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Fry V")
    fish_item = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="B-REVAL-1",
        bill_date=date(2026, 4, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal("5000"),
        aquaculture_pond=src,
        aquaculture_fish_count=100000,
        aquaculture_fish_weight_kg=Decimal("33.3333"),
        aquaculture_fish_species="tilapia",
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=company_tenant.id,
        from_pond=src,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        fish_count=80000,
        weight_kg=Decimal("4000"),
    )
    sample = AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=src,
        fish_species="tilapia",
        sample_date=date(2026, 6, 15),
        estimated_fish_count=100,
        estimated_total_weight_kg=Decimal("5"),
        avg_weight_kg=Decimal("0.05"),
        stock_reference_fish_count=20000,
        extrapolated_biomass_kg=Decimal("1000"),
    )

    before = compute_fish_stock_position_rows(company_tenant.id, pond_id=src.id)[0]
    assert int(before["implied_net_fish_count"]) == 20000
    assert Decimal(str(before["implied_net_weight_kg"])) < 0

    led = sync_biomass_book_weight_from_sample(sample)
    assert led is not None
    assert led.fish_count_delta == 0
    assert led.weight_kg_delta > 0
    assert led.memo.startswith(REVAL_MEMO_PREFIX)
    assert led.post_to_books is False

    after = compute_fish_stock_position_rows(company_tenant.id, pond_id=src.id)[0]
    book = Decimal(str(after["implied_net_weight_kg"]))
    effective = Decimal(str(after["effective_net_weight_kg"]))
    assert book > 0
    assert abs(book - effective) < Decimal("0.02")

    # Idempotent: second sync replaces, does not stack
    sync_biomass_book_weight_from_sample(sample)
    n = AquacultureFishStockLedger.objects.filter(
        company_id=company_tenant.id,
        pond_id=src.id,
        memo__startswith=REVAL_MEMO_PREFIX,
    ).count()
    assert n == 1
