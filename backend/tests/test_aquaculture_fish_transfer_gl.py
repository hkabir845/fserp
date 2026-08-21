"""
Inter-pond fish movement posts as a sale: the seller's invoice and the buyer's bill
(AUTO-IPT-INV-{transfer}-{line} / AUTO-IPT-BILL-{transfer}-{line}), settling through 1595. The selling pond still
releases 1581 at book cost; the buying pond capitalizes what it paid.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
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
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from tests.conftest import seed_min_gl_accounts

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _allow_legacy_fish_transfers(legacy_fish_transfers_enabled):
    """
    These cover the transfer machinery that historical records and the conversion still run
    through. The endpoint itself is retired for users — see test_fish_transfer_retired.
    """


def _enable(company):
    Company.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    seed_min_gl_accounts(company)
    ensure_aquaculture_chart_accounts(company.id)


def _seed_source_1581(company_id, pond_id, amount="500000.00"):
    bio = ChartOfAccount.objects.get(company_id=company_id, account_code="1581")
    equity = ChartOfAccount.objects.filter(company_id=company_id, account_type="equity").first()
    assert equity is not None
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_date=date(2026, 3, 1),
        entry_number="TEST-1581-OPEN",
        description="test opening bio",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=bio,
        debit=Decimal(amount),
        credit=Decimal("0"),
        aquaculture_pond_id=pond_id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=equity,
        debit=Decimal("0"),
        credit=Decimal(amount),
        aquaculture_pond_id=pond_id,
    )


@pytest.mark.django_db
def test_fish_transfer_posts_1581_between_ponds(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Nursing", pond_role="nursing", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow A", pond_role="grow_out", is_active=True)
    _seed_source_1581(cid, src.id, "500000.00")

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
        cost_amount=Decimal("273000.00"),
    )

    line = tr.lines.get()
    result = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
    assert result["posted"] is True
    assert result["total_gl_amount"] == "273000.00"

    # The superseded single transfer journal is gone; the documents carry the trade.
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}"
    ).exists()
    inv_je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-IPT-INV-{tr.id}-{line.id}")
    bill_je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-IPT-BILL-{tr.id}-{line.id}")
    assert inv_je.is_posted is True and bill_je.is_posted is True

    line.refresh_from_db()
    price = Decimal(str(line.sale_amount))
    assert price > Decimal("273000.00"), "the selling pond earns the inter-pond margin"

    both = [inv_je, bill_je]
    cr_src = JournalEntryLine.objects.filter(
        journal_entry__in=both,
        account__account_code="1581",
        aquaculture_pond_id=src.id,
        credit__gt=0,
    ).aggregate(t=Sum("credit"))["t"]
    dr_dst = JournalEntryLine.objects.filter(
        journal_entry__in=both,
        account__account_code="1581",
        aquaculture_pond_id=dst.id,
        debit__gt=0,
    ).aggregate(t=Sum("debit"))["t"]
    assert cr_src == Decimal("273000.00"), "fish leave the seller at book cost"
    assert dr_dst == price, "fish arrive at the buyer at what it paid"

    # The pair settles between the ponds, never in cash, and nets to nothing company-wide.
    current = JournalEntryLine.objects.filter(
        journal_entry__in=both, account__account_code="1595"
    ).aggregate(d=Sum("debit"), c=Sum("credit"))
    assert current["d"] == price and current["c"] == price


@pytest.mark.django_db
def test_fish_transfer_api_posts_gl(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    # Grow-out source below the 10,000-head fingerling threshold, so the transfer costs on a kg
    # basis and honours the submitted cost_amount. A nursing pond (or any pond holding a
    # fingerling-scale batch) re-derives cost per head from its own batch expense instead, which
    # is nil here and would post no journal - that path is covered by the ORM-level test above.
    src = AquaculturePond.objects.create(company_id=cid, name="Grow Src API", pond_role="grow_out", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow API", pond_role="grow_out", is_active=True)
    _seed_source_1581(cid, src.id, "400000.00")
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=5000,
        weight_kg_delta=Decimal("50"),
        memo="Opening for GL transfer test",
    )

    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-15",
                "fish_species": "tilapia",
                "lines": [
                    {
                        "to_pond_id": dst.id,
                        "weight_kg": "50",
                        "fish_count": 5000,
                        "cost_amount": "150000.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content)
    assert body["transfer"]["gl_posted"] is True
    assert body["gl_sync"]["posted"] is True
    tid = body["transfer"]["id"]
    line_id = AquacultureFishPondTransferLine.objects.get(transfer_id=tid).id
    assert JournalEntry.objects.filter(
        company_id=cid,
        entry_number__in=[f"AUTO-IPT-INV-{tid}-{line_id}", f"AUTO-IPT-BILL-{tid}-{line_id}"],
        is_posted=True,
    ).count() == 2
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tid}"
    ).exists()


def test_fish_transfer_report_wires_invoice_bill_and_gl_journals(
    api_client, company_tenant, auth_admin_headers
):
    """Reports hub must show the internal sale documents, not only biomass cost."""
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Grow Src Rpt", pond_role="grow_out", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow Dst Rpt", pond_role="grow_out", is_active=True
    )
    _seed_source_1581(cid, src.id, "400000.00")
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=5000,
        weight_kg_delta=Decimal("50"),
        memo="Opening for report wiring test",
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-15",
                "fish_species": "tilapia",
                "lines": [
                    {
                        "to_pond_id": dst.id,
                        "weight_kg": "50",
                        "fish_count": 5000,
                        "cost_amount": "150000.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    tid = json.loads(r.content)["transfer"]["id"]
    line = AquacultureFishPondTransferLine.objects.get(transfer_id=tid)

    rpt = api_client.get(
        "/api/reports/aquaculture-fish-transfers/",
        {"start_date": "2026-04-01", "end_date": "2026-04-30"},
        **h,
    )
    assert rpt.status_code == 200, rpt.content.decode()
    payload = json.loads(rpt.content)
    assert payload["report_id"] == "aquaculture-fish-transfers"
    groups = payload.get("groups") or []
    assert len(groups) == 1
    row = groups[0]["lines"][0]
    inv = Invoice.all_objects.get(internal_fish_transfer_line_id=line.id)
    bill = Bill.all_objects.get(internal_fish_transfer_line_id=line.id)
    assert row["invoice_id"] == inv.id
    assert row["invoice_number"] == inv.invoice_number
    assert row["bill_id"] == bill.id
    assert row["bill_number"] == bill.bill_number
    assert row["gl_posted"] is True
    assert row["invoice_journal_number"] == f"AUTO-IPT-INV-{tid}-{line.id}"
    assert row["bill_journal_number"] == f"AUTO-IPT-BILL-{tid}-{line.id}"
    assert Decimal(str(row["sale_amount"])) == Decimal(str(line.sale_amount))
    assert row["accounts"]["interpond_current"] == "1595"
