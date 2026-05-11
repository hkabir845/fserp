"""Fish stock ledger delete reverses GL when the automatic BIOSTK journal is linked."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    ChartOfAccount,
    Company,
    JournalEntry,
)
from api.services.gl_posting import post_aquaculture_fish_stock_ledger_journal


@pytest.mark.django_db
def test_fish_stock_ledger_delete_removes_matching_auto_journal(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1581",
        account_name="Biological inventory",
        account_type="asset",
        is_active=True,
    )
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="6726",
        account_name="Mortality expense",
        account_type="expense",
        is_active=True,
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Ledger test pond", is_active=True)
    led = AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        entry_date=date(2026, 5, 1),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="tilapia",
        fish_count_delta=-10,
        weight_kg_delta=Decimal("-5"),
        book_value=Decimal("100.00"),
        post_to_books=True,
        memo="seed",
    )
    je = post_aquaculture_fish_stock_ledger_journal(
        company_tenant.id,
        led.id,
        date(2026, 5, 1),
        is_write_down=True,
        book_value=Decimal("100.00"),
        pond_label="Ledger test pond",
        line_memo="loss",
    )
    assert je is not None
    led.journal_entry = je
    led.save(update_fields=["journal_entry"])
    lid = led.id
    en = f"AUTO-AQ-BIOSTK-{lid}"
    assert JournalEntry.objects.filter(company_id=company_tenant.id, entry_number=en).exists()

    r = api_client.delete(f"/api/aquaculture/fish-stock-ledger/{lid}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    assert not AquacultureFishStockLedger.objects.filter(id=lid).exists()
    assert not JournalEntry.objects.filter(company_id=company_tenant.id, entry_number=en).exists()


@pytest.mark.django_db
def test_fish_stock_ledger_delete_rejects_non_auto_journal(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P2", is_active=True)
    je = JournalEntry.objects.create(
        company_id=company_tenant.id,
        entry_number="MANUAL-JE-1",
        entry_date=date(2026, 5, 2),
        description="manual",
        is_posted=True,
    )
    led = AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        entry_date=date(2026, 5, 2),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="tilapia",
        fish_count_delta=-1,
        weight_kg_delta=Decimal("-1"),
        book_value=Decimal("0"),
        post_to_books=False,
        journal_entry=je,
        memo="linked manual",
    )
    lid = led.id
    r = api_client.delete(f"/api/aquaculture/fish-stock-ledger/{lid}/", **auth_admin_headers)
    assert r.status_code == 400
    body = json.loads(r.content.decode())
    assert "not the automatic" in (body.get("detail") or "").lower()
    assert AquacultureFishStockLedger.objects.filter(id=lid).exists()


@pytest.mark.django_db
def test_fish_stock_ledger_get_filters_match_stock_position_scope(
    api_client, company_tenant, auth_admin_headers
):
    """GET list supports pond_id, production_cycle_id, fish_species like fish-stock-position."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Filter pond", is_active=True)
    other = AquaculturePond.objects.create(company_id=company_tenant.id, name="Other pond", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="C2026",
        start_date=date(2026, 1, 1),
    )
    cy_other = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=other,
        name="OtherCy",
        start_date=date(2026, 1, 1),
    )
    h = auth_admin_headers
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        entry_date=date(2026, 5, 10),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="tilapia",
        fish_count_delta=-2,
        weight_kg_delta=Decimal("-1"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="in scope",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=None,
        entry_date=date(2026, 5, 11),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="tilapia",
        fish_count_delta=-3,
        weight_kg_delta=Decimal("-1"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="no cycle",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        entry_date=date(2026, 5, 12),
        entry_kind="loss",
        loss_reason="mortality",
        fish_species="pangas",
        fish_count_delta=-1,
        weight_kg_delta=Decimal("-1"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="wrong species",
    )

    r = api_client.get(
        "/api/aquaculture/fish-stock-ledger/",
        {
            "pond_id": pond.id,
            "production_cycle_id": cy.id,
            "fish_species": "tilapia",
        },
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert len(body) == 1
    assert body[0]["memo"] == "in scope"

    r_bad = api_client.get(
        "/api/aquaculture/fish-stock-ledger/",
        {"pond_id": pond.id, "production_cycle_id": cy_other.id},
        **h,
    )
    assert r_bad.status_code == 400


@pytest.mark.django_db
def test_fish_stock_ledger_get_aggregates_match_implied_ledger_component(
    api_client, company_tenant, auth_admin_headers
):
    """Full-history totals (aggregates=1) match fish-stock-position ledger_* for same filters."""
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Agg pond", is_active=True)
    h = auth_admin_headers
    for i in range(3):
        api_client.post(
            "/api/aquaculture/fish-stock-ledger/",
            data=json.dumps(
                {
                    "pond_id": pond.id,
                    "entry_date": f"2026-05-{10 + i:02d}",
                    "entry_kind": "loss",
                    "loss_reason": "mortality",
                    "fish_species": "tilapia",
                    "fish_count_delta": -1,
                    "weight_kg_delta": "-0.5",
                    "book_value": "0",
                    "post_to_books": False,
                    "memo": f"row {i}",
                }
            ),
            content_type="application/json",
            **h,
        )
    r = api_client.get(
        "/api/aquaculture/fish-stock-ledger/",
        {"pond_id": pond.id, "fish_species": "tilapia", "aggregates": "1", "limit": "2"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["total_row_count"] == 3
    assert body["returned"] == 2
    assert body["total_fish_count_delta"] == -3
    assert float(body["total_weight_kg_delta"]) == pytest.approx(-1.5)

    pos = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="tilapia"
    )
    assert len(pos) == 1
    assert pos[0]["ledger_fish_count_delta"] == body["total_fish_count_delta"]
    assert float(pos[0]["ledger_weight_kg_delta"]) == float(body["total_weight_kg_delta"])
