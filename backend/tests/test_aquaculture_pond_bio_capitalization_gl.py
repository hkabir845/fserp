"""Pond-tagged vendor bills and transfer reclass align GL 1581 with management bio-asset cost."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquaculturePond,
    ChartOfAccount,
    Company,
    JournalEntry,
    JournalEntryLine,
    Vendor,
)
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl

from tests.test_aquaculture_fish_bioasset_gl import (
    _enable_aquaculture_with_coa,
    _fish_item,
    _post_open_fish_bill,
    _vendor,
)

pytestmark = pytest.mark.django_db


def _enable_capitalize(company):
    _enable_aquaculture_with_coa(company)
    Company.objects.filter(pk=company.id).update(
        aquaculture_capitalize_pond_consumption_to_bioasset=True
    )


@pytest.mark.django_db
def test_nursing_pond_expense_mode_fry_bill_posts_to_1581(
    api_client, company_tenant, auth_admin_headers
):
    """Expense-line fry stocking on a nursing pond must post Dr 1581 like item-mode fry bills."""
    _enable_capitalize(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Fry Expense", pond_role="nursing", is_active=True
    )
    vendor = Vendor.objects.filter(company_id=cid).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=cid,
            company_name="CP Bangladesh",
            display_name="CP Bangladesh",
            vendor_number="V-FRY-EXP",
            is_active=True,
        )
    coa1581 = ChartOfAccount.objects.get(company_id=cid, account_code="1581")
    h = auth_admin_headers
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2025-04-23",
                "status": "open",
                "lines": [
                    {
                        "description": "Tilapia Fry",
                        "quantity": "166.67",
                        "unit_cost": "6600",
                        "amount": "1100000.33",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "fry_stocking",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content.decode())
    line = body["lines"][0]
    assert line["aquaculture_cost_bucket"] == "fry_stocking"
    assert line["expense_account_id"] == coa1581.id

    bill_id = body["id"]
    bio_line = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        account__account_code="1581",
        aquaculture_pond_id=pond.id,
        debit__gt=0,
    ).first()
    assert bio_line is not None
    assert bio_line.debit == Decimal("1100000.33")
    assert bio_line.aquaculture_cost_bucket == "fry_stocking"
    assert not JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        account__account_code="6715",
        debit__gt=0,
    ).exists()


@pytest.mark.django_db
def test_pond_feed_bill_capitalizes_to_1581(api_client, company_tenant, auth_admin_headers):
    _enable_capitalize(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Feed Pond", is_active=True)
    inv_acc = ChartOfAccount.objects.filter(
        company_id=cid, account_type="asset", is_active=True
    ).exclude(account_code="1581").first()
    assert inv_acc is not None

    from api.models import Item

    feed = Item.objects.create(
        company_id=cid,
        name="Grower Feed",
        item_type="inventory",
        pos_category="feed",
        unit="kg",
        quantity_on_hand=Decimal("0"),
        cost=Decimal("80"),
        inventory_account=inv_acc,
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Feed Vendor Cap")
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-06-01",
                "subtotal": "10000.00",
                "tax_total": "0",
                "total": "10000.00",
                "status": "open",
                "lines": [
                    {
                        "description": "Feed to pond",
                        "item_id": feed.id,
                        "quantity": "125",
                        "unit_cost": "80",
                        "amount": "10000.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_cost_bucket": "feed",
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    bio_line = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code="1581",
        aquaculture_pond_id=pond.id,
        debit__gt=0,
    ).first()
    assert bio_line is not None
    assert bio_line.debit == Decimal("10000.00")
    assert not JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account=inv_acc,
        debit__gt=0,
    ).exists()


@pytest.mark.django_db
def test_transfer_reclass_posts_full_gl_when_1581_short(api_client, company_tenant, auth_admin_headers):
    _enable_capitalize(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Nursing Reclass", pond_role="nursing", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow Reclass", pond_role="grow_out", is_active=True)
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Reclass")
    fry = _fish_item(cid, name="Fry Reclass")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, src.id, amount="100000.00")

    feed_exp = ChartOfAccount.objects.get(company_id=cid, account_code="6716")
    equity = ChartOfAccount.objects.filter(company_id=cid, account_type="equity").first()
    assert equity is not None
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_date=date(2026, 3, 15),
        entry_number="TEST-FEED-EXP",
        description="feed expense on pond",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=feed_exp,
        debit=Decimal("200000.00"),
        credit=Decimal("0"),
        aquaculture_pond_id=src.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=equity,
        debit=Decimal("0"),
        credit=Decimal("200000.00"),
    )

    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 4, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("100.0000"),
        fish_count=100000,
        cost_amount=Decimal("250000.00"),
    )

    result = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
    assert result["posted"] is True
    assert result["total_gl_amount"] == "250000.00"
    assert result["gl_capped"] is False
    assert Decimal(result["gl_reclass_amount"]) == Decimal("150000.00")

    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}-RECLASS", is_posted=True
    ).exists()

    xfer_cr = JournalEntryLine.objects.filter(
        journal_entry__entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}",
        account__account_code="1581",
        aquaculture_pond_id=src.id,
        credit__gt=0,
    ).aggregate(t=Sum("credit"))["t"]
    assert xfer_cr == Decimal("250000.00")
