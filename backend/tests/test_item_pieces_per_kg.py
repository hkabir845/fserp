"""Fish-type items: optional pieces_per_kg (Line) on catalog and vendor bill auto-fill support."""
from __future__ import annotations

import json

import pytest

from api.models import Item


@pytest.mark.django_db
def test_item_create_and_update_pieces_per_kg(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    create_r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Tilapia Fry",
                "item_type": "inventory",
                "pos_category": "fish",
                "unit": "kg",
                "category": "Aquaculture",
                "pieces_per_kg": "400",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert create_r.status_code == 201, create_r.content.decode()
    payload = json.loads(create_r.content)
    assert payload["pieces_per_kg"] == "400.0000"
    item_id = payload["id"]

    get_r = api_client.get(f"/api/items/{item_id}/", **h)
    assert get_r.status_code == 200
    assert json.loads(get_r.content)["pieces_per_kg"] == "400.0000"

    upd_r = api_client.put(
        f"/api/items/{item_id}/",
        data=json.dumps({"pieces_per_kg": "380"}),
        content_type="application/json",
        **h,
    )
    assert upd_r.status_code == 200
    assert json.loads(upd_r.content)["pieces_per_kg"] == "380.0000"

    clear_r = api_client.put(
        f"/api/items/{item_id}/",
        data=json.dumps({"pieces_per_kg": ""}),
        content_type="application/json",
        **h,
    )
    assert clear_r.status_code == 200
    assert json.loads(clear_r.content)["pieces_per_kg"] is None


@pytest.mark.django_db
def test_item_rejects_invalid_pieces_per_kg(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    bad_r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Bad Fry",
                "item_type": "inventory",
                "pos_category": "fish",
                "category": "Aquaculture",
                "pieces_per_kg": "-1",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bad_r.status_code == 400
    assert "pieces_per_kg" in bad_r.content.decode()


@pytest.mark.django_db
def test_bill_with_fry_item_pieces_per_kg_derives_dims_from_qty_kg(api_client, company_tenant, auth_admin_headers):
    """Qty as kg × Line on item → headcount on bill line (frontend sends derived dims)."""
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery Line Test"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        item_type="inventory",
        pos_category="fish",
        unit="kg",
        category="Aquaculture",
        pieces_per_kg="400",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-16",
                "subtotal": "5000.00",
                "tax_total": "0",
                "total": "5000.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry",
                        "item_id": fry.id,
                        "quantity": "12.5",
                        "unit_cost": "400.00",
                        "amount": "5000.00",
                        "aquaculture_fish_weight_kg": "12.5",
                        "aquaculture_fish_count": 5000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    line = json.loads(bill_r.content)["lines"][0]
    assert line["aquaculture_fish_weight_kg"] == "12.5000"
    assert line["aquaculture_fish_count"] == 5000


@pytest.mark.django_db
def test_bill_fish_line_with_ppk_derives_kg_from_heads(api_client, company_tenant, auth_admin_headers):
    """User enters heads; kg and stored headcount derive from Line (client weight/qty may be wrong)."""
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery Derive"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry Derive",
        item_type="inventory",
        pos_category="fish",
        unit="head",
        category="Aquaculture",
        pieces_per_kg="3000",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-16",
                "subtotal": "366.67",
                "tax_total": "0",
                "total": "366.67",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry Derive",
                        "item_id": fry.id,
                        "quantity": "166.6667",
                        "unit_cost": "2.2",
                        "amount": "366.67",
                        "aquaculture_fish_weight_kg": "500000",
                        "aquaculture_fish_count": 500000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    line = json.loads(bill_r.content)["lines"][0]
    assert line["aquaculture_fish_weight_kg"] == "166.6667"
    assert line["aquaculture_fish_count"] == 500000


@pytest.mark.django_db
def test_bill_fish_line_heads_and_amount_derives_billing_kg(api_client, company_tenant, auth_admin_headers):
    """Typical fry purchase: 500k heads, vendor total; kg = heads / Line."""
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery Heads"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry Heads",
        item_type="inventory",
        pos_category="fish",
        unit="kg",
        category="Aquaculture",
        pieces_per_kg="3000",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-16",
                "subtotal": "1100000.00",
                "tax_total": "0",
                "total": "1100000.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry Heads",
                        "item_id": fry.id,
                        "quantity": "166.6667",
                        "unit_cost": "6600",
                        "amount": "1100000.00",
                        "aquaculture_fish_count": 500000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    line = json.loads(bill_r.content)["lines"][0]
    assert line["quantity"] == "166.6667"
    assert line["aquaculture_fish_weight_kg"] == "166.6667"
    assert line["aquaculture_fish_count"] == 500000
