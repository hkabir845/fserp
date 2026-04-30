"""Optional FK to Station for customer/vendor/employee/payroll (company-scoped)."""
from __future__ import annotations

from api.models import Station


def parse_optional_station_fk(company_id: int, raw) -> tuple[int | None, str | None]:
    """
    If raw is null/empty, return (None, None) = clear.
    If invalid or not in company, return (None, error).
    """
    if raw is None or raw == "":
        return None, None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None, "Station id must be a number or null."
    if not Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return None, "Unknown or inactive station for this company."
    return sid, None
