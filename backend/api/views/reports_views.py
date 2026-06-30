"""Reports API: financial and operational reports (company-scoped, tenant-safe)."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from api.models import Item, User
from api.services.permission_service import can_access_report, resolve_user_permissions
from api.services.reporting import (
    parse_report_dates,
    report_balance_sheet,
    report_ap_aging,
    report_ar_aging,
    report_cash_flow,
    report_customer_balances,
    report_daily_summary,
    report_expense_detail,
    report_income_detail,
    report_fuel_sales,
    report_financial_analytics,
    report_income_statement,
    report_entities_balance_sheet_summary,
    report_entities_financial_summary,
    report_entities_pl_summary,
    report_entities_trial_balance_summary,
    report_ponds_pl_summary,
    report_fuel_stations_pl_summary,
    report_shop_hubs_pl_summary,
    report_stations_financial_summary,
    report_inventory_sku_valuation,
    report_item_master_by_category,
    report_item_purchases_by_category,
    report_item_purchases_custom,
    report_item_purchase_velocity_analysis,
    report_item_sales_by_category,
    report_item_sales_custom,
    report_item_stock_movement,
    report_item_velocity_analysis,
    report_liabilities_detail,
    report_loan_receivable_gl,
    report_loan_payable_gl,
    report_loans_borrow_and_lent,
    report_meter_readings,
    report_drill_invoice_documents,
    report_drill_bill_documents,
    report_sales_by_nozzle,
    report_sales_by_products,
    report_sales_by_station,
    report_sales_report,
    report_purchase_report,
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
    "liabilities-detail": report_liabilities_detail,
    "loan-receivable-gl": report_loan_receivable_gl,
    "loan-payable-gl": report_loan_payable_gl,
    "loans-borrow-and-lent": report_loans_borrow_and_lent,
    "customer-balances": report_customer_balances,
    "vendor-balances": report_vendor_balances,
    "ar-aging": report_ar_aging,
    "ap-aging": report_ap_aging,
    "cash-flow": report_cash_flow,
    "expense-detail": report_expense_detail,
    "income-detail": report_income_detail,
    "entities-pl-summary": report_entities_pl_summary,
    "entities-balance-sheet-summary": report_entities_balance_sheet_summary,
    "entities-trial-balance-summary": report_entities_trial_balance_summary,
    "entities-financial-summary": report_entities_financial_summary,
    "stations-financial-summary": report_stations_financial_summary,
    "fuel-stations-pl-summary": report_fuel_stations_pl_summary,
    "shop-hubs-pl-summary": report_shop_hubs_pl_summary,
    "ponds-pl-summary": report_ponds_pl_summary,
    "fuel-sales": report_fuel_sales,
    "tank-inventory": report_tank_inventory,
    "shift-summary": report_shift_summary,
    "sales-by-nozzle": report_sales_by_nozzle,
    "sales-by-products": report_sales_by_products,
    "tank-dip-variance": report_tank_dip_variance,
    "tank-dip-register": report_tank_dip_register,
    "meter-readings": report_meter_readings,
    "daily-summary": report_daily_summary,
    "sales-by-station": report_sales_by_station,
    "sales-report": report_sales_report,
    "purchase-report": report_purchase_report,
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
        "liabilities-detail",
        "loan-receivable-gl",
        "loan-payable-gl",
        "loans-borrow-and-lent",
        "cash-flow",
        "expense-detail",
        "income-detail",
    }
)

GL_POND_AWARE_REPORTS = frozenset(
    {
        "trial-balance",
        "income-statement",
        "balance-sheet",
        "expense-detail",
        "income-detail",
        "cash-flow",
    }
)

# AR/AP subledger reports: optional station filter on invoices/bills (not GL line tags).
SUBLEDGER_STATION_AWARE_REPORTS = frozenset(
    {
        "customer-balances",
        "vendor-balances",
        "ar-aging",
        "ap-aging",
    }
)


def _parse_report_pond_id(request, company_id: int):
    """Optional pond filter for GL P&L reports (mutually exclusive with station_id in callers)."""
    from api.models import AquaculturePond

    raw = (request.GET.get("pond_id") or "").strip()
    if not raw or raw.lower() in ("0", "all", "none"):
        return None, None
    try:
        pond_id = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse(
            {"detail": "pond_id must be a positive integer, or omit for all ponds."},
            status=400,
        )
    if pond_id <= 0:
        return None, None
    if not AquaculturePond.objects.filter(
        pk=pond_id, company_id=company_id, is_active=True
    ).exists():
        return None, JsonResponse(
            {"detail": "Unknown or inactive pond_id for this company."},
            status=400,
        )
    return pond_id, None


AQUACULTURE_REPORT_IDS = frozenset(
    {
        "aquaculture-pond-pl",
        "aquaculture-fish-sales",
        "aquaculture-pond-sales-comprehensive",
        "aquaculture-expenses",
        "aquaculture-sampling",
        "aquaculture-production-cycles",
        "aquaculture-profit-transfers",
        "aquaculture-fish-transfers",
        "aquaculture-fingerling-transfers",
        "aquaculture-pond-feed-stock",
        "aquaculture-pond-medicine-stock",
        "aquaculture-pond-supplies-stock",
        "aquaculture-fish-stock-position",
        "aquaculture-fish-stock-breakdown",
        "aquaculture-fish-biomass-movements",
        "aquaculture-fish-stock-adjustments",
        "aquaculture-biological-asset-ledger",
        "aquaculture-fcr-biomass",
        "aquaculture-fish-growth",
        "aquaculture-pond-performance",
        "aquaculture-shop-station-stock",
        "aquaculture-equipment-assets",
        "aquaculture-pond-total-inventory",
    }
)


STATION_SCOPED_REPORTS = frozenset(
    {
        "fuel-sales",
        "tank-inventory",
        "shift-summary",
        "daily-summary",
        "sales-by-station",
        "sales-report",
        "purchase-report",
        "sales-by-nozzle",
        "sales-by-products",
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

    if report_id == "inventory-sku-valuation":
        category, item_ids, err = _parse_item_scope_query(request, cid)
        if err:
            return err
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        return JsonResponse(
            report_inventory_sku_valuation(cid, start, end, st_id, category, item_ids)
        )

    if report_id in AQUACULTURE_REPORT_IDS:
        from api.services.aquaculture_reports_registry import build_aquaculture_report

        out = build_aquaculture_report(report_id, cid, start, end, request)
        if isinstance(out, JsonResponse):
            return out
        return JsonResponse(out)

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
    if report_id == "financial-analytics":
        from api.models import AquaculturePond

        raw_pond = (request.GET.get("pond_id") or "").strip()
        pond_id: int | None = None
        if raw_pond and raw_pond.lower() not in ("0", "all", "none"):
            try:
                pond_id = int(raw_pond)
            except (TypeError, ValueError):
                return JsonResponse(
                    {"detail": "pond_id must be a positive integer, or omit for all ponds."},
                    status=400,
                )
            if pond_id <= 0:
                pond_id = None
            elif not AquaculturePond.objects.filter(
                pk=pond_id, company_id=cid, is_active=True
            ).exists():
                return JsonResponse(
                    {"detail": "Unknown or inactive pond_id for this company."},
                    status=400,
                )
        st_id: int | None = None
        if pond_id is None:
            st_id, st_err = effective_report_station_id(request, cid)
            if st_err:
                return st_err
        payload = report_financial_analytics(cid, start, end, st_id, pond_id)
    elif report_id in ("sales-report", "purchase-report", "daily-summary"):
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        segment = (request.GET.get("business_segment") or "all").strip().lower()
        if segment not in ("all", "fuel", "aquaculture", ""):
            return JsonResponse(
                {"detail": "business_segment must be all, fuel, or aquaculture."},
                status=400,
            )
        if report_id == "sales-report":
            payload = report_sales_report(
                cid, start, end, st_id, business_segment=segment or "all"
            )
        elif report_id == "purchase-report":
            payload = report_purchase_report(
                cid, start, end, st_id, business_segment=segment or "all"
            )
        else:
            payload = report_daily_summary(
                cid, start, end, st_id, business_segment=segment or "all"
            )
    elif report_id in STATION_SCOPED_REPORTS:
        st_id, st_err = effective_report_station_id(request, cid)
        if st_err:
            return st_err
        payload = handler(cid, start, end, st_id)
    elif report_id in SUBLEDGER_STATION_AWARE_REPORTS:
        pond_id, pond_err = _parse_report_pond_id(request, cid)
        if pond_err:
            return pond_err
        if pond_id is None:
            st_id, st_err = effective_report_station_id(request, cid)
            if st_err:
                return st_err
        else:
            st_id = None
        payload = handler(cid, start, end, station_id=st_id, pond_id=pond_id)
    elif report_id in GL_STATION_AWARE_REPORTS:
        pond_id, pond_err = _parse_report_pond_id(request, cid)
        if pond_err:
            return pond_err
        if pond_id is None:
            st_id, st_err = effective_report_station_id(request, cid)
            if st_err:
                return st_err
        else:
            st_id = None
        if report_id in GL_POND_AWARE_REPORTS:
            payload = handler(cid, start, end, st_id, pond_id=pond_id)
        elif report_id == "loans-borrow-and-lent":
            strict = (request.GET.get("strict_site") or "").strip().lower() in (
                "1",
                "true",
                "yes",
            )
            payload = report_loans_borrow_and_lent(
                cid, start, end, st_id, strict_site=strict
            )
        else:
            payload = handler(cid, start, end, st_id)
    else:
        payload = handler(cid, start, end)
    return JsonResponse(payload)


@require_GET
@auth_required
@require_company_id
def report_drill_invoices(request):
    cid = request.company_id
    start, end = parse_report_dates(request)
    try:
        customer_id = int(request.GET.get("customer_id") or 0)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "customer_id required"}, status=400)
    if customer_id <= 0:
        return JsonResponse({"detail": "customer_id required"}, status=400)
    st_id, st_err = effective_report_station_id(request, cid)
    if st_err:
        return st_err
    return JsonResponse(
        report_drill_invoice_documents(cid, customer_id, start, end, station_id=st_id)
    )


@require_GET
@auth_required
@require_company_id
def report_drill_bills(request):
    cid = request.company_id
    start, end = parse_report_dates(request)
    try:
        vendor_id = int(request.GET.get("vendor_id") or 0)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "vendor_id required"}, status=400)
    if vendor_id <= 0:
        return JsonResponse({"detail": "vendor_id required"}, status=400)
    st_id, st_err = effective_report_station_id(request, cid)
    if st_err:
        return st_err
    return JsonResponse(report_drill_bill_documents(cid, vendor_id, start, end, station_id=st_id))
