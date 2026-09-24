"""P0 integrity: GL fail-closed, IPT P&L elimination, CPK denom, bio-relief skip."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.exceptions import GlPostingError
from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    ChartOfAccount,
    Company,
    Customer,
    Invoice,
)
from api.services.aquaculture_cost_per_kg import harvest_weight_denominator_kg
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_sale_bio_relief_service import sync_aquaculture_fish_sale_bio_relief
from api.services.gl_posting import _create_posted_entry


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_create_posted_entry_raises_on_unbalanced(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    cash = ChartOfAccount.objects.filter(company_id=cid, account_code="1010").first()
    assert cash is not None
    with pytest.raises(GlPostingError, match="unbalanced"):
        _create_posted_entry(
            cid,
            date(2026, 7, 1),
            "TEST-UNBALANCED-P0",
            "should fail closed",
            [(cash, Decimal("100.00"), Decimal("0"), "Dr only")],
        )
    assert not ChartOfAccount.objects.filter(
        # sanity: no journal created
    ).filter(pk=-1).exists()
    from api.models import JournalEntry

    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number="TEST-UNBALANCED-P0"
    ).exists()


@pytest.mark.django_db
def test_harvest_weight_denominator_excludes_mirrored_transfer_sales(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="CPK Pond", is_active=True)
    other = AquaculturePond.objects.create(company_id=cid, name="Buyer Pond", is_active=True)
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=pond,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=other,
        weight_kg=Decimal("500"),
        fish_count=1000,
        sale_amount=Decimal("50000"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 6, 10),
        income_type="fish_harvest_sale",
        weight_kg=Decimal("100"),
        total_amount=Decimal("20000"),
        fish_count=200,
        fish_species="tilapia",
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 6, 11),
        income_type="fish_harvest_sale",
        weight_kg=Decimal("500"),
        total_amount=Decimal("50000"),
        fish_count=1000,
        fish_species="tilapia",
        source_fish_pond_transfer_line=line,
    )
    harvest_kg, _bio, basis = harvest_weight_denominator_kg(
        company_id=cid,
        pond_id=pond.id,
        start=date(2026, 6, 1),
        end=date(2026, 6, 30),
        cycle_filter_id=None,
    )
    assert basis == "harvest_sale"
    assert harvest_kg == Decimal("100.0000")


@pytest.mark.django_db
def test_company_pl_eliminates_ipt_invoiced_mirror_and_buyer_transfer_in(
    company_tenant_with_gl,
):
    _enable(company_tenant_with_gl)
    cid = company_tenant_with_gl.id
    seller = AquaculturePond.objects.create(
        company_id=cid, name="Seller Grow", pond_role="grow_out", is_active=True
    )
    buyer = AquaculturePond.objects.create(
        company_id=cid, name="Buyer Grow", pond_role="grow_out", is_active=True
    )
    cust = Customer.objects.create(
        company_id=cid,
        display_name="Buyer Pond Party",
        customer_number="C-IPT-BUYER",
        is_internal=True,
        internal_pond=buyer,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="IPT-TEST-1",
        invoice_date=date(2026, 6, 15),
        due_date=date(2026, 6, 15),
        status="sent",
        subtotal=Decimal("10000"),
        total=Decimal("10000"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=seller,
        transfer_date=date(2026, 6, 15),
        fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=buyer,
        weight_kg=Decimal("50"),
        fish_count=100,
        sale_amount=Decimal("10000"),
        cost_amount=Decimal("8000"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=seller,
        sale_date=date(2026, 6, 15),
        income_type="fish_harvest_sale",
        weight_kg=Decimal("50"),
        total_amount=Decimal("10000"),
        fish_count=100,
        fish_species="tilapia",
        invoice=inv,
        source_fish_pond_transfer_line=line,
    )
    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 6, 1),
        date(2026, 6, 30),
        None,
        None,
        None,
        include_cycle_breakdown=False,
    )
    income_cats = {c["category"]: Decimal(c["amount"]) for c in payload["income_by_category"]}
    expense_cats = {c["category"]: Decimal(c["amount"]) for c in payload["expenses_by_category"]}
    assert income_cats.get("fish_harvest_sale", Decimal("0")) == Decimal("0.00")
    assert expense_cats.get("fish_transfer_cost_in", Decimal("0")) == Decimal("0.00")
    gt = payload["pl_grand_totals"]
    assert Decimal(gt["net_profit"]) == Decimal(gt["total_income"]) - Decimal(
        gt["total_costs_and_expenses"]
    )
    seller_row = next(p for p in payload["ponds"] if p["pond_id"] == seller.id)
    assert Decimal(seller_row["income_total"]) == Decimal("10000.00")


@pytest.mark.django_db
def test_bio_relief_skips_ipt_mirrored_sale(company_tenant_with_gl):
    _enable(company_tenant_with_gl)
    cid = company_tenant_with_gl.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Relief Pond", is_active=True)
    other = AquaculturePond.objects.create(company_id=cid, name="Other Pond", is_active=True)
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
    out = sync_aquaculture_fish_sale_bio_relief(cid, sale)
    assert out["posted"] is False
    assert "AUTO-IPT" in (out.get("basis_note") or "")


@pytest.mark.django_db
def test_biological_sale_requires_production_cycle(api_client, company_tenant, auth_admin_headers):
    import json

    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Cycle Pond", is_active=True)
    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sale_date": "2026-06-01",
                "income_type": "fish_harvest_sale",
                "weight_kg": "10",
                "total_amount": "1000",
                "fish_count": 20,
                "fish_species": "tilapia",
            }
        ),
        content_type="application/json",
        HTTP_X_COMPANY_ID=str(cid),
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "production_cycle" in json.loads(r.content).get("detail", "").lower()
