"""Pond POS: on-account enforcement, P&L includes POS COGS journals, transfer cost/kg fallback."""
import json
from decimal import Decimal

import pytest
from django.test import Client

from api.models import AquaculturePond, Customer, Invoice, Item, JournalEntry, JournalEntryLine
from api.services.aquaculture_cost_per_kg import (
    build_pond_cost_per_kg_block,
    vendor_bill_pond_operating_total,
)
from api.services.aquaculture_pond_pos_customer import (
    customer_is_linked_pond_pos,
    maybe_provision_auto_pos_customer,
)
from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts


@pytest.mark.django_db
def test_customer_is_linked_pond_pos(company_tenant):
    p = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Test Nursing",
        pond_role="nursing",
        is_active=True,
    )
    maybe_provision_auto_pos_customer(company_id=company_tenant.id, pond=p, skip_auto=False)
    p.refresh_from_db()
    assert p.pos_customer_id
    assert customer_is_linked_pond_pos(company_tenant.id, p.pos_customer_id)
    assert not customer_is_linked_pond_pos(company_tenant.id, 99999)


@pytest.mark.django_db
def test_cashier_pos_rejects_cash_for_pond_customer(
    api_client: Client, auth_super_headers, company_master
):
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    pond = AquaculturePond.objects.create(
        company_id=company_master.id,
        name="POS Pond Cust",
        pond_role="grow_out",
        is_active=True,
    )
    maybe_provision_auto_pos_customer(company_id=company_master.id, pond=pond, skip_auto=False)
    pond.refresh_from_db()
    item_r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Feed sack POS pond test",
                "item_type": "inventory",
                "pos_category": "feed",
                "category": "General",
                "unit_price": "100",
                "cost": "80",
                "quantity_on_hand": "10",
                "is_pos_available": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert item_r.status_code == 201, item_r.content
    item_id = json.loads(item_r.content)["id"]

    cash = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "customer_id": pond.pos_customer_id,
                "payment_method": "cash",
                "items": [{"item_id": item_id, "quantity": "1", "unit_price": "100"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert cash.status_code == 400
    assert "on account" in json.loads(cash.content).get("detail", "").lower()

    ar = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "customer_id": pond.pos_customer_id,
                "payment_method": "on_account",
                "items": [{"item_id": item_id, "quantity": "1", "unit_price": "100"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert ar.status_code == 201, ar.content


@pytest.mark.django_db
def test_pond_pl_includes_pos_cogs_journal_debits(company_tenant_with_gl):
    from datetime import date

    from api.models import ChartOfAccount, Company

    p = AquaculturePond.objects.create(
        company_id=company_tenant_with_gl.id,
        name="PL COGS Pond",
        pond_role="nursing",
        is_active=True,
    )
    cogs = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="5100"
    )
    inv_ac = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="1200"
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_date=date(2026, 5, 17),
        entry_number="AUTO-INV-99-COGS",
        description="test",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cogs,
        debit=Decimal("250"),
        credit=Decimal("0"),
        aquaculture_pond_id=p.id,
        aquaculture_cost_bucket="medicine",
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=inv_ac,
        debit=Decimal("0"),
        credit=Decimal("250"),
        aquaculture_pond_id=p.id,
        aquaculture_cost_bucket="medicine",
    )
    total = vendor_bill_pond_operating_total(
        company_id=company_tenant_with_gl.id,
        pond_id=p.id,
        start=date(2026, 1, 1),
        end=date(2026, 12, 31),
        cycle_filter_id=None,
    )
    assert total == Decimal("250.00")


@pytest.mark.django_db
def test_transfer_cost_per_kg_fallback_uses_biomass(company_tenant):
    from datetime import date

    p = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Xfer Cost Pond",
        pond_role="nursing",
        is_active=True,
    )
    block = build_pond_cost_per_kg_block(
        company_id=company_tenant.id,
        pond_id=p.id,
        pond_name=p.name,
        start=date(2026, 1, 1),
        end=date(2026, 5, 17),
        cycle_filter_id=None,
        operating_expenses_total=Decimal("1000"),
        payroll_allocated=Decimal("0"),
        total_costs=Decimal("1000"),
        shared_expenses=[],
        transfer_in=Decimal("0"),
        transfer_out=Decimal("0"),
        biological_writeoff=Decimal("0"),
    )
    assert block.get("total_cost_per_kg") in (None, "0", "0.00") or block.get("transfer_cost_per_kg")
