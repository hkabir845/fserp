"""Delete/edit rollback: invoices, bills, aquaculture expenses and fish sales."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFishSale,
    AquaculturePond,
    Bill,
    Company,
    Invoice,
    JournalEntry,
    Vendor,
)

from tests.conftest import seed_min_gl_accounts


def _enable_aq(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _ensure_test_vendor(company_id: int) -> Vendor:
    vendor = Vendor.objects.filter(company_id=company_id, is_active=True).first()
    if vendor is not None:
        return vendor
    return Vendor.objects.create(
        company_id=company_id,
        company_name="Test Vendor",
        display_name="Test Vendor",
        vendor_number="V-LIFECYCLE",
        is_active=True,
    )


@pytest.mark.django_db
def test_bill_put_material_change_recreates_auto_journal(api_client, company_tenant, auth_admin_headers):
    seed_min_gl_accounts(company_tenant)
    vendor_id = _ensure_test_vendor(company_tenant.id).id
    coa = json.loads(api_client.get("/api/chart-of-accounts/", **auth_admin_headers).content.decode())
    exp = next((a for a in coa if (a.get("account_type") or "").lower() == "expense"), None)
    assert exp

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-10",
                "status": "open",
                "lines": [
                    {
                        "description": "Utilities",
                        "quantity": 1,
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "expense_account_id": exp["id"],
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    bill_id = json.loads(r.content.decode())["id"]
    je1 = JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill_id}").first()
    assert je1 is not None

    r2 = api_client.put(
        f"/api/bills/{bill_id}/",
        data=json.dumps(
            {
                "lines": [
                    {
                        "description": "Utilities revised",
                        "quantity": 1,
                        "unit_cost": "150.00",
                        "amount": "150.00",
                        "expense_account_id": exp["id"],
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    je2 = JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill_id}").first()
    assert je2 is not None
    assert je2.id != je1.id


@pytest.mark.django_db
def test_cleanup_fish_sale_deletes_linked_invoice(company_tenant):
    from api.models import Customer, Station
    from api.services.aquaculture_sale_cleanup import cleanup_aquaculture_fish_sale_effects
    from api.services.gl_posting import post_invoice_sale_journal

    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-sale-del", is_active=True)
    st = Station.objects.filter(company_id=cid, is_active=True).first()
    if not st:
        st = Station.objects.create(company_id=cid, station_name="Main", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="Walk-in", customer_number="WALK-IN", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-AQ-TEST-1",
        invoice_date=date(2026, 5, 12),
        status="paid",
        subtotal=Decimal("100"),
        total=Decimal("100"),
        payment_method="cash",
    )
    post_invoice_sale_journal(cid, inv, payment_method="cash")
    sale = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        income_type="fish_harvest_sale",
        sale_date=date(2026, 5, 12),
        weight_kg=Decimal("10"),
        fish_count=100,
        total_amount=Decimal("100.00"),
        invoice=inv,
    )
    inv_id = inv.id
    ok, err = cleanup_aquaculture_fish_sale_effects(cid, sale)
    assert ok, err
    assert not Invoice.objects.filter(pk=inv_id).exists()
    assert not JournalEntry.objects.filter(entry_number=f"AUTO-INV-{inv_id}-SALE").exists()


@pytest.mark.django_db
def test_create_fish_harvest_sale_via_api_syncs_biomass_sample(
    api_client, company_tenant, auth_admin_headers
):
    """POST harvest sale must not 500 — biomass sync calls apply_aquaculture_biomass_sample_extrapolation."""
    _enable_aq(company_tenant)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Sale-API", is_active=True)
    from api.models import AquacultureFishStockLedger

    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        entry_date=date(2026, 5, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=12000,
        weight_kg_delta=Decimal("4000"),
        memo="Opening stock for harvest API test",
    )
    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "income_type": "fish_harvest_sale",
                "fish_species": "tilapia",
                "sale_date": "2026-05-19",
                "weight_kg": "4000",
                "fish_count": 12000,
                "total_amount": "640000.00",
                "buyer_name": "Rajon",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    sale_id = json.loads(r.content.decode())["id"]
    assert AquacultureBiomassSample.objects.filter(source_fish_sale_id=sale_id).exists()


@pytest.mark.django_db
def test_put_expense_with_inventory_reposts_journal(company_tenant):
    """Unit-level: cleanup + sync replaces AUTO-AQ-POND journal after expense_date change."""
    from api.models import Item
    from api.services.aquaculture_expense_cleanup import (
        aquaculture_expense_has_posting_effects,
        cleanup_aquaculture_expense_posting_effects,
        sync_aquaculture_expense_posting_effects,
    )
    from api.services.aquaculture_pond_stock_service import consume_pond_warehouse_stock

    from api.models import ChartOfAccount

    _enable_aq(company_tenant)
    cid = company_tenant.id
    seed_min_gl_accounts(company_tenant)
    inv_acc = ChartOfAccount.objects.filter(
        company_id=cid, account_type="asset", is_active=True
    ).first()
    cogs_acc = ChartOfAccount.objects.filter(
        company_id=cid, account_type="cost_of_goods_sold", is_active=True
    ).first()
    assert inv_acc is not None and cogs_acc is not None
    pond = AquaculturePond.objects.create(company_id=cid, name="P-inv", is_active=True)
    item = Item.objects.create(
        company_id=cid,
        name="Feed pellet",
        item_number="FEED-UT",
        unit="kg",
        item_type="inventory",
        quantity_on_hand=Decimal("100"),
        cost=Decimal("50"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
    )
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    add_pond_stock(cid, pond.id, item.id, Decimal("20"))
    exp = consume_pond_warehouse_stock(
        company_id=cid,
        pond=pond,
        production_cycle_id=None,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 5),
        item=item,
        quantity=Decimal("2"),
        memo="feed use",
    )
    assert aquaculture_expense_has_posting_effects(cid, exp.id)
    je1 = JournalEntry.objects.get(entry_number=f"AUTO-AQ-POND-{exp.id}-COGS")

    exp.expense_date = date(2026, 5, 6)
    exp.save(update_fields=["expense_date", "updated_at"])
    cleanup_aquaculture_expense_posting_effects(cid, exp.id)
    sync_aquaculture_expense_posting_effects(cid, exp.id)
    assert not JournalEntry.objects.filter(pk=je1.pk).exists()
    je2 = JournalEntry.objects.filter(entry_number=f"AUTO-AQ-POND-{exp.id}-COGS").first()
    assert je2 is not None
    assert je2.entry_date == date(2026, 5, 6)
