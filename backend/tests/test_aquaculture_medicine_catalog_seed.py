"""Built-in AQ-MED-* medicine catalog items for pond treatment forms."""
from decimal import Decimal

import pytest

from api.models import Item
from api.services.aquaculture_medicine_catalog_seed import (
    ensure_aquaculture_medicine_catalog_items,
    guide_id_from_item_number,
    medicine_catalog_item_number,
)


@pytest.mark.django_db
def test_ensure_medicine_catalog_creates_builtin_skus(company_tenant):
    r1 = ensure_aquaculture_medicine_catalog_items(company_tenant.id)
    assert r1["created"] == 20
    assert r1["total"] == 20

    lime = Item.objects.get(
        company_id=company_tenant.id,
        item_number=medicine_catalog_item_number("ag_lime"),
    )
    assert lime.pos_category == "medicine"
    assert lime.category == "Pond care"
    assert lime.unit == "kg"
    assert "Agricultural lime" in lime.name

    r2 = ensure_aquaculture_medicine_catalog_items(company_tenant.id)
    assert r2["created"] == 0
    assert r2["updated"] == 0
    assert r2["total"] == 20


@pytest.mark.django_db
def test_guide_id_from_item_number():
    assert guide_id_from_item_number("AQ-MED-salt") == "salt"
    assert guide_id_from_item_number("ITM-001") is None
