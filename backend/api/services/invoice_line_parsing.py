"""Parse and validate invoice line payloads (entity tags + reporting categories)."""

from __future__ import annotations

from typing import Any, Optional

from django.http import JsonResponse

from api.models import AquaculturePond, Item, TenantReportingCategory
from api.services.station_bill_share import parse_optional_line_receipt_station_id
from api.services.tenant_reporting_categories import (
    APP_AQUACULTURE,
    APP_FUEL_STATION,
    KIND_INCOME,
)


def _parse_optional_pond_id(company_id: int, raw) -> tuple[int | None, JsonResponse | None]:
    if raw in (None, "", 0, "0"):
        return None, None
    try:
        pid = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse({"detail": "aquaculture_pond_id must be an integer"}, status=400)
    if pid <= 0:
        return None, None
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
        return None, JsonResponse(
            {"detail": "Unknown aquaculture_pond_id for this company"},
            status=400,
        )
    return pid, None


def _resolve_tenant_reporting_category_id(
    company_id: int,
    *,
    raw_trc_id,
    income_code: str,
    application: str,
) -> tuple[int | None, JsonResponse | None]:
    if raw_trc_id not in (None, "", 0, "0"):
        try:
            tid = int(raw_trc_id)
        except (TypeError, ValueError):
            return None, JsonResponse(
                {"detail": "tenant_reporting_category_id must be an integer"},
                status=400,
            )
        trc = TenantReportingCategory.objects.filter(
            pk=tid,
            company_id=company_id,
            application=application,
            kind=KIND_INCOME,
            is_active=True,
        ).first()
        if not trc:
            return None, JsonResponse(
                {"detail": "tenant_reporting_category_id not found for this company"},
                status=400,
            )
        return int(trc.id), None
    code = (income_code or "").strip()
    if not code:
        return None, None
    trc = TenantReportingCategory.objects.filter(
        company_id=company_id,
        application=application,
        kind=KIND_INCOME,
        code=code,
        is_active=True,
    ).first()
    return (int(trc.id) if trc else None), None


def parse_invoice_line_row(company_id: int, row: dict) -> tuple[Optional[dict[str, Any]], JsonResponse | None]:
    """Normalize one invoice line from API JSON."""
    line_sid, sid_err = parse_optional_line_receipt_station_id(company_id, row)
    if sid_err:
        return None, sid_err

    pond_id, pond_err = _parse_optional_pond_id(company_id, row.get("aquaculture_pond_id"))
    if pond_err:
        return None, pond_err

    if line_sid and pond_id:
        return None, JsonResponse(
            {"detail": "Invoice line cannot tag both a station and a pond."},
            status=400,
        )

    fs_code = (row.get("fuel_station_income_category") or "")[:64]
    aq_code = (row.get("aquaculture_income_category") or "")[:64]
    raw_trc = row.get("tenant_reporting_category_id")

    trc_id: int | None = None
    if pond_id and aq_code:
        trc_id, trc_err = _resolve_tenant_reporting_category_id(
            company_id,
            raw_trc_id=raw_trc,
            income_code=aq_code,
            application=APP_AQUACULTURE,
        )
        if trc_err:
            return None, trc_err
    elif line_sid and fs_code:
        trc_id, trc_err = _resolve_tenant_reporting_category_id(
            company_id,
            raw_trc_id=raw_trc,
            income_code=fs_code,
            application=APP_FUEL_STATION,
        )
        if trc_err:
            return None, trc_err
    elif raw_trc not in (None, "", 0, "0"):
        trc_id, trc_err = _resolve_tenant_reporting_category_id(
            company_id,
            raw_trc_id=raw_trc,
            income_code="",
            application=APP_FUEL_STATION,
        )
        if trc_err:
            return None, trc_err

    item_id = row.get("item_id") or None
    if item_id:
        try:
            iid = int(item_id)
        except (TypeError, ValueError):
            return None, JsonResponse({"detail": "item_id must be an integer"}, status=400)
        if not Item.objects.filter(pk=iid, company_id=company_id, is_deleted=False).exists():
            return None, JsonResponse({"detail": f"Unknown item_id {iid}"}, status=400)
        item_id = iid
    else:
        item_id = None

    return (
        {
            "item_id": item_id,
            "description": (row.get("description") or "")[:300],
            "quantity": row.get("quantity"),
            "unit_price": row.get("unit_price"),
            "amount": row.get("amount"),
            "revenue_account_id": row.get("revenue_account_id"),
            "receipt_station_id": line_sid,
            "aquaculture_pond_id": pond_id,
            "fuel_station_income_category": fs_code,
            "aquaculture_income_category": aq_code,
            "tenant_reporting_category_id": trc_id,
        },
        None,
    )
