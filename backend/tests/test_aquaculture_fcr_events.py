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
from api.services.aquaculture_biomass_book_revaluation_service import REVAL_MEMO_PREFIX
from api.services.aquaculture_fcr_service import compute_fcr_for_scope
from api.services.aquaculture_growth_service import build_fish_growth_report

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
    # Card is inventory (120 − 100). FCR still uses production 20 + 5 − 8 = 17.
    assert Decimal(out["biomass_gain_kg"]) == Decimal("20.0000")
    assert Decimal(out["biomass_production_kg"]) == Decimal("17.0000")
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
    assert Decimal(src_out["biomass_gain_kg"]) == Decimal("-10.0000")
    assert Decimal(src_out["biomass_production_kg"]) == Decimal("2.0000")
    assert Decimal(src_out["transfer_out_kg"]) == Decimal("12.0000")

    dst_out = compute_fcr_for_scope(cid, START, END, pond_id=dst.id)
    assert Decimal(dst_out["biomass_gain_kg"]) == Decimal("20.0000")
    assert Decimal(dst_out["biomass_production_kg"]) == Decimal("8.0000")
    assert Decimal(dst_out["transfer_in_kg"]) == Decimal("12.0000")


def test_fcr_ignores_auto_biomass_reval_adjustment(company_tenant_with_gl):
    """
    Live Ashari-1 (Aug–Sep 2026): sample 13,738 → 20,263 kg (gain ~6,525) but FCR
    subtracted AUTO-AQ-BIOMASS-REVAL +82,041.5282 and showed −69,165 kg.
    Reval only rewrites book kg to the sample; it is not fish arriving.
    """
    company = company_tenant_with_gl
    cid = company.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Ashari - 1 Pond", pond_role="grow_out", is_active=True
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 8, 16),
        estimated_total_weight_kg=Decimal("13738.0000"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 9, 12),
        estimated_total_weight_kg=Decimal("20263.0000"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 9, 12),
        entry_kind="adjustment",
        fish_count_delta=0,
        weight_kg_delta=Decimal("82041.5282"),
        post_to_books=False,
        memo=f"{REVAL_MEMO_PREFIX}:pond={pond.id}:sample=390:target_kg=20263.0000",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 9, 10),
        entry_kind="adjustment",
        fish_count_delta=0,
        weight_kg_delta=Decimal("80.0000"),
        memo="Manual opening add — real inbound biomass",
    )

    out = compute_fcr_for_scope(cid, date(2026, 8, 1), date(2026, 9, 16), pond_id=pond.id)
    # Card = present − August standing (20,263 − 13,738 = 6,525). Reval ignored.
    assert Decimal(out["biomass_first_kg"]) == Decimal("13738.0000")
    assert Decimal(out["biomass_last_kg"]) == Decimal("20263.0000")
    assert Decimal(out["manual_biomass_in_kg"]) == Decimal("80.0000")
    assert Decimal(out["biomass_gain_kg"]) == Decimal("6525.0000")
    assert Decimal(out["biomass_production_kg"]) == Decimal("6445.0000")

    growth = build_fish_growth_report(
        cid, date(2026, 8, 1), date(2026, 9, 16), pond_id=pond.id
    )
    assert Decimal(growth["summary"]["biomass_gain_kg"]) == Decimal("6525.0000")


def test_ashari1_live_crop_gain_uses_august_book_not_mid_stocking_sample(company_tenant_with_gl):
    """
    Live Adib Ashari-1: 16 Aug book 13,738.76 kg (118,464 fish) → 12 Sep sample
    20,263.62 kg = 6,524.86 kg. Must not use 11 Aug 7,408 kg (64,878 fish, crop
    only half stocked) or subtract the +82,041 reval.
    """
    company = company_tenant_with_gl
    cid = company.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Ashari - 1 Pond", pond_role="grow_out", is_active=True
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 8, 11),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=64878,
        weight_kg_delta=Decimal("7406.1644"),
        memo="Mid-stocking position",
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 8, 11),
        fish_species="tilapia",
        estimated_fish_count=395,
        estimated_total_weight_kg=Decimal("45.1000"),
        stock_reference_fish_count=64878,
        extrapolated_biomass_kg=Decimal("7407.5754"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 8, 16),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=53586,
        weight_kg_delta=Decimal("6332.6000"),
        memo="Finish stocking C03",
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 9, 12),
        fish_species="tilapia",
        avg_weight_kg=Decimal("0.171053"),
        stock_reference_fish_count=118464,
        extrapolated_biomass_kg=Decimal("20263.6226"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=pond,
        entry_date=date(2026, 9, 12),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=0,
        weight_kg_delta=Decimal("82041.5282"),
        post_to_books=False,
        memo=f"{REVAL_MEMO_PREFIX}:pond={pond.id}:sample=390:target_kg=20263.6226",
    )

    out = compute_fcr_for_scope(cid, date(2026, 8, 1), date(2026, 9, 16), pond_id=pond.id)
    assert Decimal(out["biomass_first_kg"]) == Decimal("13738.7644")
    # Present = 0.171053 kg × 118,464 heads (12 Sep sample), matching live 20,263.62
    assert Decimal(out["biomass_last_kg"]) == Decimal("20263.6226")
    assert Decimal(out["biomass_gain_kg"]) == Decimal("6524.8582")
    # Aug 11 / 16 stocking built the opening crop; not period inbound.
    assert Decimal(out["manual_biomass_in_kg"]) == Decimal("0.0000")
