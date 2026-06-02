"""
Manual aquaculture pond expense auto-posts Dr expense / Cr funding (cash/bank) to the GL.

Covers: the post helper, edit re-sync, delete reversal, the double-count guard (inventory-backed
and shop-issue rows never post here), register-only default (blank funding), the pond costing
dimension, and the feeding-advice create_expense end-to-end path.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFeedingAdvice,
    AquaculturePond,
    ChartOfAccount,
    Company,
    Item,
    JournalEntry,
    JournalEntryLine,
)
from api.services.gl_posting import post_aquaculture_manual_expense_journal

pytestmark = pytest.mark.django_db

ENTRY = "AUTO-AQ-EXP-{}".format


def _enable_aq(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _seed_accounts(cid: int) -> None:
    for code, name, typ in (
        ("6716", "Pond Feed Expense", "expense"),
        ("1010", "Cash on Hand", "asset"),
        ("1030", "Bank Operating", "asset"),
    ):
        ChartOfAccount.objects.get_or_create(
            company_id=cid,
            account_code=code,
            defaults={"account_name": name, "account_type": typ, "is_active": True},
        )


def _pond(cid: int) -> AquaculturePond:
    return AquaculturePond.objects.create(company_id=cid, name="P-gl", is_active=True)


def _expense(cid: int, pond, **kw) -> AquacultureExpense:
    defaults = dict(
        company_id=cid,
        pond=pond,
        expense_category="feed_purchase",
        expense_date=date(2026, 5, 12),
        amount=Decimal("250.00"),
        funding_account_code="1010",
    )
    defaults.update(kw)
    return AquacultureExpense.objects.create(**defaults)


def _entry(cid: int, exp_id: int) -> JournalEntry | None:
    return JournalEntry.objects.filter(company_id=cid, entry_number=ENTRY(exp_id)).first()


def _lines_by_code(je: JournalEntry) -> dict[str, JournalEntryLine]:
    return {
        ln.account.account_code: ln
        for ln in JournalEntryLine.objects.filter(journal_entry=je).select_related("account")
    }


def test_manual_expense_posts_balanced_journal(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid), amount=Decimal("250.00"))

    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    je = _entry(cid, exp.id)
    assert je is not None and je.is_posted
    by_code = _lines_by_code(je)
    assert by_code["6716"].debit == Decimal("250.00")
    assert by_code["6716"].credit == Decimal("0.00")
    assert by_code["1010"].credit == Decimal("250.00")
    assert by_code["1010"].debit == Decimal("0.00")
    # Pond dimension is stamped so the entry shows in pond-scoped GL P&L.
    assert by_code["6716"].aquaculture_pond_id == exp.pond_id
    total_d = sum(ln.debit for ln in by_code.values())
    total_c = sum(ln.credit for ln in by_code.values())
    assert total_d == total_c == Decimal("250.00")


def test_bank_funding_credits_1030(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid), amount=Decimal("80.00"), funding_account_code="1030")

    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True
    by_code = _lines_by_code(_entry(cid, exp.id))
    assert by_code["1030"].credit == Decimal("80.00")
    assert by_code["6716"].debit == Decimal("80.00")


def test_posting_is_idempotent(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid))

    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True
    assert JournalEntry.objects.filter(company_id=cid, entry_number=ENTRY(exp.id)).count() == 1


def test_blank_funding_is_register_only(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid), funding_account_code="")

    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is False
    assert _entry(cid, exp.id) is None


def test_inventory_backed_expense_does_not_double_post(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    pond = _pond(cid)
    item = Item.objects.create(
        company_id=cid, name="Feed", item_type="inventory", unit="kg",
        cost=Decimal("5"), unit_price=Decimal("5"), quantity_on_hand=Decimal("0"), is_active=True,
    )
    exp = _expense(cid, pond, funding_account_code="1010")
    AquacultureExpenseInventoryLine.objects.create(expense=exp, item=item, quantity=Decimal("10"))

    # Inventory consumption posts its own COGS journal; the manual funding journal must not also post.
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is False
    assert _entry(cid, exp.id) is None


def test_shop_issue_expense_does_not_double_post(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    from api.models import Station

    st = Station.objects.create(company_id=cid, station_name="Shop", is_active=True)
    exp = _expense(cid, _pond(cid), funding_account_code="1010", source_station=st)

    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is False
    assert _entry(cid, exp.id) is None


def test_edit_amount_resyncs_journal(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid), amount=Decimal("250.00"))
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    r = api_client.put(
        f"/api/aquaculture/expenses/{exp.id}/",
        data=json.dumps({"amount": "400.00"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    by_code = _lines_by_code(_entry(cid, exp.id))
    assert by_code["6716"].debit == Decimal("400.00")
    assert by_code["1010"].credit == Decimal("400.00")
    assert JournalEntry.objects.filter(company_id=cid, entry_number=ENTRY(exp.id)).count() == 1


def test_edit_turn_off_funding_removes_journal(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid))
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    r = api_client.put(
        f"/api/aquaculture/expenses/{exp.id}/",
        data=json.dumps({"funding_account": "none"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    exp.refresh_from_db()
    assert exp.funding_account_code == ""
    assert _entry(cid, exp.id) is None


def test_delete_reverses_journal(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    exp = _expense(cid, _pond(cid))
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    r = api_client.delete(f"/api/aquaculture/expenses/{exp.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    assert not AquacultureExpense.objects.filter(pk=exp.id).exists()
    assert _entry(cid, exp.id) is None


def test_feeding_advice_create_expense_posts_gl(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    _seed_accounts(cid)
    pond = _pond(cid)
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 14),
        status=AquacultureFeedingAdvice.STATUS_APPROVED,
        ai_advice_text="feed 10kg",
        suggested_feed_kg=Decimal("10.0000"),
    )

    r = api_client.post(
        f"/api/aquaculture/feeding-advice/{advice.id}/apply/",
        data=json.dumps({"create_expense": True, "amount": "300.00"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    created = body.get("created_expense")
    assert created is not None
    assert created["funding_account_code"] == "1010"

    exp_id = created["id"]
    by_code = _lines_by_code(_entry(cid, exp_id))
    assert by_code["6716"].debit == Decimal("300.00")
    assert by_code["1010"].credit == Decimal("300.00")
