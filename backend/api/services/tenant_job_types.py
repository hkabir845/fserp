"""
Built-in tenant job types (User.role) — labels, hints, and validation.

Custom access profiles (CompanyRole) override these defaults when assigned.
"""
from __future__ import annotations

from typing import Any

# Keys accepted on POST/PUT /api/users/ (tenant scope; not platform super_admin).
TENANT_JOB_TYPE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "id": "admin",
        "label": "Admin",
        "hint": "Company admin: people, company settings, and all modules (unless a custom access profile overrides).",
        "seed_order": 10,
    },
    {
        "id": "manager",
        "label": "Manager (Fuel Station, Shop & Aquaculture)",
        "hint": "Runs fuel station, shop, and aquaculture: operations, reports, and company settings. Cannot manage user accounts.",
        "seed_order": 20,
    },
    {
        "id": "accountant",
        "label": "Accountant (Fuel Station, Shop & Aquaculture)",
        "hint": "Back office: GL, AR/AP, fuel and shop inventory, HR, reports, and aquaculture when enabled.",
        "seed_order": 30,
    },
    {
        "id": "auditor",
        "label": "Auditor (read-only finance)",
        "hint": "View GL, AR/AP, and reports. No POS, user management, or backup.",
        "seed_order": 35,
    },
    {
        "id": "forecourt_supervisor",
        "label": "Forecourt supervisor (Fuel Station)",
        "hint": "Stations, tanks, shifts, tank dips, and operational reports. No shop GL or user management.",
        "seed_order": 40,
    },
    {
        "id": "supervisor",
        "label": "Supervisor (Ponds)",
        "hint": "Pond operations: sampling, feeding, pond costs, fish sales, and aquaculture reports.",
        "seed_order": 50,
    },
    {
        "id": "inventory_clerk",
        "label": "Inventory clerk",
        "hint": "Products, stock, transfers, and inventory reports. No POS or accounting.",
        "seed_order": 60,
    },
    {
        "id": "sales_clerk",
        "label": "Sales clerk (AR/AP desk)",
        "hint": "Customers, vendors, invoices, bills, and payments. No fuel forecourt setup.",
        "seed_order": 70,
    },
    {
        "id": "shopkeeper",
        "label": "Shopkeeper (C-store / shop)",
        "hint": "Shop POS (general merchandise), customers, and product catalog. Assign a site when you have multiple locations.",
        "seed_order": 80,
        "pos_home_station": True,
        "pos_sale_scope": True,
        "default_pos_sale_scope": "general",
    },
    {
        "id": "cashier",
        "label": "Cashier",
        "hint": "Register, customers, and basic reports. Assign a site for multi-location tenants; set fuel/shop lane below.",
        "seed_order": 90,
        "pos_home_station": True,
        "pos_sale_scope": True,
        "default_pos_sale_scope": "both",
    },
    {
        "id": "pump_attendant",
        "label": "Pump attendant (Fuel Station)",
        "hint": "Fuel POS only at an assigned site: new sale and donation on the forecourt register.",
        "seed_order": 100,
        "pos_home_station": True,
        "pos_sale_scope": True,
        "default_pos_sale_scope": "fuel",
        "limited_pos_register": True,
    },
    {
        "id": "operator",
        "label": "Operator (Fuel Station)",
        "hint": "Same as pump attendant: fuel-station POS only at an assigned site.",
        "seed_order": 110,
        "pos_home_station": True,
        "pos_sale_scope": True,
        "default_pos_sale_scope": "fuel",
        "limited_pos_register": True,
    },
    {
        "id": "hr_officer",
        "label": "HR officer",
        "hint": "Employees and payroll only.",
        "seed_order": 120,
    },
]

TENANT_USER_ROLES: frozenset[str] = frozenset(d["id"] for d in TENANT_JOB_TYPE_DEFINITIONS)

TENANT_JOB_TYPE_LABELS: dict[str, str] = {d["id"]: d["label"] for d in TENANT_JOB_TYPE_DEFINITIONS}

ROLES_REQUIRING_HOME_STATION: frozenset[str] = frozenset(
    d["id"] for d in TENANT_JOB_TYPE_DEFINITIONS if d.get("pos_home_station")
)

ROLES_WITH_POS_SALE_SCOPE: frozenset[str] = frozenset(
    d["id"] for d in TENANT_JOB_TYPE_DEFINITIONS if d.get("pos_sale_scope")
)

LIMITED_POS_REGISTER_ROLES: frozenset[str] = frozenset(
    d["id"] for d in TENANT_JOB_TYPE_DEFINITIONS if d.get("limited_pos_register")
)

DEFAULT_POS_SALE_SCOPE_BY_ROLE: dict[str, str] = {
    d["id"]: d.get("default_pos_sale_scope", "both")
    for d in TENANT_JOB_TYPE_DEFINITIONS
    if d.get("pos_sale_scope")
}


def tenant_job_types_for_api() -> list[dict[str, str]]:
    """Job type picker for Users and Roles screens."""
    ordered = sorted(TENANT_JOB_TYPE_DEFINITIONS, key=lambda d: int(d.get("seed_order", 999)))
    return [
        {"value": d["id"], "label": d["label"], "hint": str(d.get("hint") or "")}
        for d in ordered
    ]


def tenant_job_type_seed_keys() -> list[str]:
    """Built-in keys for access-profile seed dropdowns (excludes generic ``user``)."""
    return [d["id"] for d in sorted(TENANT_JOB_TYPE_DEFINITIONS, key=lambda x: int(x.get("seed_order", 999)))]
