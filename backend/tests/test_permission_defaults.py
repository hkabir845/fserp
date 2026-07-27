"""Default role permissions must not grant full admin to unknown or generic users."""
from api.services.permission_service import (
    default_permissions_for_role,
    has_aquaculture_module_permission,
    role_default_permissions_for_catalog,
    user_may_access_aquaculture_api,
)


def test_generic_user_role_is_minimal():
    perms = default_permissions_for_role("user")
    assert "app.users" not in perms
    assert "app.backup" not in perms
    assert perms == ["app.launcher", "app.pos"]


def test_unknown_role_is_launcher_only():
    perms = default_permissions_for_role("custom_typo_role")
    assert perms == ["app.launcher"]


def test_admin_role_keeps_full_catalog():
    perms = default_permissions_for_role("admin")
    assert "app.users" in perms
    assert "app.backup" in perms


def test_fuel_only_seed_excludes_aquaculture():
    defaults = role_default_permissions_for_catalog()
    fuel = defaults["fuel_only"]
    assert "app.pos" in fuel or "app.station" in fuel or "app.launcher" in fuel
    assert "app.aquaculture" not in fuel
    assert not any(p.startswith("app.aquaculture.") for p in fuel)
    assert not any(p.startswith("report.") and "aquaculture" in p for p in fuel)


def test_fuel_only_user_denied_aquaculture_api():
    class _User:
        role = "cashier"
        company_id = 2
        custom_role = None

    # Permissions decide API access (permanent company no longer bypasses).
    assert user_may_access_aquaculture_api(_User()) is False


def test_manager_with_default_perms_may_access_aquaculture():
    class _User:
        role = "manager"
        company_id = 2
        custom_role = None

    assert user_may_access_aquaculture_api(_User()) is True
    assert has_aquaculture_module_permission(default_permissions_for_role("manager"))
