"""Moving weighted-average cost (AVCO): Item.cost updates on receipt and via recompute."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import Bill, BillLine, Item, Vendor
from api.services.gl_posting import apply_weighted_average_cost_on_receipt

pytestmark = pytest.mark.django_db


def _item(company_id, **kw):
    defaults = dict(
        company_id=company_id,
        name="Avg Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("0"),
        unit_price=Decimal("0"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )
    defaults.update(kw)
    return Item.objects.create(**defaults)


def test_avco_blends_old_and_received(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _item(cid, cost=Decimal("10"), quantity_on_hand=Decimal("100"))
    # Receive 100 units worth 1200 (unit 12): (100*10 + 1200) / 200 = 11.
    apply_weighted_average_cost_on_receipt(cid, item.id, Decimal("100"), Decimal("1200"))
    item.refresh_from_db()
    assert item.cost == Decimal("11.0000")


def test_avco_first_receipt_sets_unit_cost(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _item(cid, cost=Decimal("0"), quantity_on_hand=Decimal("0"))
    apply_weighted_average_cost_on_receipt(cid, item.id, Decimal("50"), Decimal("500"))
    item.refresh_from_db()
    assert item.cost == Decimal("10.0000")


def test_avco_skips_fish(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _item(cid, name="Tilapia", pos_category="fish", cost=Decimal("0"), quantity_on_hand=Decimal("0"))
    apply_weighted_average_cost_on_receipt(cid, item.id, Decimal("50"), Decimal("500"))
    item.refresh_from_db()
    assert item.cost == Decimal("0")


def test_recompute_command_from_opening_and_receipts(company_tenant_with_gl):
    from io import StringIO

    from django.core.management import call_command

    cid = company_tenant_with_gl.id
    item = _item(
        cid,
        cost=Decimal("0"),
        quantity_on_hand=Decimal("20"),
        opening_stock_quantity=Decimal("10"),
        opening_stock_unit_cost=Decimal("5"),
    )
    vendor = Vendor.objects.create(company_id=cid, display_name="V", vendor_number="V1", is_active=True)
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="B-AVCO-1",
        bill_date=date(2026, 2, 1),
        status="paid",
        total=Decimal("70"),
        stock_receipt_applied=True,
    )
    BillLine.objects.create(
        bill=bill, item=item, description="recv", quantity=Decimal("10"), unit_price=Decimal("7"), amount=Decimal("70")
    )

    out = StringIO()
    call_command("recompute_item_average_cost", "--company-id", str(cid), stdout=out)
    item.refresh_from_db()
    # (10*5 + 70) / (10 + 10) = 120 / 20 = 6.
    assert item.cost == Decimal("6.0000")
