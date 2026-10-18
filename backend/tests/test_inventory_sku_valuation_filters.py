"""Inventory SKU valuation report — category and item filters."""

from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.django_db


def test_inventory_sku_valuation_category_filter(api_client, company_tenant_with_gl, auth_admin_headers):
    from api.models import Item

    cid = company_tenant_with_gl.id
    Item.objects.create(
        company_id=cid,
        name="Fuel SKU",
        item_type="inventory",
        category="Fuel",
        cost=10,
        unit_price=12,
        quantity_on_hand=5,
        is_active=True,
    )
    Item.objects.create(
        company_id=cid,
        name="Shop SKU",
        item_type="inventory",
        category="General",
        cost=20,
        unit_price=25,
        quantity_on_hand=3,
        is_active=True,
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.get(
        "/api/reports/inventory-sku-valuation/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31", "category": "Fuel"},
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content)
    names = [row["name"] for row in body.get("rows") or []]
    assert names == ["Fuel SKU"]
    assert body.get("filters", {}).get("category") == "Fuel"


def test_live_valuation_reconciles_to_current_gl_not_historical_sales_period(
    company_tenant_with_gl, monkeypatch,
):
    from datetime import date
    from decimal import Decimal
    from api.models import ChartOfAccount, Item, JournalEntry, JournalEntryLine
    from api.services import reporting

    cid = company_tenant_with_gl.id
    monkeypatch.setattr(reporting.timezone, "localdate", lambda: date(2026, 3, 1))
    Item.objects.create(
        company_id=cid, name="Current warehouse stock", item_type="inventory",
        pos_category="shop", cost=Decimal("10"), quantity_on_hand=Decimal("20"),
    )
    inventory = ChartOfAccount.objects.get(company_id=cid, account_code="1200")
    payable = ChartOfAccount.objects.get(company_id=cid, account_code="2000")
    for month in (1, 2):
        journal = JournalEntry.objects.create(
            company_id=cid, entry_number=f"LIVE-VAL-{month}",
            entry_date=date(2026, month, 10), is_posted=True,
        )
        JournalEntryLine.objects.create(journal_entry=journal, account=inventory, debit=100, credit=0)
        JournalEntryLine.objects.create(journal_entry=journal, account=payable, debit=0, credit=100)

    result = reporting.report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert result["summary"]["total_cost_value"] == "200.00"
    assert result["gl_reconciliation"]["as_of_date"] == "2026-03-01"
    assert result["gl_reconciliation"]["gl_stock_inventory"] == "200.00"
    assert result["gl_reconciliation"]["difference"] == "0.00"
