"""
Per-app (launcher tile) permission keys for tenant RBAC.

Coarse keys (e.g. ``app.station``) still grant every page in that section.
Individual ``app.page.*`` keys allow finer control in Roles & access.
"""
from __future__ import annotations

APP_PAGE_PERMISSION_DEFINITIONS: list[dict[str, str]] = [
    # Main
    {"id": "app.page.dashboard", "label": "Dashboard", "group": "Apps — Main", "parent": "app.launcher", "href": "/dashboard"},
    {"id": "app.page.brain", "label": "Company Brain", "group": "Apps — Main", "parent": "app.brain", "href": "/brain"},
    {"id": "app.page.cashier", "label": "POS / Cashier", "group": "Apps — Main", "parent": "app.pos", "href": "/cashier"},
    # Station
    {"id": "app.page.stations", "label": "Stations", "group": "Apps — Station", "parent": "app.station", "href": "/stations"},
    {"id": "app.page.tanks", "label": "Tanks", "group": "Apps — Station", "parent": "app.station", "href": "/tanks"},
    {"id": "app.page.islands", "label": "Islands", "group": "Apps — Station", "parent": "app.station", "href": "/islands"},
    {"id": "app.page.dispensers", "label": "Dispensers", "group": "Apps — Station", "parent": "app.station", "href": "/dispensers"},
    {"id": "app.page.meters", "label": "Meters", "group": "Apps — Station", "parent": "app.station", "href": "/meters"},
    {"id": "app.page.nozzles", "label": "Nozzles", "group": "Apps — Station", "parent": "app.station", "href": "/nozzles"},
    # Operations
    {
        "id": "app.page.shift_management",
        "label": "Shift Management",
        "group": "Apps — Operations",
        "parent": "app.operations",
        "href": "/shift-management",
    },
    {"id": "app.page.tank_dips", "label": "Tank Dips", "group": "Apps — Operations", "parent": "app.operations", "href": "/tank-dips"},
    # Accounting
    {
        "id": "app.page.chart_of_accounts",
        "label": "Chart of Accounts",
        "group": "Apps — Accounting",
        "parent": "app.accounting",
        "href": "/chart-of-accounts",
    },
    {
        "id": "app.page.journal_entries",
        "label": "Journal Entries",
        "group": "Apps — Accounting",
        "parent": "app.accounting",
        "href": "/journal-entries",
    },
    {
        "id": "app.page.fund_transfers",
        "label": "Fund Transfer",
        "group": "Apps — Accounting",
        "parent": "app.accounting",
        "href": "/fund-transfers",
    },
    {"id": "app.page.loans", "label": "Loans", "group": "Apps — Accounting", "parent": "app.accounting", "href": "/loans"},
    {
        "id": "app.page.fixed_assets",
        "label": "Fixed Assets",
        "group": "Apps — Accounting",
        "parent": "app.accounting",
        "href": "/fixed-assets",
    },
    # Sales
    {"id": "app.page.customers", "label": "Customers", "group": "Apps — Sales", "parent": "app.customers", "href": "/customers"},
    {"id": "app.page.vendors", "label": "Vendors", "group": "Apps — Sales", "parent": "app.sales", "href": "/vendors"},
    {"id": "app.page.invoices", "label": "Invoices", "group": "Apps — Sales", "parent": "app.sales", "href": "/invoices"},
    {"id": "app.page.bills", "label": "Bills", "group": "Apps — Sales", "parent": "app.sales", "href": "/bills"},
    {"id": "app.page.payments", "label": "Payments", "group": "Apps — Sales", "parent": "app.sales", "href": "/payments"},
    # Inventory
    {
        "id": "app.page.items",
        "label": "Products & services",
        "group": "Apps — Inventory",
        "parent": "app.inventory",
        "href": "/items",
    },
    {
        "id": "app.page.inventory",
        "label": "Inventory & transfers",
        "group": "Apps — Inventory",
        "parent": "app.inventory",
        "href": "/inventory",
    },
    # HR
    {"id": "app.page.employees", "label": "Employees", "group": "Apps — HR", "parent": "app.hr", "href": "/employees"},
    {"id": "app.page.payroll", "label": "Payroll", "group": "Apps — HR", "parent": "app.hr", "href": "/payroll"},
    # Management
    {"id": "app.page.company", "label": "Company", "group": "Apps — Management", "parent": "app.settings", "href": "/company"},
    {
        "id": "app.page.subscriptions",
        "label": "Subscriptions",
        "group": "Apps — Management",
        "parent": "app.settings",
        "href": "/subscriptions",
    },
    {"id": "app.page.users", "label": "Users", "group": "Apps — Management", "parent": "app.users", "href": "/users"},
    {"id": "app.page.roles", "label": "Roles & access", "group": "Apps — Management", "parent": "app.roles", "href": "/roles"},
    {"id": "app.page.tax", "label": "Tax", "group": "Apps — Management", "parent": "app.settings", "href": "/tax"},
    {
        "id": "app.page.reporting_categories",
        "label": "Reporting categories",
        "group": "Apps — Management",
        "parent": "app.settings",
        "href": "/reporting-categories",
    },
    {"id": "app.page.backup", "label": "Backup & Restore", "group": "Apps — Management", "parent": "app.backup", "href": "/backup"},
    # Reports
    {"id": "app.page.reports", "label": "Reports hub", "group": "Apps — Reports", "parent": "app.reports", "href": "/reports"},
]

PAGE_PERMISSION_PARENT_BY_ID: dict[str, str] = {
    p["id"]: p["parent"] for p in APP_PAGE_PERMISSION_DEFINITIONS if p.get("parent")
}

PAGE_PERMISSION_BY_HREF: dict[str, str] = {p["href"]: p["id"] for p in APP_PAGE_PERMISSION_DEFINITIONS}

PAGE_PERMISSION_IDS: frozenset[str] = frozenset(p["id"] for p in APP_PAGE_PERMISSION_DEFINITIONS)


def page_permission_catalog_entries() -> list[dict[str, str]]:
    return [{"id": p["id"], "label": p["label"], "group": p["group"]} for p in APP_PAGE_PERMISSION_DEFINITIONS]


def page_permission_catalog_entries_for_group(group: str) -> list[dict[str, str]]:
    return [e for e in page_permission_catalog_entries() if e["group"] == group]


def permission_keys_for_href(href: str) -> list[str]:
    """Permission keys that grant access to a launcher/sidebar href."""
    keys: list[str] = []
    page_id = PAGE_PERMISSION_BY_HREF.get(href)
    if page_id:
        keys.append(page_id)
        parent = PAGE_PERMISSION_PARENT_BY_ID.get(page_id)
        if parent:
            keys.append(parent)
    if href == "/customers":
        keys.append("app.sales")
    if href == "/reports/analytics":
        keys.append("app.reports")
    return keys


def page_permission_granted(effective: list[str], page_id: str) -> bool:
    eff = set(effective or [])
    if "*" in eff or page_id in eff:
        return True
    parent = PAGE_PERMISSION_PARENT_BY_ID.get(page_id)
    if parent and parent in eff:
        return True
    if page_id == "app.page.customers" and "app.sales" in eff:
        return True
    return False
