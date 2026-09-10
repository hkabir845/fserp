"""Reproductions from the follow-up application review."""
from decimal import Decimal

import pytest

from tests.test_invoice_stock_relief import _books
from tests.test_pos_sale_scope import _fuel_nozzle

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("cost", ["200", "0"])
@pytest.mark.parametrize("void_first", [False, True])
def test_shop_pos_delete_restores_stock(api_client, auth_super_headers, company_tenant, cost, void_first):
    from api.models import Invoice
    from api.services.station_stock import get_station_stock

    cid, site, item, customer = _books(company_tenant)
    item.cost = Decimal(cost)
    item.save(update_fields=["cost"])
    headers = dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(cid))
    response = api_client.post(
        "/api/cashier/pos/",
        {"station_id": site.id, "items": [{"item_id": item.id, "quantity": "3"}]},
        content_type="application/json", **headers,
    )
    assert response.status_code == 201, response.content
    inv = Invoice.objects.get(company_id=cid)
    assert get_station_stock(cid, site.id, item.id) == Decimal("7")
    # Reversal must use posting evidence even after a catalog edit.
    item.item_type = "non_inventory"
    item.save(update_fields=["item_type"])
    if void_first:
        response = api_client.put(
            f"/api/invoices/{inv.id}/status/", {"new_status": "void", "reason": "test reversal"},
            content_type="application/json", **headers,
        )
        assert response.status_code == 200, response.content
        assert get_station_stock(cid, site.id, item.id) == Decimal("10")
    response = api_client.delete(f"/api/invoices/{inv.id}/", **headers)
    assert response.status_code == 204, response.content
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


def test_void_then_delete_fuel_sale_restores_stock_only_once(api_client, auth_super_headers, company_tenant):
    from api.models import Invoice
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    nozzle = _fuel_nozzle(company_tenant)
    headers = dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(company_tenant.id))
    response = api_client.post(
        "/api/cashier/pos/",
        {"station_id": nozzle.tank.station_id, "fuel_lines": [{"nozzle_id": nozzle.id, "quantity": "3"}]},
        content_type="application/json", **headers,
    )
    assert response.status_code == 201, response.content
    inv = Invoice.objects.get(company_id=company_tenant.id)
    response = api_client.put(
        f"/api/invoices/{inv.id}/status/", {"new_status": "void", "reason": "test reversal"},
        content_type="application/json", **headers,
    )
    assert response.status_code == 200, response.content
    nozzle.tank.refresh_from_db()
    assert nozzle.tank.current_stock == Decimal("10000")
    nozzle.meter.refresh_from_db()
    assert nozzle.meter.current_reading == Decimal("100")
    response = api_client.delete(f"/api/invoices/{inv.id}/", **headers)
    assert response.status_code == 204, response.content
    nozzle.tank.refresh_from_db()
    assert nozzle.tank.current_stock == Decimal("10000")
    nozzle.meter.refresh_from_db()
    assert nozzle.meter.current_reading == Decimal("100")
