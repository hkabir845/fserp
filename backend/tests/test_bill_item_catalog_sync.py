"""Bill line -> Item catalog write-back: the "Edit item" panel and the line Rate."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Item


def _vendor(api_client, headers, name: str) -> int:
    r = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": name}),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)["id"]


def _post_bill(api_client, headers, vendor_id: int, line: dict, status: str = "draft"):
    return api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-08-20",
                "subtotal": line["amount"],
                "tax_total": "0",
                "total": line["amount"],
                "status": status,
                "lines": [line],
            }
        ),
        content_type="application/json",
        **headers,
    )


@pytest.mark.django_db
def test_bill_line_item_catalog_panel_updates_the_item(
    api_client, company_tenant, auth_admin_headers
):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Catalog Sync Supplier")
    item = Item.objects.create(
        company_id=company_tenant.id,
        name="Floating Feed 25kg",
        item_type="inventory",
        unit="sack",
        category="General",
        unit_price=Decimal("1200.00"),
        cost=Decimal("1000.00"),
        description="old description",
    )

    r = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "August delivery",  # line memo - must NOT reach the item
            "item_id": item.id,
            "quantity": "10",
            "unit_cost": "1100.00",
            "amount": "11000.00",
            "item_catalog": {
                "name": "Floating Feed 25kg Premium",
                "description": "Extruded floating pellet, 25 kg sack",
                "unit": "bag",
                "category": "Aquaculture Feed",
                "unit_price": "1350.50",
            },
        },
    )
    assert r.status_code == 201, r.content.decode()

    item.refresh_from_db()
    assert item.name == "Floating Feed 25kg Premium"
    assert item.description == "Extruded floating pellet, 25 kg sack"
    assert item.unit == "bag"
    assert item.category == "Aquaculture Feed"
    assert item.unit_price == Decimal("1350.50")
    # Line Rate becomes the item's purchase cost.
    assert item.cost == Decimal("1100.00")


@pytest.mark.django_db
def test_bill_line_rate_becomes_item_cost_without_panel_edits(
    api_client, company_tenant, auth_admin_headers
):
    """No item_catalog on the row: catalog text is untouched, only cost follows the rate."""
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Rate Only Supplier")
    item = Item.objects.create(
        company_id=company_tenant.id,
        name="Lime 50kg",
        item_type="inventory",
        unit="sack",
        category="General",
        unit_price=Decimal("500.00"),
        cost=Decimal("400.00"),
        description="keep me",
    )

    r = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "line memo only",
            "item_id": item.id,
            "quantity": "4",
            "unit_cost": "455.75",
            "amount": "1823.00",
        },
    )
    assert r.status_code == 201, r.content.decode()

    item.refresh_from_db()
    assert item.cost == Decimal("455.75")
    assert item.name == "Lime 50kg"
    assert item.description == "keep me"
    assert item.unit == "sack"
    assert item.unit_price == Decimal("500.00")


@pytest.mark.django_db
def test_posted_bill_edit_keeps_the_typed_rate_as_item_cost(
    api_client, company_tenant, auth_admin_headers
):
    """The rate wins over the AVCO recompute that runs when a posted bill is re-saved."""
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Posted Rate Supplier")
    item = Item.objects.create(
        company_id=company_tenant.id,
        name="Salt 25kg",
        item_type="inventory",
        unit="sack",
        category="General",
        unit_price=Decimal("300.00"),
        cost=Decimal("200.00"),
    )

    created = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "salt",
            "item_id": item.id,
            "quantity": "10",
            "unit_cost": "210.00",
            "amount": "2100.00",
        },
        status="open",
    )
    assert created.status_code == 201, created.content.decode()
    bill_id = json.loads(created.content)["id"]
    item.refresh_from_db()
    assert item.cost == Decimal("210.00")

    upd = api_client.put(
        f"/api/bills/{bill_id}/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-08-20",
                "subtotal": "2500.00",
                "tax_total": "0",
                "total": "2500.00",
                "status": "open",
                "lines": [
                    {
                        "description": "salt",
                        "item_id": item.id,
                        "quantity": "10",
                        "unit_cost": "250.00",
                        "amount": "2500.00",
                        "item_catalog": {"unit_price": "375.00"},
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert upd.status_code == 200, upd.content.decode()

    item.refresh_from_db()
    assert item.cost == Decimal("250.00")
    assert item.unit_price == Decimal("375.00")


@pytest.mark.django_db
def test_bill_line_item_rename_rejects_a_duplicate_catalog_name(
    api_client, company_tenant, auth_admin_headers
):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Duplicate Name Supplier")
    Item.objects.create(
        company_id=company_tenant.id,
        name="Starter Feed",
        item_type="inventory",
        unit="sack",
        category="General",
    )
    target = Item.objects.create(
        company_id=company_tenant.id,
        name="Grower Feed",
        item_type="inventory",
        unit="sack",
        category="General",
        cost=Decimal("900.00"),
    )

    r = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "feed",
            "item_id": target.id,
            "quantity": "1",
            "unit_cost": "950.00",
            "amount": "950.00",
            "item_catalog": {"name": "starter   feed"},
        },
    )
    assert r.status_code == 400, r.content.decode()
    assert "already uses the name" in r.content.decode()

    target.refresh_from_db()
    assert target.name == "Grower Feed"
    assert target.cost == Decimal("900.00")  # nothing written when the request is rejected


@pytest.mark.django_db
def test_bill_line_item_category_cannot_be_blanked(
    api_client, company_tenant, auth_admin_headers
):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Blank Category Supplier")
    item = Item.objects.create(
        company_id=company_tenant.id,
        name="Probiotic 1L",
        item_type="inventory",
        unit="bottle",
        category="Aquaculture",
    )

    r = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "probiotic",
            "item_id": item.id,
            "quantity": "2",
            "unit_cost": "800.00",
            "amount": "1600.00",
            "item_catalog": {"category": "   "},
        },
    )
    assert r.status_code == 400, r.content.decode()
    item.refresh_from_db()
    assert item.category == "Aquaculture"


@pytest.mark.django_db
def test_bill_line_item_catalog_ignores_another_companys_item(
    api_client, company_tenant, auth_admin_headers
):
    """An item id from outside the request company is never written to."""
    from api.models import Company
    from api.services.bill_item_catalog_sync import (
        apply_bill_line_item_catalog_updates,
        parse_bill_line_item_catalog_updates,
    )

    other = Company.objects.create(
        name="Other Co", organization_id=company_tenant.organization_id
    )
    foreign = Item.objects.create(
        company_id=other.id,
        name="Foreign Item",
        item_type="inventory",
        unit="piece",
        category="General",
        cost=Decimal("10.00"),
    )

    updates, err = parse_bill_line_item_catalog_updates(
        company_tenant.id,
        [{"item_id": foreign.id, "unit_cost": "99.00", "item_catalog": {"name": "Hijacked"}}],
    )
    assert err is None
    assert updates == {}
    assert apply_bill_line_item_catalog_updates(company_tenant.id, updates) == 0

    foreign.refresh_from_db()
    assert foreign.name == "Foreign Item"
    assert foreign.cost == Decimal("10.00")


@pytest.mark.django_db
def test_update_bill_line_pcs_per_kg_overwrites_item_each_time(
    api_client, company_tenant, auth_admin_headers
):
    """Line (pcs/kg) on Update Bill is stored on the Item; a later edit replaces it again."""
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Fry Line Catalog")
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing Line", pond_role="nursing", is_active=True
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        item_type="inventory",
        pos_category="fish",
        unit="kg",
        category="Aquaculture",
        pieces_per_kg=Decimal("3000"),
        cost=Decimal("150.00"),
    )

    created = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "Tilapia Fry",
            "item_id": fry.id,
            "quantity": "10",
            "unit_cost": "150.00",
            "amount": "1500.00",
            "aquaculture_pond_id": pond.id,
            "aquaculture_fish_species": "tilapia",
            "aquaculture_fish_weight_kg": "10",
            "aquaculture_fish_count": 30000,
        },
        status="draft",
    )
    assert created.status_code == 201, created.content.decode()
    bill_id = json.loads(created.content)["id"]
    fry.refresh_from_db()
    assert fry.pieces_per_kg == Decimal("3000")

    def _put(pcs: str, kg: str, heads: int, amount: str):
        return api_client.put(
            f"/api/bills/{bill_id}/",
            data=json.dumps(
                {
                    "vendor_id": vendor_id,
                    "bill_date": "2026-08-20",
                    "subtotal": amount,
                    "tax_total": "0",
                    "total": amount,
                    "status": "draft",
                    "lines": [
                        {
                            "description": "Tilapia Fry",
                            "item_id": fry.id,
                            "quantity": kg,
                            "unit_cost": "150.00",
                            "amount": amount,
                            "aquaculture_pond_id": pond.id,
                            "aquaculture_fish_species": "tilapia",
                            "aquaculture_fish_weight_kg": kg,
                            "aquaculture_fish_count": heads,
                            "pieces_per_kg": pcs,
                        }
                    ],
                }
            ),
            content_type="application/json",
            **h,
        )

    first = _put("8.67", "7483.0450", 64878, "1122456.75")
    assert first.status_code == 200, first.content.decode()
    fry.refresh_from_db()
    assert fry.pieces_per_kg == Decimal("8.6700")

    second = _put("10", "6487.8000", 64878, "973170.00")
    assert second.status_code == 200, second.content.decode()
    fry.refresh_from_db()
    assert fry.pieces_per_kg == Decimal("10.0000")


def test_effective_bill_line_pieces_per_kg_ignores_stale_catalog():
    from api.services.bill_item_catalog_sync import effective_bill_line_pieces_per_kg

    pcs, err = effective_bill_line_pieces_per_kg(
        {
            "pieces_per_kg": "3000",
            "aquaculture_fish_count": 64878,
            "aquaculture_fish_weight_kg": "7483.0450",
        }
    )
    assert err is None
    assert pcs == Decimal("8.6700")


@pytest.mark.django_db
def test_update_bill_stale_catalog_3000_does_not_overwrite_implied_line(
    api_client, company_tenant, auth_admin_headers
):
    """Weight/heads already imply 8.67; a leftover catalog 3000 in the payload must not win."""
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Stale Catalog Fry")
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing Stale", pond_role="nursing", is_active=True
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry Stale",
        item_type="inventory",
        pos_category="fish",
        unit="kg",
        category="Aquaculture",
        pieces_per_kg=Decimal("3000"),
        cost=Decimal("150.00"),
    )
    created = _post_bill(
        api_client,
        h,
        vendor_id,
        {
            "description": "Tilapia Fry Stale",
            "item_id": fry.id,
            "quantity": "7483.0450",
            "unit_cost": "150.00",
            "amount": "1122456.75",
            "aquaculture_pond_id": pond.id,
            "aquaculture_fish_species": "tilapia",
            "aquaculture_fish_weight_kg": "7483.0450",
            "aquaculture_fish_count": 64878,
            "pieces_per_kg": "3000",
        },
        status="draft",
    )
    assert created.status_code == 201, created.content.decode()
    body = json.loads(created.content)
    line = body["lines"][0]
    fry.refresh_from_db()
    assert fry.pieces_per_kg == Decimal("8.6700")
    assert Decimal(line["item_pieces_per_kg"]) == Decimal("8.6700")

