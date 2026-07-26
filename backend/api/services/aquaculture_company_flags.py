"""
Effective Aquaculture license/enable flags per company.

Some tenants (e.g. Adib Filling Station) keep Aquaculture permanently available:
flags always read as on, and API updates cannot turn them off.
"""

from __future__ import annotations

from typing import Any

# Stable codes first; name is a fallback for older DBs / renames.
PERMANENT_AQUACULTURE_COMPANY_CODES = frozenset({"FS-000002"})
PERMANENT_AQUACULTURE_COMPANY_NAMES = frozenset({"adib filling station"})


def is_permanent_aquaculture_company(company: Any) -> bool:
    if company is None:
        return False
    code = (getattr(company, "company_code", None) or "").strip().upper()
    if code in PERMANENT_AQUACULTURE_COMPANY_CODES:
        return True
    name = (getattr(company, "name", None) or "").strip().casefold()
    return name in PERMANENT_AQUACULTURE_COMPANY_NAMES


def effective_aquaculture_licensed(company: Any) -> bool:
    return is_permanent_aquaculture_company(company) or bool(
        getattr(company, "aquaculture_licensed", False)
    )


def effective_aquaculture_enabled(company: Any) -> bool:
    return is_permanent_aquaculture_company(company) or bool(
        getattr(company, "aquaculture_enabled", False)
    )


def ensure_permanent_aquaculture_db_flags(company: Any) -> bool:
    """
    Persist licensed+enabled=True for permanent tenants.
    Returns True when the in-memory company was modified (caller should save).
    """
    if not is_permanent_aquaculture_company(company):
        return False
    changed = False
    if not bool(getattr(company, "aquaculture_licensed", False)):
        company.aquaculture_licensed = True
        changed = True
    if not bool(getattr(company, "aquaculture_enabled", False)):
        company.aquaculture_enabled = True
        changed = True
    return changed
