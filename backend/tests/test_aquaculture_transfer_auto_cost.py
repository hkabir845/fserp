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
from api.services.aquaculture_transfer_cost import (
    backfill_missing_transfer_line_costs,
    preview_transfer_line_costs,
    resolve_auto_transfer_line_cost,
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
    assert Decimal(line["cost_amount"]) == Decimal("800.00")  # 2000/50 × 20


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
    assert body["cost_basis"] == "per_kg"
    assert Decimal(body["lines"][0]["cost_amount"]) == Decimal("800.00")
    assert body["transfer_cost_per_kg"] is not None


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
