"""Reports API: financial and operational reports (company-scoped, tenant-safe)."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from api.models import User
from api.services.permission_service import can_access_report, resolve_user_permissions
from api.services.reporting import (
    parse_report_dates,
    report_balance_sheet,
    report_customer_balances,
    report_daily_summary,
    report_fuel_sales,
    report_income_statement,
    report_inventory_sku_valuation,
    report_meter_readings,
    report_sales_by_nozzle,
    report_shift_summary,
    report_tank_dip_register,
    report_tank_dip_variance,
    report_tank_inventory,
    report_trial_balance,
    report_vendor_balances,
)
from api.utils.auth import auth_required
from api.views.common import require_company_id

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
    "inventory-sku-valuation": report_inventory_sku_valuation,
}


@require_GET
@auth_required
@require_company_id
def report_by_id(request, report_id: str):
    cid = request.company_id
    start, end = parse_report_dates(request)
    api = getattr(request, "api_user", None)
    if api:
        u = User.objects.select_related("custom_role").filter(pk=api.pk).first()
        if u and not can_access_report(resolve_user_permissions(u), report_id):
            return JsonResponse(
                {
                    "detail": "You do not have access to this report.",
                    "report_id": report_id,
                },
                status=403,
            )
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
    payload = handler(cid, start, end)
    return JsonResponse(payload)
