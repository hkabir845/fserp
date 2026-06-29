"""Inter-pond fish transfer posts Dr/Cr 1581 between pond tags (AUTO-AQ-FISH-XFER-{id})."""
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
    ChartOfAccount,
    Company,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from tests.conftest import seed_min_gl_accounts

pytestmark = pytest.mark.django_db


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

    result = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
    assert result["posted"] is True
    assert result["total_gl_amount"] == "273000.00"

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}")
    assert je.is_posted is True

    cr_src = JournalEntryLine.objects.filter(
        journal_entry=je,
        account__account_code="1581",
        aquaculture_pond_id=src.id,
        credit__gt=0,
    ).aggregate(t=Sum("credit"))["t"]
    dr_dst = JournalEntryLine.objects.filter(
        journal_entry=je,
        account__account_code="1581",
        aquaculture_pond_id=dst.id,
        debit__gt=0,
    ).aggregate(t=Sum("debit"))["t"]
    assert cr_src == Decimal("273000.00")
    assert dr_dst == Decimal("273000.00")


@pytest.mark.django_db
def test_fish_transfer_api_posts_gl(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Nursing API", pond_role="nursing", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow API", pond_role="grow_out", is_active=True)
    _seed_source_1581(cid, src.id, "400000.00")
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=50000,
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
                        "fish_count": 50000,
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
    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tid}", is_posted=True
    ).exists()
