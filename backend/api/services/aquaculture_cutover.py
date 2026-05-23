"""Go-live cutover date validation (shared by opening balances and operational writes)."""
from __future__ import annotations

from datetime import date

from api.models import Company


def get_stored_cutover_date(company: Company | int) -> date | None:
    if isinstance(company, int):
        company = Company.objects.filter(pk=company).first()
    if not company:
        return None
    return company.aquaculture_go_live_cutover_date


def require_cutover_configured(company_id: int) -> str | None:
    if get_stored_cutover_date(company_id) is None:
        return "Set aquaculture go-live cutover_date before saving opening balances."
    return None


def validate_opening_as_of(company_id: int, as_of: date | None) -> str | None:
    """Opening-balance as-of dates must equal the configured go-live cutover."""
    cutover = get_stored_cutover_date(company_id)
    if cutover is None:
        return require_cutover_configured(company_id)
    if as_of is None:
        return "Opening as-of date is required when aquaculture go-live cutover is configured."
    if as_of != cutover:
        return f"Opening as-of date must equal the go-live cutover date ({cutover.isoformat()})."
    return None


def validate_operational_date(company_id: int, txn_date: date | None) -> str | None:
    """Day-to-day aquaculture activity must be dated strictly after cutover."""
    cutover = get_stored_cutover_date(company_id)
    if cutover is None or txn_date is None:
        return None
    if txn_date <= cutover:
        return (
            f"Transaction date must be after the go-live cutover date ({cutover.isoformat()}). "
            "Use opening-balance workflows for amounts as of cutover."
        )
    return None


def is_go_live_fish_opening(body: dict | None, memo: str = "") -> bool:
    if body and bool(body.get("opening_equity_credit")):
        return True
    m = (memo or (body or {}).get("memo") or "").lower()
    return "go-live" in m or "opening biomass" in m
