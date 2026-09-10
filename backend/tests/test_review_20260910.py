"""Regression tests for defects reproduced during the 2026-09-10 application review."""
from decimal import Decimal
from importlib import import_module

import pytest

from tests.test_invoice_stock_relief import _books, _invoice

pytestmark = pytest.mark.django_db


@pytest.fixture(scope="session")
def django_db_modify_db_settings():
    from django.conf import settings

    settings.DATABASES["default"].setdefault("TEST", {})["NAME"] = "test_fserp_review_20260910"


def test_review_void_restores_stock_after_item_type_change(company_tenant):
    from api.services.gl_posting import sync_invoice_gl, rollback_invoice_posting_effects
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust)
    sync_invoice_gl(cid, inv)
    assert get_station_stock(cid, site.id, item.id) == Decimal("7")
    item.item_type = "non_inventory"
    item.save(update_fields=["item_type"])
    ok, err = rollback_invoice_posting_effects(cid, inv)
    assert ok, err
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


def test_review_void_does_not_invent_stock_after_cost_added(company_tenant):
    from api.services.gl_posting import sync_invoice_gl, rollback_invoice_posting_effects
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    item.cost = Decimal("0")
    item.save(update_fields=["cost"])
    inv = _invoice(cid, site, item, cust)
    sync_invoice_gl(cid, inv)
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")
    item.cost = Decimal("200")
    item.save(update_fields=["cost"])
    ok, err = rollback_invoice_posting_effects(cid, inv)
    assert ok, err
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


def test_review_service_does_not_credit_inventory(company_tenant):
    from api.models import JournalEntryLine
    from api.services.gl_posting import sync_invoice_gl

    cid, site, item, cust = _books(company_tenant)
    item.item_type = "service"
    item.save(update_fields=["item_type"])
    inv = _invoice(cid, site, item, cust)
    sync_invoice_gl(cid, inv)
    credits = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-INV-{inv.id}-COGS",
        account__account_code="1220",
        credit__gt=0,
    )
    assert not credits.exists(), "A service sale credited shop inventory"


def test_review_migration_does_not_reactivate_void_pos_relief(company_tenant):
    from django.apps import apps

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust, status="void", number="INV-POS-OLD")
    migration = import_module("api.migrations.0178_invoice_stock_relieved")
    migration.backfill_pos_invoices_as_relieved(apps, None)
    inv.refresh_from_db()
    assert inv.stock_relieved is False


def test_review_password_change_revokes_previous_refresh(api_client, user_super):
    from api.utils.auth import create_tokens

    access, refresh = create_tokens(user_super)
    response = api_client.post(
        "/api/auth/change-password/",
        {"current_password": "AuditTest#99", "new_password": "ChangedAudit#12345"},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {access}",
    )
    assert response.status_code == 200, response.content
    response = api_client.post(
        "/api/auth/refresh/", {"refresh_token": refresh}, content_type="application/json"
    )
    assert response.status_code == 401, "A session minted before the password change still refreshes"


def test_review_invoice_quantity_edit_updates_stock_and_ar(api_client, auth_super_headers, company_tenant):
    from api.services.gl_posting import sync_invoice_gl
    from api.services.station_stock import get_station_stock

    cid, site, item, cust = _books(company_tenant)
    inv = _invoice(cid, site, item, cust)
    sync_invoice_gl(cid, inv)
    headers = dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(cid))
    response = api_client.put(
        f"/api/invoices/{inv.id}/",
        {"lines": [{"item_id": item.id, "quantity": "5", "unit_price": "300", "amount": "1500"}]},
        content_type="application/json",
        **headers,
    )
    assert response.status_code == 200, response.content
    cust.refresh_from_db()
    actual = (get_station_stock(cid, site.id, item.id), cust.current_balance)
    assert actual == (Decimal("5"), Decimal("1500"))
