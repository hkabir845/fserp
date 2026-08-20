"""Inter-pond transfers raise a matched invoice/bill pair as evidence of the internal sale."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFishStockLedger,
    AquaculturePond,
    Bill,
    ChartOfAccount,
    Company,
    Invoice,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_internal_vendor import provision_pond_internal_parties
from api.services.gl_posting import bill_eligible_for_posting


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _headers(base: dict, company_id: int) -> dict:
    return {**base, "HTTP_X_COMPANY_ID": str(company_id)}


def _pond(company_id: int, name: str, role: str) -> AquaculturePond:
    pond = AquaculturePond.objects.create(
        company_id=company_id, name=name, pond_role=role, is_active=True
    )
    provision_pond_internal_parties(company_id=company_id, pond=pond)
    pond.refresh_from_db()
    return pond


def _seed_pond_fish(company_id: int, pond, *, heads: int, kg: str) -> None:
    AquacultureFishStockLedger.objects.create(
        company_id=company_id,
        pond=pond,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=heads,
        weight_kg_delta=Decimal(kg),
        memo="Opening fingerlings for document test",
    )


def _seed_pond_1581_balance(company_id: int, pond, amount: str) -> None:
    bio = ChartOfAccount.objects.filter(
        company_id=company_id, account_code="1581", is_active=True
    ).first()
    equity = ChartOfAccount.objects.filter(
        company_id=company_id, account_type="equity", is_active=True
    ).first()
    assert bio and equity
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_date=date(2026, 4, 2),
        entry_number=f"TEST-BIO-DOC-{pond.id}",
        description="Opening biological cost",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=bio, debit=Decimal(amount), credit=Decimal("0"),
        aquaculture_pond_id=pond.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=equity, debit=Decimal("0"), credit=Decimal(amount)
    )


def _transfer(api_client, headers, *, seller, buyers: list[tuple], transfer_date="2026-05-17"):
    return api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": seller.id,
                "transfer_date": transfer_date,
                "fish_species": "tilapia",
                "lines": [
                    {"to_pond_id": pond.id, "weight_kg": kg, "fish_count": heads}
                    for pond, kg, heads in buyers
                ],
            }
        ),
        content_type="application/json",
        **headers,
    )


@pytest.fixture
def trading_ponds(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    ensure_aquaculture_chart_accounts(cid)
    nursing = _pond(cid, "Nursing Docs", "nursing")
    grow = _pond(cid, "Grow Docs", "grow_out")
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("10000.00"),
    )
    _seed_pond_fish(cid, nursing, heads=20000, kg="400")
    _seed_pond_1581_balance(cid, nursing, "10000.00")
    return cid, nursing, grow


@pytest.mark.django_db
def test_transfer_raises_a_matched_invoice_and_bill(
    api_client, auth_admin_headers, trading_ponds
):
    cid, nursing, grow = trading_ponds
    h = _headers(auth_admin_headers, cid)

    r = _transfer(api_client, h, seller=nursing, buyers=[(grow, "100", 5000)])
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content)
    assert body["internal_trade_documents"]["documents"] == 1
    assert body["internal_trade_documents"]["skipped"] == []

    transfer = body["transfer"]
    sale = Decimal(transfer["lines"][0]["sale_amount"])
    docs = transfer["internal_documents"]
    assert len(docs) == 1
    assert Decimal(docs[0]["amount"]) == sale

    inv = Invoice.all_objects.get(pk=docs[0]["invoice_id"])
    bill = Bill.all_objects.get(pk=docs[0]["bill_id"])
    # Trading identities are provisioned on demand during the transfer.
    grow.refresh_from_db()
    nursing.refresh_from_db()

    # The selling pond invoices the buying pond's customer identity.
    assert inv.customer_id == grow.pos_customer_id
    assert inv.customer.is_internal is True
    assert inv.total == sale
    assert inv.status == "paid", "settled through the inter-pond current account, never ages"
    assert inv.lines.count() == 1
    assert inv.lines.first().item_id is None

    # The buying pond is billed by the selling pond's vendor identity.
    assert bill.vendor_id == nursing.internal_vendor_id
    assert bill.vendor.is_internal is True
    assert bill.total == sale
    assert bill.status == "paid"
    assert bill.stock_receipt_applied is False
    assert bill.vendor_ap_incremented is False
    line = bill.lines.first()
    assert line.item_id is None, "item-less, so it can never touch inventory or COGS"
    assert line.aquaculture_pond_id is None, (
        "untagged, so it never enters the buying pond's expense pool on top of the 1581 "
        "the transfer already capitalized"
    )


@pytest.mark.django_db
def test_internal_documents_never_post_gl_or_receive_stock(
    api_client, auth_admin_headers, trading_ponds
):
    """The transfer journal is the only place this sale hits the books."""
    cid, nursing, grow = trading_ponds
    h = _headers(auth_admin_headers, cid)

    r = _transfer(api_client, h, seller=nursing, buyers=[(grow, "100", 5000)])
    assert r.status_code == 201, r.content.decode()
    docs = json.loads(r.content)["transfer"]["internal_documents"]
    bill = Bill.all_objects.get(pk=docs[0]["bill_id"])
    inv = Invoice.all_objects.get(pk=docs[0]["invoice_id"])

    assert bill_eligible_for_posting(bill) is False
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number__startswith=f"AUTO-BILL-{bill.id}"
    ).exists()
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number__startswith=f"AUTO-INV-{inv.id}"
    ).exists()

    # The vendor's A/P subledger is untouched — nothing is owed outside the company.
    nursing.refresh_from_db()
    assert nursing.internal_vendor.current_balance == Decimal("0")


@pytest.mark.django_db
def test_internal_bill_does_not_double_count_fish_or_sampling(
    api_client, auth_admin_headers, trading_ponds
):
    """Fish arrive once, through the transfer — the paperwork must not add them again."""
    from api.models import AquacultureBiomassSample
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    cid, nursing, grow = trading_ponds
    h = _headers(auth_admin_headers, cid)

    r = _transfer(api_client, h, seller=nursing, buyers=[(grow, "100", 5000)])
    assert r.status_code == 201, r.content.decode()

    rows = compute_fish_stock_position_rows(cid, pond_id=grow.id, production_cycle_id=None)
    assert rows
    assert int(rows[0]["implied_net_fish_count"]) == 5000, "5,000 head arrived once, not twice"

    # One sampling row per pond for this move — the bill adds none of its own.
    assert AquacultureBiomassSample.objects.filter(pond_id=grow.id).count() == 1
    assert AquacultureBiomassSample.objects.filter(source_bill_line__isnull=False).count() == 0


@pytest.mark.django_db
def test_documents_follow_edits_and_vanish_with_the_transfer(
    api_client, auth_admin_headers, trading_ponds
):
    cid, nursing, grow = trading_ponds
    other = _pond(cid, "Grow Docs Two", "grow_out")
    h = _headers(auth_admin_headers, cid)

    r = _transfer(
        api_client, h, seller=nursing, buyers=[(grow, "100", 5000), (other, "50", 2500)]
    )
    assert r.status_code == 201, r.content.decode()
    transfer_id = json.loads(r.content)["transfer"]["id"]
    assert Invoice.all_objects.filter(internal_fish_transfer_line__isnull=False).count() == 2
    assert Bill.all_objects.filter(internal_fish_transfer_line__isnull=False).count() == 2

    upd = api_client.put(
        f"/api/aquaculture/fish-pond-transfers/{transfer_id}/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": grow.id, "weight_kg": "120", "fish_count": 6000}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert upd.status_code == 200, upd.content.decode()
    assert Invoice.all_objects.filter(internal_fish_transfer_line__isnull=False).count() == 1
    assert Bill.all_objects.filter(internal_fish_transfer_line__isnull=False).count() == 1
    new_total = Decimal(json.loads(upd.content)["transfer"]["lines"][0]["sale_amount"])
    assert Invoice.all_objects.filter(internal_fish_transfer_line__isnull=False).first().total == new_total

    dele = api_client.delete(f"/api/aquaculture/fish-pond-transfers/{transfer_id}/", **h)
    assert dele.status_code == 200, dele.content.decode()
    assert not Invoice.all_objects.filter(internal_fish_transfer_line__isnull=False).exists()
    assert not Bill.all_objects.filter(internal_fish_transfer_line__isnull=False).exists()


@pytest.mark.django_db
def test_no_price_means_no_paperwork(api_client, auth_admin_headers, company_tenant):
    """At zero margin and zero cost there is no sale to evidence."""
    _enable(company_tenant)
    cid = company_tenant.id
    ensure_aquaculture_chart_accounts(cid)
    Company.objects.filter(pk=cid).update(aquaculture_internal_transfer_margin_per_kg=Decimal("0"))
    nursing = _pond(cid, "Nursing NoDoc", "nursing")
    grow = _pond(cid, "Grow NoDoc", "grow_out")
    _seed_pond_fish(cid, nursing, heads=10000, kg="200")
    h = _headers(auth_admin_headers, cid)

    r = _transfer(api_client, h, seller=nursing, buyers=[(grow, "100", 5000)])
    assert r.status_code == 201, r.content.decode()
    assert json.loads(r.content)["internal_trade_documents"]["documents"] == 0
    assert not Invoice.all_objects.filter(internal_fish_transfer_line__isnull=False).exists()
    assert not Bill.all_objects.filter(internal_fish_transfer_line__isnull=False).exists()


@pytest.mark.django_db
def test_documents_are_hidden_from_lists_but_reachable(
    api_client, auth_admin_headers, trading_ponds
):
    """Hidden by default so no total counts them; visible on request so they work as evidence."""
    cid, nursing, grow = trading_ponds
    h = _headers(auth_admin_headers, cid)

    r = _transfer(api_client, h, seller=nursing, buyers=[(grow, "100", 5000)])
    assert r.status_code == 201, r.content.decode()
    docs = json.loads(r.content)["transfer"]["internal_documents"][0]

    def _numbers(path: str, params: dict) -> set[str]:
        resp = api_client.get(path, params, **h)
        assert resp.status_code == 200, resp.content.decode()
        payload = json.loads(resp.content)
        rows = payload.get("results") if isinstance(payload, dict) else payload
        key = "bill_number" if "bill" in path else "invoice_number"
        return {row[key] for row in (rows or [])}

    assert docs["bill_number"] not in _numbers("/api/bills/", {})
    assert docs["invoice_number"] not in _numbers("/api/invoices/", {})
    assert docs["bill_number"] in _numbers("/api/bills/", {"internal_trade": "1"})
    assert docs["invoice_number"] in _numbers("/api/invoices/", {"internal_trade": "1"})

    # A link straight to the document opens it.
    one = api_client.get(f"/api/bills/{docs['bill_id']}", follow=True, **h)
    assert one.status_code == 200, one.content.decode()
    assert json.loads(one.content)["bill_number"] == docs["bill_number"]
