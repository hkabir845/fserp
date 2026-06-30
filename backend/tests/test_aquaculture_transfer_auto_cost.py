"""Fish pond transfer: auto-fill line cost from source pond P&L when cost omitted or zero."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine
from api.services.aquaculture_pl_service import _money_q
from api.services.aquaculture_transfer_cost import (
    backfill_missing_transfer_line_costs,
    preview_transfer_line_costs,
    resolve_auto_transfer_line_cost,
    resync_nursing_pond_transfer_costs,
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_resolve_auto_transfer_line_cost_from_pl(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Src", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow Dst", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("1000.00"),
        memo="fry",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 4, 10),
        weight_kg=Decimal("100.00"),
        fish_count=5000,
        total_amount=Decimal("5000.00"),
    )
    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        weight_kg=Decimal("10.00"),
        submitted_cost=Decimal("0"),
    )
    assert cost == Decimal("100.00")  # 1000 / 100 kg × 10 kg


@pytest.mark.django_db
def test_transfer_cost_uses_line_kg_when_larger_than_fingerling_sale_denominator(company_tenant):
    """Avoid 1.45M/500kg style inflation when moving more kg than prior fingerling sales."""
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Digonta-like", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 25),
        expense_category="fry_stocking",
        amount=Decimal("350000.00"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 5, 2),
        weight_kg=Decimal("500.00"),
        fish_count=25000,
        total_amount=Decimal("187500.00"),
    )
    cogs = ChartOfAccount.objects.filter(
        company_id=cid, account_type="cost_of_goods_sold", is_active=True
    ).first()
    inv_ac = ChartOfAccount.objects.filter(company_id=cid, account_type="asset", is_active=True).first()
    if cogs and inv_ac:
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_date=date(2026, 5, 8),
            entry_number="AUTO-BILL-TEST",
            description="shop",
            is_posted=True,
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=cogs,
            debit=Decimal("1100000"),
            credit=Decimal("0"),
            aquaculture_pond_id=src.id,
            aquaculture_cost_bucket="shop_supplies",
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=inv_ac,
            debit=Decimal("0"),
            credit=Decimal("1100000"),
            aquaculture_pond_id=src.id,
            aquaculture_cost_bucket="shop_supplies",
        )

    weight = Decimal("2181.82")
    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        weight_kg=weight,
        submitted_cost=Decimal("0"),
    )
    # fry only: 350000 / 2181.82 × 2181.82 — not 1450000/500 × 2181.82
    assert cost == Decimal("350000.00")


@pytest.mark.django_db
def test_fish_pond_transfer_api_auto_fills_zero_cost(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="API Nursing", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="API Grow", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("2000.00"),
        memo="fry",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=3500,
        weight_kg_delta=Decimal("70"),
        memo="Opening fry for transfer cost test",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 4, 10),
        weight_kg=Decimal("50.00"),
        fish_count=2500,
        total_amount=Decimal("2500.00"),
    )
    from api.models import AquacultureBiomassSample

    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=src,
        sample_date=date(2026, 5, 1),
        estimated_fish_count=600,
        estimated_total_weight_kg=Decimal("12"),
        fish_species="tilapia",
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [
                    {
                        "to_pond_id": dst.id,
                        "weight_kg": "20",
                        "fish_count": 400,
                        "cost_amount": "0",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    line = json.loads(r.content)["transfer"]["lines"][0]
    assert Decimal(line["cost_amount"]) == Decimal("800.00")  # 2000 × 400 ÷ 1000 live (3500 − 2500 sold)


@pytest.mark.django_db
def test_transfer_cost_falls_back_to_ytd_when_cycle_has_no_production_costs(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Cycle Src", is_active=True)
    cycle = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=src,
        name="Late cycle",
        start_date=date(2026, 5, 10),
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 25),
        expense_category="fry_stocking",
        amount=Decimal("350000.00"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 5, 2),
        weight_kg=Decimal("500.00"),
        fish_count=25000,
        total_amount=Decimal("187500.00"),
    )
    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=cycle,
        weight_kg=Decimal("2181.82"),
        submitted_cost=Decimal("0"),
        transfer_total_weight_kg=Decimal("2181.82"),
    )
    assert cost == Decimal("350000.00")


@pytest.mark.django_db
def test_two_nursing_transfers_split_fry_cost_by_heads_not_full_bio_each_time(company_tenant, monkeypatch):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing A", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("350000.00"),
    )
    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._live_fingerling_heads_basis",
        lambda **kwargs: 500000,
    )

    c1 = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 9),
        from_cycle=None,
        weight_kg=Decimal("3571.43"),
        submitted_cost=Decimal("0"),
        transfer_total_weight_kg=Decimal("3571.43"),
        fish_count=250000,
    )
    c2 = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        weight_kg=Decimal("2181.82"),
        submitted_cost=Decimal("0"),
        transfer_total_weight_kg=Decimal("2181.82"),
        fish_count=120000,
    )
    assert c1 == Decimal("175000.00")
    assert c2 == Decimal("84000.00")
    assert c1 != c2


@pytest.mark.django_db
def test_two_nursing_transfers_share_total_bio_by_survivor_fish_count(company_tenant):
    """
    Real-world: ~660k fry+expenses on nursing pond; 87,780 + 27,100 survivors moved out.
    Cost per fish = total bio ÷ 114,880; each line = fish_count × cost/fish (not ~660k each).
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Ashari Nursing", pond_role="nursing", is_active=True
    )
    dst1 = AquaculturePond.objects.create(company_id=cid, name="Ashari Grow 1", is_active=True)
    dst2 = AquaculturePond.objects.create(company_id=cid, name="Mynuddin Grow", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 10, 1),
        expense_category="fry_stocking",
        amount=Decimal("660000.00"),
    )

    tr1 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 11, 8),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr1,
        to_pond=dst1,
        weight_kg=Decimal("418"),
        fish_count=87780,
        cost_amount=Decimal("0"),
    )
    tr2 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 12, 6),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr2,
        to_pond=dst2,
        weight_kg=Decimal("666.34"),
        fish_count=27100,
        cost_amount=Decimal("0"),
    )

    from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=src.id,
        from_production_cycle_id=None,
    )
    tr1.lines.first().refresh_from_db()
    tr2.lines.first().refresh_from_db()
    c1 = tr1.lines.first().cost_amount
    c2 = tr2.lines.first().cost_amount
    total_fish = 87780 + 27100
    per_fish = Decimal("660000.00") / Decimal(total_fish)
    assert c1 == _money_q(per_fish * 87780)
    assert c2 == _money_q(per_fish * 27100)
    assert c1 + c2 == Decimal("660000.00")
    assert c1 > c2
    assert c1 < Decimal("660000.00")


@pytest.mark.django_db
def test_nursing_resync_spreads_later_expenses_across_all_transfer_dates(company_tenant):
    """
    Mynuddin-style: fry in April, feed in June, transfers on multiple dates.
    After resync every line shares one cost pool (through latest transfer date) by fish count.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond", pond_role="nursing", is_active=True
    )
    dst_a = AquaculturePond.objects.create(company_id=cid, name="Ashari-2 Pond", is_active=True)
    dst_b = AquaculturePond.objects.create(company_id=cid, name="Ashari-1 Pond", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("391200.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 6, 1),
        expense_category="feed_purchase",
        amount=Decimal("22000.00"),
    )
    tr_early = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 4, 23),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr_early,
        to_pond=dst_a,
        weight_kg=Decimal("1956"),
        fish_count=107580,
        cost_amount=Decimal("391200.00"),
    )
    tr_late = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr_late,
        to_pond=dst_a,
        weight_kg=Decimal("1934"),
        fish_count=116040,
        cost_amount=Decimal("3368.54"),
    )
    tr_mid = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 18),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr_mid,
        to_pond=dst_b,
        weight_kg=Decimal("3570.16"),
        fish_count=122528,
        cost_amount=Decimal("5886.93"),
    )

    from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=src.id,
        from_production_cycle_id=None,
    )
    lines = list(
        AquacultureFishPondTransferLine.objects.filter(
            transfer__from_pond_id=src.id
        ).order_by("transfer__transfer_date")
    )
    total_fish = sum(int(ln.fish_count or 0) for ln in lines)
    total_cost = sum(ln.cost_amount or Decimal("0") for ln in lines)
    bio_total = Decimal("413200.00")
    per_fish = bio_total / Decimal(total_fish)
    assert total_cost <= bio_total
    assert lines[0].cost_amount == _money_q(per_fish * 107580)
    assert lines[0].cost_amount < Decimal("391200.00")


@pytest.mark.django_db
def test_backfill_missing_transfer_line_costs(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Backfill Src", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Backfill Dst", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("350000.00"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 4, 10),
        weight_kg=Decimal("500.00"),
        fish_count=25000,
        total_amount=Decimal("187500.00"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 5, 17),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("2181.82"),
        fish_count=120000,
        cost_amount=Decimal("0"),
    )
    assert backfill_missing_transfer_line_costs(tr) == 1
    tr.lines.first().refresh_from_db()
    assert tr.lines.first().cost_amount == Decimal("350000.00")

    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.get("/api/aquaculture/fish-pond-transfers/", **h)
    assert r.status_code == 200
    xfer = next(x for x in json.loads(r.content)["transfers"] if x["id"] == tr.id)
    assert Decimal(xfer["lines"][0]["cost_amount"]) == Decimal("350000.00")


@pytest.mark.django_db
def test_fish_pond_transfer_preview_cost_api(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Preview Nursing", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("2000.00"),
        memo="fry",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=3500,
        weight_kg_delta=Decimal("70"),
        memo="Opening fry for preview cost test",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=src,
        income_type="fingerling_sale",
        fish_species="tilapia",
        sale_date=date(2026, 4, 10),
        weight_kg=Decimal("50.00"),
        fish_count=2500,
        total_amount=Decimal("2500.00"),
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/preview-cost/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-05-17",
                "lines": [{"weight_kg": "20", "fish_count": 400}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content)
    assert body["cost_basis"] == "per_head"
    assert Decimal(body["lines"][0]["cost_amount"]) == Decimal("800.00")
    assert body["transfer_cost_per_head"] is not None


@pytest.mark.django_db
def test_nursing_transfer_cost_uses_live_heads_and_all_production_expenses(company_tenant):
    """
    (fry + feed + …) ÷ live fingerlings × heads transferred.
    Example: 1.1M fry + 500K feed on 450K survivors → 120K heads ≈ 426,666.67 BDT.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Live", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("1100000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 15),
        expense_category="feed_purchase",
        amount=Decimal("500000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 20),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=450000,
        weight_kg_delta=Decimal("225.0000"),
        memo="Live count after mortality",
    )

    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        weight_kg=Decimal("240.0000"),
        submitted_cost=Decimal("0"),
        fish_count=120000,
    )
    assert cost == Decimal("426666.67")

    preview = preview_transfer_line_costs(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 5, 17),
        from_cycle=None,
        lines=[{"weight_kg": Decimal("240"), "fish_count": 120000}],
    )
    assert preview["cost_basis"] == "per_head"
    assert preview["live_fingerling_count"] == 450000
    assert Decimal(preview["movable_bio_asset_total"]) == Decimal("1600000.00")
    assert Decimal(preview["transfer_cost_per_head"]) == Decimal("3.56")
    assert Decimal(preview["lines"][0]["cost_amount"]) == Decimal("426666.67")


@pytest.mark.django_db
def test_mynuddin_nursing_fry_and_feed_exclude_fixed_pond_costs(company_tenant):
    """
    Mynuddin-style: 1.1M fry + feed/medicine/day labor move with fingerlings;
    lease/electricity/equipment stay on the nursing pond.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond", pond_role="nursing", is_active=True
    )
    dst1 = AquaculturePond.objects.create(company_id=cid, name="Ashari Grow 1", is_active=True)
    dst2 = AquaculturePond.objects.create(company_id=cid, name="Ashari Grow 2", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 4, 23),
        expense_category="fry_stocking",
        amount=Decimal("1100000.33"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 5, 15),
        expense_category="feed_purchase",
        amount=Decimal("85000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 5, 20),
        expense_category="day_labor",
        amount=Decimal("12000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 5, 1),
        expense_category="electricity",
        amount=Decimal("45000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 5, 1),
        expense_category="equipment",
        amount=Decimal("80000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2025, 5, 25),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=346148,
        weight_kg_delta=Decimal("1730.74"),
        memo="Survivors after mortality",
    )

    tr1 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr1,
        to_pond=dst1,
        weight_kg=Decimal("900"),
        fish_count=107580,
        cost_amount=Decimal("1100000.33"),
    )
    tr2 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 18),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr2,
        to_pond=dst2,
        weight_kg=Decimal("1200"),
        fish_count=122528,
        cost_amount=Decimal("0"),
    )

    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=src.id,
        from_production_cycle_id=None,
    )
    tr1.lines.first().refresh_from_db()
    tr2.lines.first().refresh_from_db()
    movable_total = Decimal("1100000.33") + Decimal("85000.00") + Decimal("12000.00")
    transferred_fish = 107580 + 122528
    survivor_pool = 346148
    per_fish = movable_total / Decimal(survivor_pool)
    assert tr1.lines.first().cost_amount == _money_q(per_fish * 107580)
    assert tr2.lines.first().cost_amount == _money_q(per_fish * 122528)
    line_total = tr1.lines.first().cost_amount + tr2.lines.first().cost_amount
    assert abs(line_total - _money_q(movable_total * Decimal(transferred_fish) / Decimal(survivor_pool))) <= Decimal(
        "0.02"
    )
    assert tr1.lines.first().cost_amount < Decimal("1100000.33")


@pytest.mark.django_db
def test_nursing_batch_resync_without_nursing_role_when_large_head_batch(company_tenant):
    """Ponds used as nursing without pond_role still batch-resync fingerling transfers."""
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin (no role tag)", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow Out", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 4, 23),
        expense_category="fry_stocking",
        amount=Decimal("1100000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2025, 4, 23),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("250"),
        memo="Fry stocked",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2025, 6, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=-153852,
        weight_kg_delta=Decimal("-76.926"),
        memo="Mortality adjustment before fingerling transfer",
    )
    tr1 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr1,
        to_pond=dst,
        weight_kg=Decimal("500"),
        fish_count=200000,
        cost_amount=Decimal("1100000.00"),
    )
    tr2 = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 18),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr2,
        to_pond=dst,
        weight_kg=Decimal("600"),
        fish_count=146148,
        cost_amount=Decimal("0"),
    )

    from api.services.aquaculture_transfer_cost import pond_uses_nursing_batch_costing

    assert pond_uses_nursing_batch_costing(company_id=cid, from_pond_id=src.id)
    resync_nursing_pond_transfer_costs(
        company_id=cid,
        from_pond_id=src.id,
        from_production_cycle_id=None,
    )
    tr1.lines.first().refresh_from_db()
    tr2.lines.first().refresh_from_db()
    total_fish = 200000 + 146148
    per_fish = Decimal("1100000.00") / Decimal(total_fish)
    assert tr1.lines.first().cost_amount == _money_q(per_fish * 200000)
    assert tr2.lines.first().cost_amount == _money_q(per_fish * 146148)
    assert tr1.lines.first().cost_amount + tr2.lines.first().cost_amount == Decimal("1100000.00")


@pytest.mark.django_db
def test_transfer_api_includes_fry_and_other_cost_columns(api_client, company_tenant, auth_admin_headers):
    """Transfer list JSON exposes fry_cost_amount + other_expense_amount summing to cost_amount."""
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Split Nursing", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="Split Grow", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("800000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2025, 5, 1),
        expense_category="feed_purchase",
        amount=Decimal("200000.00"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2025, 6, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("500"),
        fish_count=100000,
        cost_amount=Decimal("500000.00"),
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.get("/api/aquaculture/fish-pond-transfers/", **h)
    assert r.status_code == 200
    xfer = next(x for x in r.json()["transfers"] if x["id"] == tr.id)
    line = xfer["lines"][0]
    fry = Decimal(line["fry_cost_amount"])
    other = Decimal(line["other_expense_amount"])
    total = Decimal(line["cost_amount"])
    assert fry + other == total
    assert fry > Decimal("0")
    assert other > Decimal("0")
    assert Decimal(xfer["fry_cost_total"]) == fry
    assert Decimal(xfer["other_expense_total"]) == other
    assert Decimal(xfer["cost_total"]) == total


@pytest.mark.django_db
def test_transfer_other_expenses_include_uncycled_feed_when_source_batch_set(
    api_client, company_tenant, auth_admin_headers, monkeypatch
):
    """Cycle-scoped transfer must still split feed/medicine not tagged to the batch."""
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow Batch", is_active=True)
    cycle = AquacultureProductionCycle.objects.create(
        company_id=cid,
        pond=src,
        name="N01",
        start_date=date(2026, 4, 1),
        fish_species="tilapia",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        production_cycle=cycle,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("800000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        production_cycle=None,
        expense_date=date(2026, 5, 1),
        expense_category="feed_purchase",
        amount=Decimal("200000.00"),
    )
    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._nursing_stocked_heads_basis",
        lambda **kwargs: 500000,
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        from_production_cycle=cycle,
        transfer_date=date(2026, 6, 10),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("500"),
        fish_count=250000,
        cost_amount=Decimal("500000.00"),
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.get("/api/aquaculture/fish-pond-transfers/", **h)
    assert r.status_code == 200
    xfer = next(x for x in r.json()["transfers"] if x["id"] == tr.id)
    line = xfer["lines"][0]
    fry = Decimal(line["fry_cost_amount"])
    other = Decimal(line["other_expense_amount"])
    total = Decimal(line["cost_amount"])
    assert fry + other == total
    assert fry > Decimal("0")
    assert other > Decimal("0")
    assert other >= Decimal("50000.00")


@pytest.mark.django_db
def test_nursing_transfer_does_not_use_draft_line_count_as_cost_denominator(company_tenant, monkeypatch):
    """
    Bug: entering 210k heads on the first transfer must not make the survivor pool 210k,
    which capped line cost at the entire bio-asset (138,935) instead of heads × cost/fish.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Digonta Nursing", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("138935.00"),
    )
    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._live_fingerling_heads_basis",
        lambda **kwargs: 9700,
    )

    cost = resolve_auto_transfer_line_cost(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 6, 30),
        from_cycle=None,
        weight_kg=Decimal("15000"),
        submitted_cost=Decimal("0"),
        fish_count=210000,
        transfer_total_fish_count=210000,
    )
    per_fish = Decimal("138935.00") / Decimal("9700")
    assert cost == _money_q(per_fish * 210000)
    assert cost > Decimal("138935.00")


@pytest.mark.django_db
def test_nursing_transfer_500k_fry_at_220_per_piece_plus_feed(company_tenant):
    """
    500k fry @ BDT 2.20 + feed/medicine spread over survivors; 210k moved ≈ proportional share.
    Lease/electricity excluded from movable pool.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="User Nursing", pond_role="nursing", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 3, 1),
        expense_category="fry_stocking",
        amount=Decimal("1100000.00"),
        memo="500k fry @ 2.20",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="feed_purchase",
        amount=Decimal("350000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="day_labor",
        amount=Decimal("45000.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_date=date(2026, 4, 1),
        expense_category="electricity",
        amount=Decimal("60000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 15),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=450000,
        weight_kg_delta=Decimal("32142.8571"),
        memo="Survivors after nursing",
    )

    preview = preview_transfer_line_costs(
        company_id=cid,
        from_pond_id=src.id,
        transfer_date=date(2026, 6, 30),
        from_cycle=None,
        lines=[{"weight_kg": Decimal("15000"), "fish_count": 210000}],
    )
    movable = Decimal("1100000.00") + Decimal("350000.00") + Decimal("45000.00")
    per_head = movable / Decimal("450000")
    expected = _money_q(per_head * 210000)
    assert preview["cost_basis"] == "per_head"
    assert Decimal(preview["transfer_cost_per_head"]) == _money_q(per_head)
    assert Decimal(preview["lines"][0]["cost_amount"]) == expected
    assert expected > Decimal("462000.00")  # fry-only floor: 210k × 2.20
