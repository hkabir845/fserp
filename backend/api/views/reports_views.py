"""Reports API: financial and operational reports (company-scoped, tenant-safe)."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from api.models import Item, User
from api.services.permission_service import can_access_report, resolve_user_permissions
from api.services.reporting import (
    parse_report_dates,
    report_balance_sheet,
    report_customer_balances,
    report_daily_summary,
    report_fuel_sales,
    report_financial_analytics,
    report_income_statement,
    report_inventory_sku_valuation,
    report_item_master_by_category,
    report_item_purchases_by_category,
    report_item_purchases_custom,
    report_item_purchase_velocity_analysis,
    report_item_sales_by_category,
    report_item_sales_custom,
    report_item_stock_movement,
    report_item_velocity_analysis,
    report_meter_readings,
    report_sales_by_nozzle,
    report_sales_by_station,
    report_shift_summary,
    report_tank_dip_register,
    report_tank_dip_variance,
    report_tank_inventory,
    report_trial_balance,
    report_vendor_balances,
)
from api.utils.auth import auth_required
from api.views.common import require_company_id
from api.services.station_scope import effective_report_station_id

_REPORT_HANDLERS = {
    "trial-balance": report_trial_balance,
    "balance-sheet": report_balance_sheet,
    "income-statement": report_income_statement,
    "customer-balances": report_customer_balances,
    "vendor-balances": report_vendor_balances,
    "fuel-sales": report_fuel_sales,
    "tank-inventory": report_tank_inventory,
    "shift-summary": report_shift_summary,
    "sales-by-nozzle": report_sales_by_nozzle,
    "tank-dip-variance": report_tank_dip_variance,
    "tank-dip-register": report_tank_dip_register,
    "meter-readings": report_meter_readings,
    "daily-summary": report_daily_summary,
    "sales-by-station": report_sales_by_station,
    "financial-analytics": report_financial_analytics,
    "inventory-sku-valuation": report_inventory_sku_valuation,
    "item-master-by-category": report_item_master_by_category,
    "item-sales-by-category": report_item_sales_by_category,
    "item-purchases-by-category": report_item_purchases_by_category,
}


def _parse_item_scope_query(request, company_id: int):
    """
    category + optional item_ids (comma-separated) or legacy single item_id.
    Returns (category_or_None, item_ids_or_None, error_JsonResponse_or_None).
    """
    raw = (request.GET.get("item_ids") or "").strip()
    item_ids: list[int] | None = None
    if raw:
        item_ids = []
        for part in raw.split(","):
            p = part.strip()
            if not p:
                continue
            try:
                item_ids.append(int(p))
            except ValueError:
                return None, None, JsonResponse(
                    {"detail": "item_ids must be a comma-separated list of integers (e.g. 1,2,5)."},
                    status=400,
                )
        # dedupe preserve order
        item_ids = list(dict.fromkeys(item_ids))
    else:
        legacy = request.GET.get("item_id")
        if legacy is not None and str(legacy).strip() != "":
            try:
                item_ids = [int(legacy)]
            except (TypeError, ValueError):
                return None, None, JsonResponse(
                    {"detail": "item_id must be an integer."},
                    status=400,
                )
    if item_ids:
        found = set(
            Item.objects.filter(company_id=company_id, id__in=item_ids).values_list("id", flat=True)
        )
        if set(item_ids) != found:
            return None, None, JsonResponse(
                {"detail": "One or more item_ids are not products in this company."},
                status=400,
            )
    category = (request.GET.get("category") or "").strip() or None
    return category, item_ids, None


# Financial reports that honor ``station_id`` / home station on posted GL lines (trial balance, P&L, BS).
GL_STATION_AWARE_REPORTS = frozenset(
    {
        "trial-balance",
        "balance-sheet",
        "income-statement",
        "financial-analytics",
    }
)

STATION_SCOPED_REPORTS = frozenset(
    {
        "fuel-sales",
        "tank-inventory",
        "shift-summary",
        "daily-summary",
        "sales-by-station",
        "sales-by-nozzle",
        "meter-readings",
        "tank-dip-variance",
        "tank-dip-register",
        "inventory-sku-valuation",
        "item-master-by-category",
        "item-sales-by-category",
        "item-purchases-by-category",
        "item-sales-custom",
        "item-purchases-custom",
        "item-stock-movement",
        "item-velocity-analysis",
        "item-purchase-velocity-analysis",
    }
)


@require_GET
@auth_required
@require_company_id
def report_by_id(request, report_id: str):
    cid = request.company_id
    start, end = parse_report_dates(request)
    api = getattr(request, "api_user", None)
    if api:
        u = User.objects.select_related("custom_role", "home_station").filter(pk=api.pk).first()
        if u and not can_access_report(resolve_user_permissions(u), report_id):
            return JsonResponse(
                {
                    "detail": "You do not have access to this report.",
                    "report_id": report_id,
                },
                status=403,
            )
    if report_id == "item-sales-custom":
        category, item_ids, err = _parse_item_scope_query(request, cid)
        if err:
            return err
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        payload = report_item_sales_custom(cid, start, end, category, None, item_ids, st_id)
        return JsonResponse(payload)

    if report_id == "item-purchases-custom":
        category, item_ids, err = _parse_item_scope_query(request, cid)
        if err:
            return err
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        return JsonResponse(report_item_purchases_custom(cid, start, end, category, None, item_ids, st_id))

    if report_id in ("item-stock-movement", "item-velocity-analysis", "item-purchase-velocity-analysis"):
        category, item_ids, err = _parse_item_scope_query(request, cid)
        if err:
            return err
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        if report_id == "item-stock-movement":
            return JsonResponse(report_item_stock_movement(cid, start, end, category, item_ids, st_id))
        if report_id == "item-purchase-velocity-analysis":
            return JsonResponse(
                report_item_purchase_velocity_analysis(cid, start, end, category, item_ids, st_id)
            )
        return JsonResponse(report_item_velocity_analysis(cid, start, end, category, item_ids, st_id))

    handler = _REPORT_HANDLERS.get(report_id)
    if not handler:
        return JsonResponse(
            {
                "report_id": report_id,
                "detail": "Unknown report",
                "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
                "data": [],
                "summary": {},
            },
            status=404,
        )
    if report_id in STATION_SCOPED_REPORTS:
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        payload = handler(cid, start, end, st_id)
    elif report_id in GL_STATION_AWARE_REPORTS:
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        payload = handler(cid, start, end, st_id)
    else:
        payload = handler(cid, start, end)
    return JsonResponse(payload)
