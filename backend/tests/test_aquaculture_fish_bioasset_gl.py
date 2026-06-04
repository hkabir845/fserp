"""Live fish purchases capitalize into Biological Inventory (1581), tagged to the pond, so each
pond's balance sheet carries both the bio-asset and the matching A/P liability."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    Company,
    JournalEntryLine,
    Vendor,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts

from tests.conftest import seed_min_gl_accounts

pytestmark = pytest.mark.django_db


def _enable_aquaculture_with_coa(company):
    Company.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    seed_min_gl_accounts(company)
    ensure_aquaculture_chart_accounts(company.id)


def _fish_item(company_id, name="Tilapia Fry Bio"):
    from api.models import Item

    return Item.objects.create(
        company_id=company_id,
        name=name,
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
    )


def _vendor(api_client, headers, name):
    r = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": name}),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)["id"]


def _post_open_fish_bill(api_client, headers, vendor_id, item_id, pond_id, amount="500.00"):
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-09",
                "subtotal": amount,
                "tax_total": "0",
                "total": amount,
                "status": "open",
                "lines": [
                    {
                        "description": "Fry batch",
                        "item_id": item_id,
                        "quantity": "1",
                        "unit_cost": amount,
                        "amount": amount,
                        "aquaculture_pond_id": pond_id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "20",
                        "aquaculture_fish_count": 5000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)


def test_fish_purchase_capitalizes_to_biological_inventory_tagged_to_pond(
    api_client, company_tenant, auth_admin_headers
):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Bio Nursing", pond_role="nursing", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Bio")
    fry = _fish_item(cid)

    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    # Debit side: Biological Inventory 1581, tagged to the pond.
    bio_line = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code="1581",
        aquaculture_pond_id=pond.id,
    ).first()
    assert bio_line is not None
    assert bio_line.debit == Decimal("500.00")

    # Credit side: A/P 2000, also tagged to the pond (single-pond bill).
    ap_line = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code="2000",
        aquaculture_pond_id=pond.id,
    ).first()
    assert ap_line is not None
    assert ap_line.credit == Decimal("500.00")


def test_fish_purchase_pond_balance_sheet_carries_bioasset_and_liability(
    api_client, company_tenant, auth_admin_headers
):
    from api.services.reporting import report_balance_sheet

    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Bio BS Pond", pond_role="nursing", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery BS")
    fry = _fish_item(cid, name="Tilapia Fry BS")

    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    bs = report_balance_sheet(cid, date(2026, 5, 1), date(2026, 5, 31), pond_id=pond.id)
    assert bs.get("filter_pond_id") == pond.id
    # Pond carries the bio-asset (asset) and the matching payable (liability), so it balances.
    assert bs["assets"]["total"] == 500.0
    assert bs["liabilities"]["total"] == 500.0
    assert bs["is_balanced"] is True


def test_cash_flow_accepts_pond_scope(api_client, company_tenant, auth_admin_headers):
    """report_cash_flow honors pond_id and reports the pond as an individual entity."""
    from api.services.reporting import report_cash_flow

    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="CF Pond", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery CF")
    fry = _fish_item(cid, name="Tilapia Fry CF")
    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    cf = report_cash_flow(cid, date(2026, 1, 1), date(2026, 12, 31), pond_id=pond.id)
    assert cf["report_id"] == "cash-flow"
    assert cf.get("filter_pond_id") == pond.id
    assert "operating" in cf and "net_income" in cf["operating"]
    assert isinstance(cf["bank_accounts"], list)
    # Pond-scoped view does not expand the all-entities breakdown.
    assert "by_pond" not in cf


def test_pond_close_snapshots_biological_settlement(api_client, company_tenant, auth_admin_headers):
    """Closing a pond records remaining count/weight and the pond's bio-asset (1581) book value."""
    from api.services.aquaculture_data_bank_service import close_pond, preview_pond_close

    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    company = Company.objects.get(pk=cid)
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Close Pond", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Close")
    fry = _fish_item(cid, name="Tilapia Fry Close")

    _post_open_fish_bill(api_client, h, vendor_id, fry.id, pond.id, amount="500.00")

    # Preview projects the settlement before closing.
    preview = preview_pond_close(company, pond, date(2026, 12, 31), date(2026, 1, 1))
    assert preview["settlement_fish_count"] == 5000
    assert Decimal(preview["settlement_bioasset_value"]) == Decimal("500.00")

    close, err = close_pond(
        company_id=cid,
        pond_id=pond.id,
        period_end=date(2026, 12, 31),
        period_start=date(2026, 1, 1),
        user=None,
    )
    assert err is None, err
    assert close is not None
    assert close.settlement_fish_count == 5000
    assert close.settlement_weight_kg == Decimal("20.0000")
    assert close.settlement_bioasset_value == Decimal("500.00")
