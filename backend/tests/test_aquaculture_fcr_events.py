"""FCR production gain includes mortality, transfers, stocking and adjustments."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishStockLedger,
    AquaculturePond,
)
from api.services.aquaculture_fcr_service import compute_fcr_for_scope

pytestmark = pytest.mark.django_db

START = date(2026, 1, 1)
END = date(2026, 1, 31)


def test_fcr_adds_mortality_and_subtracts_stocking(company_tenant_with_gl):
    company = company_tenant_with_gl
    cid = company.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="FCR Pond", pond_role="grow_out", is_active=True
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 1, 5),
        estimated_total_weight_kg=Decimal("100.0000"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 1, 25),
        estimated_total_weight_kg=Decimal("120.0000"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 1, 10),
        expense_category="feed_consumed",
        amount=Decimal("500"),
        feed_weight_kg=Decimal("40.0000"),
        memo="feed",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 1, 15),
        entry_kind="loss",
        loss_reason="mortality",
        fish_count_delta=-10,
        weight_kg_delta=Decimal("-5.0000"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_date=date(2026, 1, 8),
        expense_category="fry_stocking",
        amount=Decimal("1000"),
        feed_weight_kg=Decimal("8.0000"),
        memo="stocking",
    )

    out = compute_fcr_for_scope(cid, START, END, pond_id=pond.id)
    # sample net 20 + mortality 5 - stocking 8 = 17
    assert Decimal(out["biomass_gain_kg"]) == Decimal("17.0000")
    assert Decimal(out["mortality_loss_kg"]) == Decimal("5.0000")
    assert Decimal(out["stocking_in_kg"]) == Decimal("8.0000")
    assert out["fcr_biomass"] == "2.35"  # 40 / 17


def test_fcr_counts_transfer_out_and_in(company_tenant_with_gl):
    company = company_tenant_with_gl
    cid = company.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Src", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Dst", pond_role="grow_out", is_active=True
    )
    for pond, first, last in (
        (src, "50.0000", "40.0000"),
        (dst, "10.0000", "30.0000"),
    ):
        AquacultureBiomassSample.objects.create(
            company_id=cid,
            pond=pond,
            sample_date=date(2026, 1, 5),
            estimated_total_weight_kg=Decimal(first),
        )
        AquacultureBiomassSample.objects.create(
            company_id=cid,
            pond=pond,
            sample_date=date(2026, 1, 25),
            estimated_total_weight_kg=Decimal(last),
        )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 1, 12),
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=dst,
        weight_kg=Decimal("12.0000"),
        cost_amount=Decimal("0"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 1, 10),
        expense_category="feed_consumed",
        amount=Decimal("100"),
        feed_weight_kg=Decimal("10.0000"),
        memo="feed",
    )

    src_out = compute_fcr_for_scope(cid, START, END, pond_id=src.id)
    # net sample -10 + transfer out 12 = 2
    assert Decimal(src_out["biomass_gain_kg"]) == Decimal("2.0000")
    assert Decimal(src_out["transfer_out_kg"]) == Decimal("12.0000")

    dst_out = compute_fcr_for_scope(cid, START, END, pond_id=dst.id)
    # net sample +20 - transfer in 12 = 8
    assert Decimal(dst_out["biomass_gain_kg"]) == Decimal("8.0000")
    assert Decimal(dst_out["transfer_in_kg"]) == Decimal("12.0000")
