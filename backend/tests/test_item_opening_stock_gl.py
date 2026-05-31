"""Opening inventory G/L: capitalize on-hand stock (Dr inventory / Cr 3200 Opening Balance Equity)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import ChartOfAccount, Item, JournalEntry, JournalEntryLine
from api.services.item_opening_stock_gl import post_item_opening_stock_gl
from api.services.reporting import report_balance_sheet

pytestmark = pytest.mark.django_db


def _make_item(company_id, **kw):
    defaults = dict(
        company_id=company_id,
        name="Opening Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("0"),
        unit_price=Decimal("0"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )
    defaults.update(kw)
    return Item.objects.create(**defaults)


def _lines(company_id, item_id):
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__entry_number=f"AUTO-ITEM-OB-{item_id}",
    ).select_related("account")


def test_opening_posts_inventory_debit_and_equity_credit(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    inv_acc = ChartOfAccount.objects.get(company_id=cid, account_code="1220")
    item = _make_item(
        cid,
        cost=Decimal("5"),
        quantity_on_hand=Decimal("10"),
        opening_stock_quantity=Decimal("10"),
        opening_stock_unit_cost=Decimal("5"),
        opening_balance_date=date(2026, 1, 1),
        inventory_account=inv_acc,
    )
    assert post_item_opening_stock_gl(cid, item) is True

    lines = list(_lines(cid, item.id))
    assert len(lines) == 2
    by_code = {ln.account.account_code: ln for ln in lines}
    assert by_code["1220"].debit == Decimal("50.00")
    assert by_code["1220"].credit == Decimal("0")
    assert by_code["3200"].credit == Decimal("50.00")
    assert by_code["3200"].debit == Decimal("0")

    bs = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert Decimal(str(bs["assets"]["total"])) == Decimal("50.00")
    assert Decimal(str(bs["equity"]["total"])) == Decimal("50.00")
    assert bs["is_balanced"] is True


def test_opening_idempotent(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _make_item(
        cid,
        cost=Decimal("3"),
        quantity_on_hand=Decimal("4"),
        opening_stock_quantity=Decimal("4"),
        opening_stock_unit_cost=Decimal("3"),
        opening_balance_date=date(2026, 1, 1),
    )
    assert post_item_opening_stock_gl(cid, item) is True
    assert post_item_opening_stock_gl(cid, item) is True
    assert (
        JournalEntry.objects.filter(
            company_id=cid, entry_number=f"AUTO-ITEM-OB-{item.id}"
        ).count()
        == 1
    )


def test_opening_zero_when_no_cost(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _make_item(
        cid,
        cost=Decimal("0"),
        quantity_on_hand=Decimal("10"),
        opening_stock_quantity=Decimal("10"),
        opening_stock_unit_cost=Decimal("0"),
        opening_balance_date=date(2026, 1, 1),
    )
    assert post_item_opening_stock_gl(cid, item) is True
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{item.id}"
    ).exists()


def test_opening_skips_fish_biological(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _make_item(
        cid,
        name="Tilapia fingerling",
        pos_category="fish",
        cost=Decimal("2"),
        quantity_on_hand=Decimal("100"),
        opening_stock_quantity=Decimal("100"),
        opening_stock_unit_cost=Decimal("2"),
        opening_balance_date=date(2026, 1, 1),
    )
    assert post_item_opening_stock_gl(cid, item) is True
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{item.id}"
    ).exists()


def test_opening_repost_after_change(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = _make_item(
        cid,
        cost=Decimal("5"),
        quantity_on_hand=Decimal("10"),
        opening_stock_quantity=Decimal("10"),
        opening_stock_unit_cost=Decimal("5"),
        opening_balance_date=date(2026, 1, 1),
    )
    assert post_item_opening_stock_gl(cid, item) is True
    item.opening_stock_unit_cost = Decimal("8")
    assert post_item_opening_stock_gl(cid, item, force_repost=True) is True

    lines = list(_lines(cid, item.id))
    by_code = {ln.account.account_code: ln for ln in lines}
    assert by_code["1220"].debit == Decimal("80.00")
    assert by_code["3200"].credit == Decimal("80.00")


def test_backfill_command_posts_existing(company_tenant_with_gl):
    from io import StringIO

    from django.core.management import call_command

    cid = company_tenant_with_gl.id
    a = _make_item(cid, name="Stocked A", cost=Decimal("2"), quantity_on_hand=Decimal("5"))
    b = _make_item(cid, name="No cost B", cost=Decimal("0"), quantity_on_hand=Decimal("9"))

    out = StringIO()
    call_command(
        "backfill_item_opening_stock_gl",
        "--company-id",
        str(cid),
        "--as-of",
        "2026-01-01",
        stdout=out,
    )
    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{a.id}"
    ).exists()
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{b.id}"
    ).exists()
