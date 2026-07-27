"""
Built-in tenant job types (User.role) — labels, hints, and validation.

Custom access profiles (CompanyRole) override these defaults when assigned.
CompanyJobType rows add custom titles and optional per-job-type access-profile allowlists.
"""
from __future__ import annotations

import re
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

_JOB_TYPE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


def normalize_job_type_key(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def is_valid_job_type_key(key: str) -> bool:
    return bool(_JOB_TYPE_KEY_RE.match(key or ""))


def slugify_job_type_key(label: str) -> str:
    raw = normalize_job_type_key(label)
    raw = re.sub(r"[^a-z0-9_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        return ""
    if raw[0].isdigit():
        raw = f"jt_{raw}"
    return raw[:64]


def tenant_job_types_for_api(company_id: int | None = None) -> list[dict[str, Any]]:
    """Job type picker for Users and Roles screens (built-ins + company custom / overrides)."""
    ordered = sorted(TENANT_JOB_TYPE_DEFINITIONS, key=lambda d: int(d.get("seed_order", 999)))
    by_key: dict[str, dict[str, Any]] = {
        d["id"]: {
            "value": d["id"],
            "label": d["label"],
            "hint": str(d.get("hint") or ""),
            "is_custom": False,
            "inherits_from": d["id"],
            "access_profile_enabled": False,
            "allowed_role_ids": [],
            "company_job_type_id": None,
            "is_active": True,
            "sort_order": int(d.get("seed_order", 999)),
        }
        for d in ordered
    }

    if company_id:
        try:
            from api.models import CompanyJobType

            rows = (
                CompanyJobType.objects.filter(company_id=int(company_id), is_active=True)
                .prefetch_related("allowed_roles")
                .order_by("sort_order", "label")
            )
            for jt in rows:
                key = normalize_job_type_key(jt.key)
                if not key:
                    continue
                allowed_ids = [int(r.id) for r in jt.allowed_roles.all()]
                base = by_key.get(key)
                if base is not None and not jt.is_custom:
                    base["label"] = jt.label or base["label"]
                    base["hint"] = jt.hint or base["hint"]
                    base["access_profile_enabled"] = bool(jt.access_profile_enabled)
                    base["allowed_role_ids"] = allowed_ids
                    base["company_job_type_id"] = jt.id
                    base["sort_order"] = int(jt.sort_order or base["sort_order"])
                    continue
                by_key[key] = {
                    "value": key,
                    "label": jt.label or key,
                    "hint": jt.hint or "",
                    "is_custom": bool(jt.is_custom),
                    "inherits_from": normalize_job_type_key(jt.inherits_from) or "",
                    "access_profile_enabled": bool(jt.access_profile_enabled),
                    "allowed_role_ids": allowed_ids,
                    "company_job_type_id": jt.id,
                    "is_active": bool(jt.is_active),
                    "sort_order": int(jt.sort_order or 200),
                }
        except Exception:
            pass

    return sorted(by_key.values(), key=lambda r: (int(r.get("sort_order") or 999), str(r.get("label") or "")))


def tenant_job_type_seed_keys() -> list[str]:
    """Built-in keys for access-profile seed dropdowns (excludes generic ``user``)."""
    return [d["id"] for d in sorted(TENANT_JOB_TYPE_DEFINITIONS, key=lambda x: int(x.get("seed_order", 999)))]


def company_custom_job_type_keys(company_id: int | None) -> frozenset[str]:
    if not company_id:
        return frozenset()
    try:
        from api.models import CompanyJobType

        keys = CompanyJobType.objects.filter(
            company_id=int(company_id), is_active=True, is_custom=True
        ).values_list("key", flat=True)
        return frozenset(normalize_job_type_key(k) for k in keys if k)
    except Exception:
        return frozenset()


def is_allowed_tenant_role(role: str | None, company_id: int | None = None) -> bool:
    """True when role is a built-in job type or an active custom job type for the company."""
    rk = normalize_job_type_key(role)
    if not rk:
        return False
    if rk in TENANT_USER_ROLES:
        return True
    return rk in company_custom_job_type_keys(company_id)


def effective_builtin_role_key(role: str | None, company_id: int | None = None) -> str:
    """
    Resolve POS / default-permission behavior to a built-in job type key.
    Custom company job types inherit from ``inherits_from`` when set.
    """
    rk = normalize_job_type_key(role)
    if rk in TENANT_USER_ROLES:
        return rk
    if company_id and rk:
        try:
            from api.models import CompanyJobType

            jt = (
                CompanyJobType.objects.filter(company_id=int(company_id), key=rk, is_active=True)
                .only("inherits_from")
                .first()
            )
            if jt:
                inh = normalize_job_type_key(jt.inherits_from)
                if inh in TENANT_USER_ROLES:
                    return inh
        except Exception:
            pass
    return rk


def get_company_job_type(company_id: int | None, role: str | None):
    """Return CompanyJobType row for this company+role, or None."""
    if not company_id:
        return None
    rk = normalize_job_type_key(role)
    if not rk:
        return None
    try:
        from api.models import CompanyJobType

        return (
            CompanyJobType.objects.filter(company_id=int(company_id), key=rk, is_active=True)
            .prefetch_related("allowed_roles")
            .first()
        )
    except Exception:
        return None


def approve_access_profile_for_job_type(
    company_id: int | None, job_type_key: str | None, role_id: int
) -> bool:
    """
    If the job type already uses a non-empty access-profile allow-list, add ``role_id`` to it.
    Does not create a new allow-list from an empty one (that would suddenly restrict the job type).
    Returns True when the role was (or already is) approved.
    """
    if not company_id or not job_type_key or not role_id:
        return False
    jt = get_company_job_type(company_id, job_type_key)
    if not jt or not jt.access_profile_enabled:
        return False
    from api.models import CompanyRole

    cr = CompanyRole.objects.filter(pk=int(role_id), company_id=int(company_id)).first()
    if not cr:
        return False
    if jt.allowed_roles.filter(pk=cr.pk).exists():
        return True
    # Only extend an existing allow-list; never turn "enabled but empty" into a restriction.
    if not jt.allowed_roles.exists():
        return False
    jt.allowed_roles.add(cr)
    return True


def validate_access_profile_for_job_type(user) -> str | None:
    """
    When access profiles are enabled for the user's job type and approved roles are set,
    require the user's custom_role to be one of those approved profiles.
    Returns an error message or None.
    """
    if not user:
        return None
    cid = getattr(user, "company_id", None)
    jt = get_company_job_type(cid, getattr(user, "role", None))
    if not jt or not jt.access_profile_enabled:
        return None
    allowed = list(jt.allowed_roles.all())
    if not allowed:
        # Enabled but no profiles selected yet — do not break existing assignments.
        return None
    allowed_ids = {int(r.id) for r in allowed}
    cr_id = getattr(user, "custom_role_id", None)
    if cr_id is None:
        return "An approved access profile is required for this job type."
    if int(cr_id) not in allowed_ids:
        return "The selected access profile is not approved for this job type."
    return None
