"""
Effective permissions: built-in role defaults, optional CompanyRole override, and helpers.
"""
from __future__ import annotations

from typing import Any, Iterable

from api.services.app_page_permissions import (
    PAGE_PERMISSION_PARENT_BY_ID,
    page_permission_catalog_entries_for_group,
    page_permission_granted,
)
from api.services.tenant_job_types import (
    DEFAULT_POS_SALE_SCOPE_BY_ROLE,
    ROLES_WITH_POS_SALE_SCOPE,
    tenant_job_type_seed_keys,
)
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

# ——— Aquaculture sub-modules (Roles page; ``app.aquaculture`` grants all) ———
AQUACULTURE_MODULE_PERMISSIONS: list[dict[str, str]] = [
    {"id": "app.aquaculture.dashboard", "label": "Operations dashboard"},
    {"id": "app.aquaculture.ponds", "label": "Ponds"},
    {"id": "app.aquaculture.landlords", "label": "Landlords"},
    {"id": "app.aquaculture.cycles", "label": "Stocking batches"},
    {"id": "app.aquaculture.transfers", "label": "Pond transfers"},
    {"id": "app.aquaculture.stock", "label": "Pond stock"},
    {"id": "app.aquaculture.sampling", "label": "Biomass sampling"},
    {"id": "app.aquaculture.feeding", "label": "Feeding advice"},
    {"id": "app.aquaculture.medicine", "label": "Medicine & treatments"},
    {"id": "app.aquaculture.sales", "label": "Pond & fish sales"},
    {"id": "app.aquaculture.expenses", "label": "Pond costs & expenses"},
    {"id": "app.aquaculture.financing", "label": "Financing & loan repayment"},
    {"id": "app.aquaculture.data_bank", "label": "Data Bank"},
    {"id": "app.aquaculture.report_pl", "label": "P&L management report (Reports hub)"},
]

AQUACULTURE_MODULE_IDS: frozenset[str] = frozenset(p["id"] for p in AQUACULTURE_MODULE_PERMISSIONS)


def report_permission_key(report_id: str) -> str:
    """Stable permission id for a report slug (``trial-balance`` → ``report.trial_balance``)."""
    return "report." + (report_id or "").strip().replace("-", "_")


# ——— Individual reports (Roles page + API enforcement) ———
REPORT_PERMISSION_DEFINITIONS: list[dict[str, str]] = [
    # Financial
    {"report_id": "trial-balance", "label": "Trial Balance", "group": "Reports — Financial"},
    {"report_id": "balance-sheet", "label": "Balance Sheet", "group": "Reports — Financial"},
    {"report_id": "income-statement", "label": "Profit & Loss (P&L)", "group": "Reports — Financial"},
    {"report_id": "customer-balances", "label": "Customer Balances", "group": "Reports — Financial"},
    {"report_id": "ar-aging", "label": "Accounts Receivable Aging", "group": "Reports — Financial"},
    {"report_id": "vendor-balances", "label": "Vendor Balances", "group": "Reports — Financial"},
    {"report_id": "ap-aging", "label": "Accounts Payable Aging", "group": "Reports — Financial"},
    {"report_id": "cash-flow", "label": "Cash Flow Summary", "group": "Reports — Financial"},
    {"report_id": "expense-detail", "label": "Expense Detail (GL)", "group": "Reports — Financial"},
    {"report_id": "income-detail", "label": "Income Detail (GL)", "group": "Reports — Financial"},
    {"report_id": "entities-pl-summary", "label": "All Entities — P&L", "group": "Reports — Financial"},
    {
        "report_id": "entities-balance-sheet-summary",
        "label": "All Entities — Balance Sheet",
        "group": "Reports — Financial",
    },
    {
        "report_id": "entities-trial-balance-summary",
        "label": "All Entities — Trial Balance",
        "group": "Reports — Financial",
    },
    {
        "report_id": "entities-financial-summary",
        "label": "All Entities — Financial summary",
        "group": "Reports — Financial",
    },
    {
        "report_id": "stations-financial-summary",
        "label": "All Stations — P&L Summary",
        "group": "Reports — Financial",
    },
    {
        "report_id": "fuel-stations-pl-summary",
        "label": "Fuel Stations — P&L Summary",
        "group": "Reports — Financial",
    },
    {
        "report_id": "shop-hubs-pl-summary",
        "label": "Shop Hubs (no fuel) — P&L Summary",
        "group": "Reports — Financial",
    },
    {
        "report_id": "ponds-pl-summary",
        "label": "All Ponds — P&L Summary (GL)",
        "group": "Reports — Financial",
    },
    {"report_id": "liabilities-detail", "label": "Liabilities (GL detail)", "group": "Reports — Financial"},
    {"report_id": "loan-receivable-gl", "label": "Loan receivable (GL)", "group": "Reports — Financial"},
    {"report_id": "loan-payable-gl", "label": "Loan payable (GL)", "group": "Reports — Financial"},
    {
        "report_id": "loans-borrow-and-lent",
        "label": "Loans — borrowed & lent",
        "group": "Reports — Financial",
    },
    # Inventory
    {
        "report_id": "inventory-sku-valuation",
        "label": "Inventory: Valuation & Velocity",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-master-by-category",
        "label": "Item catalog by category",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-sales-by-category",
        "label": "Sales by reporting category",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-purchases-by-category",
        "label": "Purchases by reporting category",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-sales-custom",
        "label": "Custom item sales (filtered)",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-purchases-custom",
        "label": "Custom item purchases (filtered)",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-stock-movement",
        "label": "Stock movement (purchases vs sales)",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-velocity-analysis",
        "label": "Fast & slow movers (sales)",
        "group": "Reports — Inventory",
    },
    {
        "report_id": "item-purchase-velocity-analysis",
        "label": "Fast & slow purchases",
        "group": "Reports — Inventory",
    },
    # Operational
    {"report_id": "daily-summary", "label": "Daily Summary", "group": "Reports — Operational"},
    {"report_id": "shift-summary", "label": "Shift Summary", "group": "Reports — Operational"},
    {"report_id": "sales-by-nozzle", "label": "Sales by Nozzle", "group": "Reports — Operational"},
    {"report_id": "sales-by-station", "label": "Sales by station", "group": "Reports — Operational"},
    {"report_id": "sales-by-products", "label": "Sales by Products", "group": "Reports — Operational"},
    {"report_id": "sales-report", "label": "Sales Report", "group": "Reports — Operational"},
    {"report_id": "purchase-report", "label": "Purchase Report", "group": "Reports — Operational"},
    {"report_id": "fuel-sales", "label": "Fuel Sales Analytics", "group": "Reports — Operational"},
    {"report_id": "tank-inventory", "label": "Tank Inventory", "group": "Reports — Operational"},
    {"report_id": "tank-dip-register", "label": "Tank Dip Register", "group": "Reports — Operational"},
    # Analytical
    {"report_id": "analytics-kpi", "label": "Analytics & KPIs", "group": "Reports — Analytical"},
    {"report_id": "financial-analytics", "label": "Financial analytics (API)", "group": "Reports — Analytical"},
    {"report_id": "tank-dip-variance", "label": "Tank Dip Variance", "group": "Reports — Analytical"},
    {"report_id": "meter-readings", "label": "Meter Readings", "group": "Reports — Analytical"},
    # Aquaculture
    {
        "report_id": "aquaculture-pl-management",
        "label": "Aquaculture — P&L: site & ponds",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-sales",
        "label": "Aquaculture — Pond sales register",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-sales-comprehensive",
        "label": "Aquaculture — All pond revenue",
        "group": "Reports — Aquaculture",
    },
    {"report_id": "aquaculture-pond-pl", "label": "Aquaculture — Pond P&L", "group": "Reports — Aquaculture"},
    {
        "report_id": "aquaculture-expenses",
        "label": "Aquaculture — Expense register",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-sampling",
        "label": "Aquaculture — Biomass sampling",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-production-cycles",
        "label": "Aquaculture — Production cycles",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-profit-transfers",
        "label": "Aquaculture — Pond profit transfers",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-transfers",
        "label": "Aquaculture — Inter-pond fish transfers",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-feed-stock",
        "label": "Aquaculture — Pond feed stock",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-medicine-stock",
        "label": "Aquaculture — Pond medicine stock",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-supplies-stock",
        "label": "Aquaculture — Pond supplies stock",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-stock-position",
        "label": "Aquaculture — Fish stock by pond",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-stock-breakdown",
        "label": "Aquaculture — Fish stock by batch & species",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-biomass-movements",
        "label": "Aquaculture — Fish biomass movements",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-biological-asset-ledger",
        "label": "Aquaculture — Biological asset ledger",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-stock-adjustments",
        "label": "Aquaculture — Mortality & stock adjustments",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fcr-biomass",
        "label": "Aquaculture — FCR, feed & pond load",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-fish-growth",
        "label": "Aquaculture — Fish growth, FCR & load",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-performance",
        "label": "Aquaculture — Pond performance dashboard",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-shop-station-stock",
        "label": "Aquaculture — Shop / station inventory",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-equipment-assets",
        "label": "Aquaculture — Equipment & assets register",
        "group": "Reports — Aquaculture",
    },
    {
        "report_id": "aquaculture-pond-total-inventory",
        "label": "Aquaculture — Pond total inventory & value",
        "group": "Reports — Aquaculture",
    },
]

INVENTORY_REPORT_IDS: frozenset[str] = frozenset(
    d["report_id"] for d in REPORT_PERMISSION_DEFINITIONS if d["group"] == "Reports — Inventory"
)

AQUACULTURE_REPORT_IDS: frozenset[str] = frozenset(
    d["report_id"] for d in REPORT_PERMISSION_DEFINITIONS if d["group"] == "Reports — Aquaculture"
)

GENERAL_REPORT_IDS: frozenset[str] = frozenset(
    d["report_id"]
    for d in REPORT_PERMISSION_DEFINITIONS
    if d["group"] in ("Reports — Financial", "Reports — Operational", "Reports — Analytical")
)

REPORT_PERMISSION_IDS: frozenset[str] = frozenset(
    report_permission_key(d["report_id"]) for d in REPORT_PERMISSION_DEFINITIONS
)

def _build_permission_catalog() -> list[dict[str, str]]:
    """Roles UI catalog: app bundles, every launcher app, reports, aquaculture modules."""
    return [
        {
            "id": "app.launcher",
            "label": "App launcher (all Main apps)",
            "group": "Apps — Main",
        },
        {"id": "app.pos", "label": "POS / Cashier (all Main POS access)", "group": "Apps — Main"},
        *page_permission_catalog_entries_for_group("Apps — Main"),
        {
            "id": "app.station",
            "label": "All station apps (Stations, tanks, islands, dispensers, meters, nozzles)",
            "group": "Apps — Station",
        },
        *page_permission_catalog_entries_for_group("Apps — Station"),
        {
            "id": "app.operations",
            "label": "All operations apps (Shifts & tank dips)",
            "group": "Apps — Operations",
        },
        *page_permission_catalog_entries_for_group("Apps — Operations"),
        {
            "id": "app.accounting",
            "label": "All accounting apps (COA, journal, fund transfers, loans)",
            "group": "Apps — Accounting",
        },
        *page_permission_catalog_entries_for_group("Apps — Accounting"),
        {
            "id": "app.sales",
            "label": "All sales apps (vendors, invoices, bills, payments)",
            "group": "Apps — Sales",
        },
        {
            "id": "app.customers",
            "label": "Customers directory (all customer access)",
            "group": "Apps — Sales",
        },
        *page_permission_catalog_entries_for_group("Apps — Sales"),
        {
            "id": "app.inventory",
            "label": "All inventory apps (products & stock transfers)",
            "group": "Apps — Inventory",
        },
        *page_permission_catalog_entries_for_group("Apps — Inventory"),
        {"id": "app.hr", "label": "All HR apps (employees & payroll)", "group": "Apps — HR"},
        *page_permission_catalog_entries_for_group("Apps — HR"),
        {
            "id": "app.settings",
            "label": "All settings apps (company, tax, subscription, reporting categories)",
            "group": "Apps — Management",
        },
        {"id": "app.users", "label": "User accounts (all user management)", "group": "Apps — Management"},
        {"id": "app.roles", "label": "Roles & access (all role management)", "group": "Apps — Management"},
        {"id": "app.backup", "label": "Backup & restore (all backup access)", "group": "Apps — Management"},
        *page_permission_catalog_entries_for_group("Apps — Management"),
        {
            "id": "app.reports",
            "label": "Reports hub — all financial, operational & analytical reports",
            "group": "Apps — Reports",
        },
        *page_permission_catalog_entries_for_group("Apps — Reports"),
        {
            "id": "report.inventory_sku",
            "label": "All inventory & item reports (shortcut)",
            "group": "Reports",
        },
        *[
            {
                "id": report_permission_key(d["report_id"]),
                "label": d["label"],
                "group": d["group"],
            }
            for d in REPORT_PERMISSION_DEFINITIONS
        ],
        {
            "id": "app.aquaculture",
            "label": "Aquaculture — all modules",
            "group": "Aquaculture",
        },
        *[{"id": p["id"], "label": p["label"], "group": "Aquaculture"} for p in AQUACULTURE_MODULE_PERMISSIONS],
    ]


# ——— Catalog (UI + API): stable string keys ———
PERMISSION_CATALOG: list[dict[str, str]] = _build_permission_catalog()

# Legacy map: report slug → parent permission that also grants access (see ``can_access_report``).
REPORT_ID_EXTRA_PERMISSION: dict[str, str] = {
    **{rid: "report.inventory_sku" for rid in INVENTORY_REPORT_IDS},
    **{rid: "app.aquaculture" for rid in AQUACULTURE_REPORT_IDS if rid != "aquaculture-pl-management"},
    "aquaculture-pl-management": "app.aquaculture.report_pl",
    **{rid: "app.reports" for rid in GENERAL_REPORT_IDS},
}

# Only catalog keys are stored for tenant custom roles (unknown keys are dropped).
CATALOG_PERMISSION_IDS: frozenset[str] = frozenset(p["id"] for p in PERMISSION_CATALOG)


def sanitize_tenant_role_permissions(raw: list | None) -> list[str]:
    """Keep only known catalog permission keys, deduped and ordered."""
    if not raw or not isinstance(raw, list):
        return []
    return _dedupe_keep_order(s for s in (str(x).strip() for x in raw if x) if s in CATALOG_PERMISSION_IDS)


# Custom access profile preset: pond/fish staff under a fuel+shop tenant (e.g. Premium Agro at Adib).
AQUACULTURE_ONLY_DEFAULT_PERMISSIONS: list[str] = ["app.launcher", "app.aquaculture"]

# Generic tenant users (User.role default is "user") — launcher + POS only, not full admin.
_GENERIC_USER_ROLE_PERMS: list[str] = ["app.launcher", "app.pos"]


def role_default_permissions_for_catalog() -> dict[str, list[str]]:
    """Default permission sets per job title, for the permission editor (same as `default_permissions_for_role` when no custom role)."""
    out = {k: list(_DEFAULT_ROLE_PERMS[k]) for k in tenant_job_type_seed_keys() if k in _DEFAULT_ROLE_PERMS}
    out["user"] = list(_GENERIC_USER_ROLE_PERMS)
    out["aquaculture_only"] = list(AQUACULTURE_ONLY_DEFAULT_PERMISSIONS)
    return out

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
        "app.aquaculture",
    ],
    "supervisor": [
        "app.launcher",
        "app.aquaculture",
        "app.operations",
        "app.reports",
    ],
    "manager": [
        p["id"]
        for p in PERMISSION_CATALOG
        if p["id"] != "app.users"
    ],
    "cashier": [
        "app.launcher",
        "app.pos",
        "app.customers",
        "app.reports",
    ],
    "operator": ["app.pos"],
    "pump_attendant": ["app.pos"],
    "shopkeeper": [
        "app.launcher",
        "app.pos",
        "app.customers",
        "app.inventory",
        "app.reports",
    ],
    "inventory_clerk": [
        "app.launcher",
        "app.inventory",
        "report.inventory_sku",
    ],
    "sales_clerk": [
        "app.launcher",
        "app.sales",
        "app.customers",
    ],
    "forecourt_supervisor": [
        "app.launcher",
        "app.station",
        "app.operations",
        "app.reports",
    ],
    "hr_officer": [
        "app.launcher",
        "app.hr",
    ],
    "auditor": [
        "app.launcher",
        "app.accounting",
        "app.sales",
        "app.customers",
        "app.inventory",
        "app.reports",
        "report.inventory_sku",
    ],
}


def normalize_role_key(role: str | None) -> str:
    if not role:
        return ""
    return str(role).strip().lower().replace(" ", "_").replace("-", "_")


def user_may_access_aquaculture_api(user) -> bool:
    """
    Aquaculture requires company module enablement. Platform super-admins, tenant Admins, and
    any user granted ``app.aquaculture`` (e.g. Manager or a custom role) may call aquaculture APIs.
    """
    if not user:
        return False
    if user_is_super_admin(user):
        return True
    if normalize_role_key(getattr(user, "role", None)) == "admin":
        return True
    return has_aquaculture_module_permission(resolve_user_permissions(user))


def default_permissions_for_role(role: str | None) -> list[str]:
    rk = normalize_role_key(role)
    if rk in _DEFAULT_ROLE_PERMS:
        return list(_DEFAULT_ROLE_PERMS[rk])
    if rk in ("user", "staff", "employee", ""):
        return list(_GENERIC_USER_ROLE_PERMS)
    # Unknown role keys: deny broad access; assign minimal launcher access until an admin sets a custom role.
    return ["app.launcher"]


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


def has_aquaculture_module_permission(effective: list[str], module_id: str | None = None) -> bool:
    """``app.aquaculture`` or any ``app.aquaculture.*`` module key; optional single-module check."""
    eff = set(effective or [])
    if PERM_WILDCARD in eff or "app.aquaculture" in eff:
        return True
    if module_id:
        return module_id in eff
    return bool(eff.intersection(AQUACULTURE_MODULE_IDS))


def has_permission(effective: list[str], *need: str) -> bool:
    if not need:
        return True
    eff = set(effective or [])
    if PERM_WILDCARD in eff:
        return True
    for n in need:
        if n in eff:
            return True
        if n.startswith("app.page.") and page_permission_granted(effective, n):
            return True
        parent = PAGE_PERMISSION_PARENT_BY_ID.get(n)
        if parent and parent in eff:
            return True
        if n.startswith("app.aquaculture.") and has_aquaculture_module_permission(effective, n):
            return True
    return False


def can_access_report(permissions: list[str], report_id: str) -> bool:
    rid = (report_id or "").strip()
    if not rid:
        return False
    if has_permission(permissions, report_permission_key(rid)):
        return True
    if rid in INVENTORY_REPORT_IDS and has_permission(permissions, "report.inventory_sku"):
        return True
    if rid == "aquaculture-pl-management":
        if has_aquaculture_module_permission(permissions):
            return True
        return has_permission(permissions, "app.aquaculture.report_pl")
    if rid in AQUACULTURE_REPORT_IDS:
        return has_aquaculture_module_permission(permissions)
    return has_permission(permissions, "app.reports")


def custom_role_belongs_to_user_company(user, role_company_id: int | None) -> bool:
    if not user or role_company_id is None:
        return False
    uid = getattr(user, "company_id", None)
    return uid is not None and int(uid) == int(role_company_id)


def user_pos_sale_scope(user) -> str:
    """
    What the user may sell at POST /api/cashier/pos/: general lines, fuel lines, or both.
    Exposed in login / user JSON. Non-POS job types always 'both' (ignores column).
    """
    rk = normalize_role_key(getattr(user, "role", None))
    if rk not in ROLES_WITH_POS_SALE_SCOPE:
        return "both"
    fallback = DEFAULT_POS_SALE_SCOPE_BY_ROLE.get(rk, "both")
    raw = (getattr(user, "pos_sale_scope", None) or fallback).strip().lower()
    if raw in POS_SALE_SCOPES:
        return raw
    return fallback if fallback in POS_SALE_SCOPES else "both"


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
