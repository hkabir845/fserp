"""Default role permissions must not grant full admin to unknown or generic users."""
from api.services.permission_service import default_permissions_for_role


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
