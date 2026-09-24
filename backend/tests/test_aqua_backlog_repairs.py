"""Regression: null-cycle retag, IPT double-BIO cleanup, head-only transfer sales, FCR merge."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
    JournalEntry,
    ChartOfAccount,
)
from api.services.aquaculture_fcr_service import _sample_row_opening_closing
from api.services.aquaculture_fish_transfer_as_sale import ensure_fish_sale_for_transfer_line
from api.services.aquaculture_ipt_bio_relief_cleanup_service import (
    delete_ipt_double_bio_relief_journals,
    find_ipt_double_bio_relief_journals,
)
from api.services.aquaculture_null_cycle_retag_service import (
    apply_null_cycle_sales,
    apply_species_mistags,
    preview_null_cycle_sales,
    preview_species_mistags,
)
from api.services.gl_posting import _create_posted_entry


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_null_cycle_retag_sole_cycle(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Sole", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C01",
        code="C01",
        start_date=date(2025, 7, 1),
        fish_species="tilapia",
    )
    sale = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2025, 8, 1),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        fish_count=1000,
        weight_kg=Decimal("500"),
        total_amount=Decimal("100000"),
    )
    preview = preview_null_cycle_sales(cid, pond_id=pond.id)
    assert preview["would_tag_count"] == 1
    assert preview["would_tag"][0]["proposed_cycle_id"] == cy.id
    out = apply_null_cycle_sales(cid, pond_id=pond.id)
    assert out["sales_tagged"] == 1
    sale.refresh_from_db()
    assert sale.production_cycle_id == cy.id


@pytest.mark.django_db
def test_null_cycle_retag_skips_ambiguous(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Multi", is_active=True)
    AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C01",
        code="C01",
        start_date=date(2025, 1, 1),
        fish_species="tilapia",
    )
    AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C02",
        code="C02",
        start_date=date(2025, 6, 1),
        fish_species="tilapia",
    )
    # Sale on C01 start day with no end before C02 — unambiguous via date windows.
    # Put sale after C02 start so only C02 matches.
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2025, 7, 1),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        fish_count=100,
        weight_kg=Decimal("50"),
        total_amount=Decimal("10000"),
    )
    preview = preview_null_cycle_sales(cid, pond_id=pond.id)
    assert preview["would_tag_count"] == 1
    # Overlapping windows on the same pond → leave for review.
    pond2 = AquaculturePond.objects.create(company_id=cid, name="Amb", is_active=True)
    AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond2,
        name="A",
        code="A",
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
        fish_species="tilapia",
    )
    AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond2,
        name="B",
        code="B",
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
        fish_species="tilapia",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond2,
        sale_date=date(2025, 3, 1),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        fish_count=50,
        weight_kg=Decimal("20"),
        total_amount=Decimal("5000"),
    )
    preview2 = preview_null_cycle_sales(cid, pond_id=pond2.id)
    assert preview2["would_tag_count"] == 0
    assert preview2["skip_count"] == 1
    assert preview2["skip"][0]["reason"] == "ambiguous_multi_cycle"


@pytest.mark.django_db
def test_ipt_double_bio_cleanup(company_tenant_with_gl):
    _enable(company_tenant_with_gl)
    cid = company_tenant_with_gl.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Seller", is_active=True)
    other = AquaculturePond.objects.create(company_id=cid, name="Buyer", is_active=True)
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=pond,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=other,
        weight_kg=Decimal("10"),
        fish_count=20,
        sale_amount=Decimal("1000"),
    )
    sale = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 6, 1),
        income_type="fish_harvest_sale",
        weight_kg=Decimal("10"),
        total_amount=Decimal("1000"),
        fish_count=20,
        fish_species="tilapia",
        source_fish_pond_transfer_line=line,
    )
    bio = ChartOfAccount.objects.filter(company_id=cid, account_code="1581").first()
    cogs = ChartOfAccount.objects.filter(company_id=cid, account_code="5240").first()
    if not bio or not cogs:
        from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
        from api.services.gl_posting import _ensure_aquaculture_harvest_cogs_account

        ensure_aquaculture_chart_accounts(cid)
        bio = ChartOfAccount.objects.filter(company_id=cid, account_code="1581").first()
        cogs = _ensure_aquaculture_harvest_cogs_account(cid)
    assert bio and cogs
    _create_posted_entry(
        cid,
        date(2026, 6, 1),
        f"AUTO-AQ-SALE-{sale.id}-BIO",
        "leftover double relief",
        [(cogs, Decimal("100.00"), Decimal("0"), "Dr"), (bio, Decimal("0"), Decimal("100.00"), "Cr")],
    )
    found = find_ipt_double_bio_relief_journals(cid)
    assert found["count"] == 1
    deleted = delete_ipt_double_bio_relief_journals(cid)
    assert deleted["found"] == 1
    assert deleted["deleted"] >= 1  # Django counts cascaded journal lines too
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO"
    ).exists()


@pytest.mark.django_db
def test_head_only_nursing_transfer_materializes_sale(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing HO", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow HO", pond_role="grow_out", is_active=True
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 5, 1),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("0"),
        fish_count=50000,
        cost_amount=Decimal("25000"),
        sale_amount=Decimal("30000"),
    )
    sale = ensure_fish_sale_for_transfer_line(line, transfer=tr)
    assert sale is not None
    assert sale.fish_count == 50000
    assert sale.weight_kg == Decimal("0")
    assert sale.total_amount == Decimal("30000.00")
    assert sale.income_type == "fingerling_sale"


@pytest.mark.django_db
def test_fcr_merges_duplicate_same_day_samples(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="FCR Dup", is_active=True)
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 1, 10),
        fish_species="tilapia",
        estimated_fish_count=1000,
        estimated_total_weight_kg=Decimal("100"),
        extrapolated_biomass_kg=Decimal("100"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 1, 10),
        fish_species="tilapia",
        estimated_fish_count=1000,
        estimated_total_weight_kg=Decimal("120"),
        extrapolated_biomass_kg=Decimal("120"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 2, 10),
        fish_species="tilapia",
        estimated_fish_count=1000,
        estimated_total_weight_kg=Decimal("200"),
        extrapolated_biomass_kg=Decimal("200"),
    )
    first, last, gain, note = _sample_row_opening_closing(
        cid, pond.id, date(2026, 1, 1), date(2026, 2, 28), fish_species="tilapia"
    )
    assert first == Decimal("120")
    assert last == Decimal("200")
    assert gain == Decimal("80.0000")
    assert "merged" in note.lower()


@pytest.mark.django_db
def test_mynuddin_c02_style_opening_reconcile_prefers_pre_harvest_heads(company_tenant):
    """C02 regression: reconciled opening uses seine mean × (eod heads + same-day harvest)."""
    from api.services.aquaculture_fcr_service import _reconciled_standing_opening_kg

    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Mynuddin C02", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C02",
        code="C02",
        start_date=date(2025, 12, 6),
        fish_species="tilapia",
    )
    # Standing sample with wrong frozen extrap (simulates stock_reference after retag).
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        production_cycle=cy,
        sample_date=date(2026, 1, 15),
        fish_species="tilapia",
        estimated_fish_count=100,
        estimated_total_weight_kg=Decimal("50"),
        avg_weight_kg=Decimal("0.5000"),
        extrapolated_biomass_kg=Decimal("15638"),  # wrong frozen (31,276 * 0.5)
    )
    # Same-day harvest 4,176 heads; live eod heads will be empty without stock events —
    # seed a tiny stock ledger presence via sale only and check sold heads path.
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        production_cycle=cy,
        sale_date=date(2026, 1, 15),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        fish_count=4176,
        weight_kg=Decimal("2000"),
        total_amount=Decimal("400000"),
    )
    kg = _reconciled_standing_opening_kg(
        cid,
        pond.id,
        date(2026, 1, 15),
        production_cycle_id=cy.id,
        fish_species="tilapia",
    )
    # With no live eod heads, opening = mean * sold_n = 0.5 * 4176 = 2088
    assert kg is not None
    assert kg == Decimal("2088.0000")


@pytest.mark.django_db
def test_species_mistag_skips_polyculture_companions(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Poly", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C24",
        code="C24",
        start_date=date(2025, 7, 1),
        fish_species="tilapia",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        production_cycle=cy,
        sale_date=date(2026, 1, 7),
        income_type="fish_harvest_sale",
        fish_species="silver_carp",
        fish_count=5,
        weight_kg=Decimal("10"),
        total_amount=Decimal("5000"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        production_cycle=cy,
        sale_date=date(2026, 1, 7),
        income_type="fish_harvest_sale",
        fish_species="rui",
        fish_count=240,
        weight_kg=Decimal("100"),
        total_amount=Decimal("50000"),
    )
    preview = preview_species_mistags(cid, pond_id=pond.id)
    assert preview["mistag_count"] == 0
    assert preview["expected_polyculture_count"] == 2


@pytest.mark.django_db
def test_species_mistag_auto_fix_from_memo(company_tenant):
    """Silver Carp billed as tilapia — memo names the real species."""
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Mistag", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=pond,
        name="C01",
        code="C01",
        start_date=date(2025, 7, 1),
        fish_species="tilapia",
    )
    sale = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        production_cycle=cy,
        sale_date=date(2025, 10, 10),
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        fish_count=20,
        weight_kg=Decimal("30"),
        total_amount=Decimal("15000"),
        memo="Silver Carp lot A",
    )
    preview = preview_species_mistags(cid, pond_id=pond.id)
    assert preview["mistag_count"] == 1
    assert preview["auto_fixable_count"] == 1
    assert preview["mistags"][0]["inferred_from_memo"] == "silver_carp"
    out = apply_species_mistags(cid, pond_id=pond.id, only_auto=True)
    assert out["fixed"] == 1
    sale.refresh_from_db()
    assert sale.fish_species == "silver_carp"
