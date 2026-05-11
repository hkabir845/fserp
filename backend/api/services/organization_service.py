"""Organization (tenant group) helpers for Company invariants."""
from __future__ import annotations

from api.models import Company, Organization


def ensure_company_organization_shell(
    *,
    name: str,
    legal_name: str = "",
    currency: str = "BDT",
    is_master: str = "true",
) -> tuple[Company, bool]:
    """
    Return a company named ``name`` (not deleted) with a non-null organization.

    If the row exists but predates Organization, attach a new group shell.
    If no row exists, create Organization + Company.

    Returns (company, created_company).
    """
    master = Company.objects.filter(name=name, is_deleted=False).first()
    if master:
        if not master.organization_id:
            org = Organization.objects.create(name=name, legal_name=(legal_name or "")[:200])
            master.organization = org
            master.save(update_fields=["organization_id"])
        if is_master and master.is_master != "true":
            master.is_master = "true"
            master.save(update_fields=["is_master"])
        return master, False
    org = Organization.objects.create(name=name, legal_name=(legal_name or "")[:200])
    c = Company.objects.create(
        name=name,
        legal_name=(legal_name or "")[:200],
        currency=currency,
        is_active=True,
        is_master=is_master,
        is_deleted=False,
        organization=org,
    )
    return c, True
