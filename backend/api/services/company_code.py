"""
Stable company reference codes for support, contracts, and SaaS operations.

- Master Filling Station (template / R&D tenant): **FS-000001** — reserved, never derived from row id.
- All other tenants: **FS-{id:06d}** (e.g. FS-000042). Edge case: non-master with id 1 uses **FS-N000001**
  so the reserved code stays exclusive to Master.

Numeric id remains the database primary key; `company_code` is the human-facing reference.
"""

from __future__ import annotations

from typing import Any

# Reserved for the single Master company (is_master=true). Do not auto-assign to other rows.
MASTER_COMPANY_CODE = "FS-000001"


def _is_master_flag(is_master: Any) -> bool:
    if is_master is True:
        return True
    if isinstance(is_master, str):
        return is_master.strip().lower() in ("true", "1", "yes")
    return False


def compute_company_code(*, company_id: int, is_master: Any) -> str:
    """Deterministic code after `company_id` is known (and Master flag)."""
    if _is_master_flag(is_master):
        return MASTER_COMPANY_CODE
    base = f"FS-{company_id:06d}"
    if base == MASTER_COMPANY_CODE:
        return "FS-N000001"
    return base


def resolved_company_code(company) -> str:
    """Prefer stored value; otherwise compute from id + is_master."""
    stored = getattr(company, "company_code", None)
    if stored:
        return str(stored).strip()
    return compute_company_code(company_id=company.id, is_master=getattr(company, "is_master", "false"))


def company_code_for_id(company_id: int) -> str:
    """
    Fallback when only id is known (e.g. orphan FK). Prefer loading the Company row and
    calling resolved_company_code; id 1 may be Master (FS-000001) or a rare non-master edge case.
    """
    return f"FS-{company_id:06d}"
