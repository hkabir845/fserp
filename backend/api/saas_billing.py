"""Canonical SaaS billing plan catalog (platform-level, shared by admin UI and APIs)."""
from __future__ import annotations

from typing import Optional

SAAS_BILLING_PLANS = [
    {
        "code": "starter",
        "name": "Starter",
        "tagline": "Single site, essential ERP",
        "suggested_monthly": 4999,
        "suggested_yearly": 49990,
        "default_cycle": "monthly",
    },
    {
        "code": "growth",
        "name": "Growth",
        "tagline": "Multi-branch operations",
        "suggested_monthly": 14999,
        "suggested_yearly": 149990,
        "default_cycle": "monthly",
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "tagline": "Scale, compliance, SLA",
        "suggested_monthly": 39999,
        "suggested_yearly": 399990,
        "default_cycle": "yearly",
    },
    {
        "code": "platform",
        "name": "Platform",
        "tagline": "White-label & API",
        "suggested_monthly": 89999,
        "suggested_yearly": 899990,
        "default_cycle": "yearly",
    },
    {
        "code": "custom",
        "name": "Custom / Other",
        "tagline": "Contract-based or negotiated pricing",
        "suggested_monthly": 0,
        "suggested_yearly": 0,
        "default_cycle": "monthly",
    },
]


def plan_name_for_code(code: Optional[str]) -> str:
    if not code:
        return ""
    c = str(code).strip().lower()
    for p in SAAS_BILLING_PLANS:
        if p["code"] == c:
            return p["name"]
    return code.replace("_", " ").title()
