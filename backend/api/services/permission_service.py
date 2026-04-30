"""
Effective permissions: built-in role defaults, optional CompanyRole override, and helpers.
"""
from __future__ import annotations

from typing import Any, Iterable

from api.utils.auth import user_is_super_admin


def _dedupe_keep_order(items: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for x in items:
        s = (x or "").strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out

# Wildcard: full access (SaaS super admin and equivalent).
PERM_WILDCARD = "*"

# POS line types allowed for cashier/operator (User.pos_sale_scope). Enforced in api.views.cashier_views.
POS_SALE_SCOPES: tuple[str, ...] = ("both", "general", "fuel")

# ——— Catalog (UI + API): stable string keys ———
PERMISSION_CATALOG: list[dict[str, str]] = [
    {"id": "app.launcher", "label": "Apps & dashboard", "group": "Core"},
    {"id": "app.pos", "label": "POS / Cashier", "group": "Core"},
    {"id": "app.station", "label": "Stations, tanks, forecourt", "group": "Operations"},
    {"id": "app.operations", "label": "Shifts & tank dips", "group": "Operations"},
    {"id": "app.accounting", "label": "GL, journal, fund transfers, loans", "group": "Accounting"},
    {"id": "app.sales", "label": "AR/AP: customers, vendors, invoices, bills, payments", "group": "Sales"},
    {"id": "app.customers", "label": "Customers (directory)", "group": "Sales"},
    {"id": "app.inventory", "label": "Products & services (catalog / SKU)", "group": "Inventory"},
    {"id": "app.hr", "label": "HR & payroll", "group": "HR"},
    {"id": "app.settings", "label": "Company, tax, subscription", "group": "Settings"},
    {"id": "app.users", "label": "User accounts", "group": "Settings"},
    {"id": "app.roles", "label": "Custom roles", "group": "Settings"},
    {"id": "app.backup", "label": "Backup & restore", "group": "Settings"},
    {"id": "app.reports", "label": "Reports hub (general)", "group": "Reports"},
    {
        "id": "report.inventory_sku",
        "label": "Inventory & item reports (valuation, catalog, sales by category, custom filters)",
        "group": "Reports",
    },
]

REPORT_ID_EXTRA_PERMISSION: dict[str, str] = {
    "inventory-sku-valuation": "report.inventory_sku",
    "item-master-by-category": "report.inventory_sku",
    "item-sales-by-category": "report.inventory_sku",
    "item-sales-custom": "report.inventory_sku",
    "item-purchases-by-category": "report.inventory_sku",
    "item-purchases-custom": "report.inventory_sku",
    "item-stock-movement": "report.inventory_sku",
    "item-velocity-analysis": "report.inventory_sku",
    "item-purchase-velocity-analysis": "report.inventory_sku",
    "financial-analytics": "app.reports",
    "sales-by-station": "app.reports",
}

# Only catalog keys are stored for tenant custom roles (unknown keys are dropped).
CATALOG_PERMISSION_IDS: frozenset[str] = frozenset(p["id"] for p in PERMISSION_CATALOG)


def sanitize_tenant_role_permissions(raw: list | None) -> list[str]:
    """Keep only known catalog permission keys, deduped and ordered."""
    if not raw or not isinstance(raw, list):
        return []
    return _dedupe_keep_order(s for s in (str(x).strip() for x in raw if x) if s in CATALOG_PERMISSION_IDS)


def role_default_permissions_for_catalog() -> dict[str, list[str]]:
    """Default permission sets per job title, for the permission editor (same as `default_permissions_for_role` when no custom role)."""
    keys = ("admin", "accountant", "cashier", "operator")
    return {k: list(_DEFAULT_ROLE_PERMS[k]) for k in keys if k in _DEFAULT_ROLE_PERMS}

# Default permission sets (when user has no custom CompanyRole)
_DEFAULT_ROLE_PERMS: dict[str, list[str]] = {
    "super_admin": [PERM_WILDCARD],
    "admin": _dedupe_keep_order(p["id"] for p in PERMISSION_CATALOG),
    "accountant": [
        "app.launcher",
        "app.pos",
        "app.operations",
        "app.accounting",
        "app.sales",
        "app.customers",
        "app.inventory",
        "app.hr",
        "app.settings",
        "app.reports",
        "report.inventory_sku",
    ],
    "manager": [p["id"] for p in PERMISSION_CATALOG if p["id"] != "app.users"],
    "cashier": [
        "app.launcher",
        "app.pos",
        "app.customers",
        "app.reports",
    ],
    "operator": ["app.pos"],
}


def normalize_role_key(role: str | None) -> str:
    if not role:
        return ""
    return str(role).strip().lower().replace(" ", "_").replace("-", "_")


def default_permissions_for_role(role: str | None) -> list[str]:
    rk = normalize_role_key(role)
    if rk in _DEFAULT_ROLE_PERMS:
        return list(_DEFAULT_ROLE_PERMS[rk])
    if rk in ("user", "staff", "employee", ""):
        return list(_DEFAULT_ROLE_PERMS.get("admin", ()))
    # unknown role → broad access (legacy sidebar returns full menu)
    return list(_DEFAULT_ROLE_PERMS.get("admin", ()))


def resolve_user_permissions(user) -> list[str]:
    if not user:
        return []
    if user_is_super_admin(user):
        return [PERM_WILDCARD]
    cr = getattr(user, "custom_role", None)
    if cr is not None:
        perms = getattr(cr, "permissions", None) or []
        if isinstance(perms, list):
            return _dedupe_keep_order([str(p) for p in perms if p])
        if isinstance(perms, dict):
            # allow {"report.inventory_sku": true, ...} shape
            return _dedupe_keep_order([k for k, v in perms.items() if v])
    return _dedupe_keep_order(default_permissions_for_role(getattr(user, "role", None)))


def has_permission(effective: list[str], *need: str) -> bool:
    if not need:
        return True
    eff = set(effective or [])
    if PERM_WILDCARD in eff:
        return True
    for n in need:
        if n in eff:
            return True
    return False


def can_access_report(permissions: list[str], report_id: str) -> bool:
    extra = REPORT_ID_EXTRA_PERMISSION.get(report_id)
    if extra and not has_permission(permissions, extra):
        return False
    return True


def custom_role_belongs_to_user_company(user, role_company_id: int | None) -> bool:
    if not user or role_company_id is None:
        return False
    uid = getattr(user, "company_id", None)
    return uid is not None and int(uid) == int(role_company_id)


def user_pos_sale_scope(user) -> str:
    """
    What the user may sell at POST /api/cashier/pos/: general lines, fuel lines, or both.
    Exposed in login / user JSON. Non-cashier/operator always 'both' (ignores column).
    """
    rk = normalize_role_key(getattr(user, "role", None))
    if rk not in ("cashier", "operator"):
        return "both"
    raw = (getattr(user, "pos_sale_scope", None) or "both").strip().lower()
    if raw in POS_SALE_SCOPES:
        return raw
    return "both"


def user_client_dict(user) -> dict[str, Any]:
    """
    Public user object for login and /api/users (includes effective permissions and optional custom role).
    List/login queries should `select_related("custom_role", "home_station")` to avoid N+1.
    """
    perms = resolve_user_permissions(user)
    cr = getattr(user, "custom_role", None)
    hs = getattr(user, "home_station", None)
    hs_id = getattr(user, "home_station_id", None)
    return {
        "id": getattr(user, "id", None),
        "username": getattr(user, "username", "") or "",
        "email": (getattr(user, "email", None) or "") or "",
        "full_name": (getattr(user, "full_name", None) or "") or "",
        "role": (getattr(user, "role", None) or "") or "user",
        "company_id": getattr(user, "company_id", None),
        "custom_role_id": getattr(user, "custom_role_id", None),
        "custom_role_name": (cr.name if cr is not None else None),
        "permissions": perms,
        "pos_sale_scope": user_pos_sale_scope(user),
        "home_station_id": int(hs_id) if hs_id is not None else None,
        "home_station_name": (hs.station_name if hs is not None else None) if hs_id else None,
    }
