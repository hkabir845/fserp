"""Selling goods on an invoice must move the goods, not just the ledger.

`post_invoice_cogs_journal` credits the inventory asset for any costed inventory line. Only the
POS path decremented stock, so an invoice raised anywhere else relieved the ledger and left the
quantity on the shelf: the control account drifted credit and the same units could be sold
again. See A0-1 in `docs/ACCOUNTING_AUDIT_BACKLOG.md`.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def _acc(company_id, code, name, typ, sub=""):
    from api.models import ChartOfAccount

    return ChartOfAccount.objects.get_or_create(
        company_id=company_id,
        account_code=code,
        defaults={
            "account_name": name,
            "account_type": typ,
            "account_sub_type": sub,
            "is_active": True,
        },
    )[0]


def _books(company_tenant):
    """A site, a costed shop SKU with 10 on hand, and a credit customer."""
    from api.models import Customer, Item, Station
    from api.services.station_stock import set_station_stock

    cid = company_tenant.id
    for code, name, typ, sub in [
        ("1010", "Cash", "asset", "cash_on_hand"),
        ("1100", "Accounts Receivable", "asset", "accounts_receivable"),
        ("1220", "Inventory — Shop", "asset", "inventory"),
        ("4200", "Shop Sales", "income", "sales_of_product_income"),
        ("5120", "Cost of Goods Sold", "cost_of_goods_sold", "cost_of_goods_sold"),
    ]:
        _acc(cid, code, name, typ, sub)

    site = Station.objects.create(company_id=cid, station_name="Relief Site", is_active=True)
    item = Item.objects.create(
        company_id=cid,
        name="Engine Oil 1L",
        unit="pcs",
        unit_price=Decimal("300"),
        cost=Decimal("200"),
    )
    set_station_stock(cid, site.id, item.id, Decimal("10"))
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-REL", display_name="House Account", is_active=True
    )
    return cid, site, item, cust


def _invoice(cid, site, item, cust, qty="3", status="sent", number="INV-REL-1"):
    from api.models import Invoice, InvoiceLine

    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=site,
        invoice_number=number,
        invoice_date=date(2026, 5, 1),
        status=status,
        subtotal=Decimal(qty) * Decimal("300"),
        total=Decimal(qty) * Decimal("300"),
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        description=item.name,
        quantity=Decimal(qty),
        unit_price=Decimal("300"),
        amount=Decimal(qty) * Decimal("300"),
    )
    return inv


def test_posting_an_invoice_relieves_stock_not_just_the_ledger(company_tenant):
    from api.models import JournalEntry
    from api.services.gl_posting import sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust, qty="3")

    sync_invoice_gl(cid, inv)

    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).exists(), "the ledger relieved inventory..."
    assert get_station_stock(cid, site.id, item.id) == Decimal("7"), (
        "...so the goods must have left the shelf too"
    )
    inv.refresh_from_db()
    assert inv.stock_relieved is True


def test_relief_happens_exactly_once_however_often_posting_is_synced(company_tenant):
    from api.services.gl_posting import sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust, qty="3")

    sync_invoice_gl(cid, inv)
    sync_invoice_gl(cid, inv)
    sync_invoice_gl(cid, inv)

    assert get_station_stock(cid, site.id, item.id) == Decimal("7")


def test_selling_more_than_is_on_hand_is_refused(api_client, auth_super_headers, company_tenant):
    from api.models import Invoice
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        "/api/invoices/",
        data={
            "customer_id": cust.id,
            "station_id": site.id,
            "status": "sent",
            "lines": [
                {"item_id": item.id, "quantity": "25", "unit_price": "300", "amount": "7500"}
            ],
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "Not enough stock" in r.content.decode()
    # The whole request rolls back: no orphan invoice, no stock moved.
    assert not Invoice.objects.filter(company_id=cid).exists()
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


def test_voiding_the_invoice_puts_the_stock_back(company_tenant):
    from api.services.gl_posting import rollback_invoice_posting_effects, sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust, qty="3")
    sync_invoice_gl(cid, inv)
    assert get_station_stock(cid, site.id, item.id) == Decimal("7")

    ok, err = rollback_invoice_posting_effects(cid, inv)
    assert ok, err
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")
    inv.refresh_from_db()
    assert inv.stock_relieved is False


def test_a_draft_invoice_does_not_move_stock(company_tenant):
    from api.services.gl_posting import sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust, qty="3", status="draft")
    sync_invoice_gl(cid, inv)
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


def test_an_item_with_no_cost_basis_is_left_alone(company_tenant):
    """Its COGS is estimated from the selling price, so enforcing stock would block sales
    without making any number truer. Tracked as A0-5."""
    from api.models import Item
    from api.services.gl_posting import sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, _item, cust = _books(company_tenant)
    uncosted = Item.objects.create(
        company_id=cid, name="Uncosted SKU", unit="pcs", unit_price=Decimal("50"), cost=Decimal("0")
    )
    inv = _invoice(cid, site, uncosted, cust, qty="4", number="INV-REL-NOCOST")
    sync_invoice_gl(cid, inv)
    assert get_station_stock(cid, site.id, uncosted.id) == Decimal("0")
