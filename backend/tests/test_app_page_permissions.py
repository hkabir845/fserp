"""Per-app permission keys grant access via parent bundle keys."""
from api.services.app_page_permissions import page_permission_granted
from api.services.permission_service import has_permission


def test_parent_bundle_grants_page():
    assert page_permission_granted(["app.station"], "app.page.tanks") is True
    assert page_permission_granted(["app.page.tanks"], "app.page.stations") is False


def test_has_permission_accepts_page_or_parent():
    assert has_permission(["app.sales"], "app.page.invoices") is True
    assert has_permission(["app.page.invoices"], "app.page.bills") is False
    assert has_permission(["app.customers"], "app.page.customers") is True
    assert has_permission(["app.sales"], "app.page.customers") is True
