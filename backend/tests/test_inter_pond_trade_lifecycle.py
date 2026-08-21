"""
An inter-pond fish sale must leave the ledger clean when it is edited or deleted.

Editing a transfer deletes its lines and recreates them with new ids, so journals keyed on the
old line ids would be stranded — posted money with no document behind it, counted twice against
the pond. Deleting a transfer has the same hazard. Both are covered here.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.db.models import Sum

from api.models import (
    AquacultureExpense,
    AquacultureFishStockLedger,
    AquaculturePond,
    ChartOfAccount,
    Company,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
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


def _seed_stock(cid, pond, heads=20000, kg="400"):
    AquacultureFishStockLedger.objects.create(
        company_id=cid, pond=pond, entry_date=date(2026, 4, 1), entry_kind="adjustment",
        fish_species="tilapia", fish_count_delta=heads, weight_kg_delta=Decimal(kg),
        memo="opening",
    )


def _seed_cost(cid, pond, amount="30000.00"):
    AquacultureExpense.objects.create(
        company_id=cid, pond=pond, expense_date=date(2026, 4, 1),
        expense_category="fry_stocking", amount=Decimal(amount),
    )


def _ipt_journals(cid):
    return sorted(
        JournalEntry.objects.filter(
            company_id=cid, entry_number__startswith="AUTO-IPT-"
        ).values_list("entry_number", flat=True)
    )


def _pond_bio(cid, pond_id) -> Decimal:
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code="1581",
        aquaculture_pond_id=pond_id,
    ).aggregate(d=Sum("debit"), c=Sum("credit"))
    return (agg["d"] or Decimal("0")) - (agg["c"] or Decimal("0"))


def _interpond_current_nets_to_zero(cid) -> bool:
    coa = ChartOfAccount.objects.filter(company_id=cid, account_code="1595").first()
    if not coa:
        return True
    agg = JournalEntryLine.objects.filter(
        account_id=coa.id, journal_entry__is_posted=True
    ).aggregate(d=Sum("debit"), c=Sum("credit"))
    return (agg["d"] or Decimal("0")) == (agg["c"] or Decimal("0"))


def _make_ponds(cid):
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing LC", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(
        company_id=cid, name="Grow LC", pond_role="grow_out", is_active=True
    )
    _seed_stock(cid, src)
    _seed_cost(cid, src)
    return src, dst


def _post_transfer(api_client, h, src, dst, kg="100", heads=5000):
    return api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-10",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": dst.id, "weight_kg": kg, "fish_count": heads}],
            }
        ),
        content_type="application/json",
        **h,
    )


def test_editing_a_trade_replaces_its_journals_instead_of_stacking_them(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, dst = _make_ponds(cid)

    r = _post_transfer(api_client, h, src, dst, kg="100", heads=5000)
    assert r.status_code == 201, r.content.decode()
    tid = json.loads(r.content)["transfer"]["id"]
    after_create = _ipt_journals(cid)
    assert len(after_create) == 2, after_create

    r2 = api_client.put(
        f"/api/aquaculture/fish-pond-transfers/{tid}/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-10",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": dst.id, "weight_kg": "50", "fish_count": 2500}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 200, r2.content.decode()

    after_edit = _ipt_journals(cid)
    assert len(after_edit) == 2, (
        "editing the trade must replace its journals, not leave the originals behind: %s"
        % after_edit
    )
    assert _interpond_current_nets_to_zero(cid), "1595 must still net to zero after an edit"

    # Halving the weight must halve what the buying pond carries, not add to it.
    line = json.loads(r2.content)["transfer"]["lines"][0]
    assert _pond_bio(cid, dst.id) == Decimal(line["sale_amount"])


def test_deleting_a_trade_removes_its_journals(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, dst = _make_ponds(cid)

    r = _post_transfer(api_client, h, src, dst)
    assert r.status_code == 201, r.content.decode()
    tid = json.loads(r.content)["transfer"]["id"]
    assert len(_ipt_journals(cid)) == 2

    bio_before = _pond_bio(cid, dst.id)
    assert bio_before > 0

    r2 = api_client.delete(f"/api/aquaculture/fish-pond-transfers/{tid}/", **h)
    assert r2.status_code == 200, r2.content.decode()

    assert _ipt_journals(cid) == [], "deleting the trade must take its journals with it"
    assert _pond_bio(cid, dst.id) == Decimal("0"), "the buying pond must not keep fish it gave back"
    assert _interpond_current_nets_to_zero(cid)


def test_segments_reconcile_to_the_company_through_the_consolidation_bridge(
    api_client, company_tenant, auth_admin_headers
):
    """
    Both ponds book the trade, the company does not, so the segment rows total more than the
    company. The report has to show the arithmetic that closes that gap.
    """
    from api.services.reporting import report_entities_pl_summary

    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, dst = _make_ponds(cid)

    assert _post_transfer(api_client, h, src, dst).status_code == 201

    out = report_entities_pl_summary(cid, date(2026, 1, 1), date(2026, 12, 31))
    bridge = out["consolidation_bridge"]
    assert bridge["reconciles"] is True, bridge
    assert bridge["unexplained_residual"] == 0.0
    assert bridge["internal_trade_removed_on_consolidation"] > 0, (
        "the ponds traded, so consolidation must remove the profit they made on each other"
    )
    assert (
        bridge["segment_net_income"] - bridge["internal_trade_removed_on_consolidation"]
        == pytest.approx(bridge["company_net_income"])
    )
