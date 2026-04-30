"""Rules for company station_mode (single vs multi) vs Station.is_active (operating site)."""
from __future__ import annotations

from api.models import Customer, Employee, Station, User, Vendor


def active_station_count(company_id: int) -> int:
    return Station.objects.filter(company_id=company_id, is_active=True).count()


def station_row_count(company_id: int) -> int:
    return Station.objects.filter(company_id=company_id).count()


MIN_ONE_ACTIVE_STATION_DETAIL = (
    "At least one active station is required while this company has station records. "
    "Activate another location first, add a new site with Station active enabled, or deactivate only after "
    "another site is already active."
)


def would_leave_zero_active_stations(company_id: int, *, currently_active: bool, turning_active_off: bool) -> bool:
    """True if applying deactivation to this row would leave the tenant with stations but none active."""
    if not turning_active_off or not currently_active:
        return False
    total = station_row_count(company_id)
    active = active_station_count(company_id)
    if total < 1:
        return False
    return active <= 1


def first_other_active_station_id(company_id: int, exclude_station_id: int) -> int | None:
    return (
        Station.objects.filter(company_id=company_id, is_active=True)
        .exclude(pk=exclude_station_id)
        .order_by("id")
        .values_list("id", flat=True)
        .first()
    )


def repoint_defaults_from_station(company_id: int, from_station_id: int, to_station_id: int) -> None:
    """
    When a site is deactivated, move operational defaults that pointed at it to another active site.
    Historical documents (e.g. invoices) keep their original station_id.
    """
    User.objects.filter(company_id=company_id, home_station_id=from_station_id).update(home_station_id=to_station_id)
    Customer.objects.filter(company_id=company_id, default_station_id=from_station_id).update(
        default_station_id=to_station_id
    )
    Vendor.objects.filter(company_id=company_id, default_station_id=from_station_id).update(
        default_station_id=to_station_id
    )
    Employee.objects.filter(company_id=company_id, home_station_id=from_station_id).update(
        home_station_id=to_station_id
    )


def post_inactive_would_leave_zero_active(company_id: int, wants_active: bool) -> bool:
    """Block POST /stations/ with is_active false when that would be the only row or all would be inactive."""
    if wants_active:
        return False
    n = station_row_count(company_id)
    a = active_station_count(company_id)
    return n == 0 or a == 0


def delete_would_leave_zero_active(company_id: int, station: Station) -> bool:
    """True if deleting this row leaves >=1 station rows but zero active."""
    n = station_row_count(company_id)
    a = active_station_count(company_id)
    after_total = n - 1
    after_active = a - (1 if station.is_active else 0)
    return after_total >= 1 and after_active < 1


def can_set_company_to_single(company_id: int) -> bool:
    """Single-site mode: at most one *active* station. Inactive rows (archived sites) are allowed."""
    return active_station_count(company_id) <= 1


def single_mode_blocks_new_active_station(company_id: int) -> bool:
    """In single mode, at most one active location; you may add inactive rows (history) without limit."""
    return active_station_count(company_id) >= 1
