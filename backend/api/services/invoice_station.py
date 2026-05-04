"""Resolve selling / reporting station for invoices and similar documents (company-scoped)."""
from __future__ import annotations

from api.models import Station
from api.services.station_stock import get_or_create_default_station


def parse_valid_station_id(company_id: int, raw) -> int | None:
    """Return active station id for this company, or None if missing/invalid."""
    if raw is None or raw == "":
        return None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    if not Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return None
    return sid


def default_station_id_for_document(company_id: int) -> int:
    """One active site to attach to sales/receipts when the client does not pick a station."""
    st = get_or_create_default_station(company_id)
    return int(st.id)


def resolve_station_id_for_new_invoice(
    company_id: int, body_station_raw, customer_id: int
) -> tuple[int | None, str | None]:
    """
    If the request omits station, use the customer's default operating site (when set),
    otherwise the company default site. Returns (station_id, error_detail or None).
    """
    from api.models import Customer

    sid = parse_valid_station_id(company_id, body_station_raw)
    if body_station_raw is not None and str(body_station_raw).strip() != "" and sid is None:
        return None, "Unknown, inactive, or invalid station_id for this company."
    if sid is not None:
        return int(sid), None
    cust = (
        Customer.objects.filter(id=customer_id, company_id=company_id)
        .only("default_station_id")
        .first()
    )
    if cust and cust.default_station_id:
        if Station.objects.filter(
            pk=cust.default_station_id, company_id=company_id, is_active=True
        ).exists():
            return int(cust.default_station_id), None
    return default_station_id_for_document(company_id), None
