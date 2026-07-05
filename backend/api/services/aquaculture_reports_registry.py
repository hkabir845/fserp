"""
Aquaculture report payloads for GET /api/reports/<report_id>/ (Reports module).
All monetary amounts are BDT for display consistency (currency_code on payload).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from django.db import models

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    Company,
    Invoice,
    InvoiceLine,
    Item,
    ItemStationStock,
    Station,
)
from api.services.aquaculture_constants import (
    STOCK_LEDGER_ENTRY_KIND_LABELS,
    STOCK_LEDGER_LOSS_REASON_LABELS,
    fish_species_display_label,
)
from api.services.aquaculture_fcr_service import fcr_period_summary_block
from api.services.aquaculture_biological_asset_service import (
    compute_biological_asset_ledger_rows,
    compute_biological_asset_portfolio,
    compute_pond_biological_asset_summary,
)
from api.services.aquaculture_fish_biomass_ledger_service import compute_fish_biomass_ledger_rows
from api.services.aquaculture_growth_service import build_fish_growth_report
from api.services.aquaculture_pond_consumption_ledger_service import (
    compute_pond_warehouse_consumption_rows,
)
from api.services.aquaculture_pond_performance_service import build_pond_performance_report
from api.services.aquaculture_pond_stock_service import pond_warehouse_stock_matrix
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)
from api.services.gl_posting import item_inventory_unit_cost
from api.services.station_stock import item_uses_station_bins
from api.services.tenant_reporting_categories import aquaculture_expense_label, aquaculture_income_label
from api.services.reporting import _is_fuel_line
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.permission_service import user_may_access_aquaculture_api
from api.services.report_i18n import (
    note_equipment_assets,
    note_expenses_station_scope,
    note_fish_biomass_movements,
    note_fish_stock_adjustments,
    note_feed_medicine_consumption,
    note_fish_stock_breakdown,
    note_fish_stock_position,
    note_pond_sales_comprehensive,
    note_pond_total_inventory,
    note_pond_warehouse_stock,
    note_sampling,
    note_shop_station_stock,
)
from django.http import HttpRequest, JsonResponse


BDT = "BDT"


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _decimal(s: str) -> Decimal:
    try:
        return Decimal(str(s))
    except Exception:
        return Decimal("0")


def _fish_per_kg_from_count_weight(count: int | None, weight_kg) -> str:
    if count is None or count <= 0 or weight_kg is None:
        return ""
    w = _decimal(str(weight_kg))
    if w <= 0:
        return ""
    return str((Decimal(count) / w).quantize(Decimal("0.01")))


def _pond_filter(company_id: int, raw: str | None) -> tuple[int | None, JsonResponse | None]:
    if not raw or not str(raw).strip().isdigit():
        return None, None
    pid = int(raw)
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
        return None, JsonResponse({"detail": "Pond not found"}, status=404)
    return pid, None


def _cycle_filter(company_id: int, raw: str | None) -> tuple[int | None, AquacultureProductionCycle | None, JsonResponse | None]:
    if not raw or not str(raw).strip().isdigit():
        return None, None, None
    cid = int(raw)
    cyc = AquacultureProductionCycle.objects.filter(pk=cid, company_id=company_id).first()
    if not cyc:
        return None, None, JsonResponse({"detail": "Production cycle not found"}, status=404)
    return cid, cyc, None


def aquaculture_gate(company_id: int, user) -> JsonResponse | None:
    c = Company.objects.filter(pk=company_id).only("aquaculture_enabled").first()
    if not c or not getattr(c, "aquaculture_enabled", False):
        return JsonResponse(
            {"detail": "Aquaculture is not enabled for this company."},
            status=403,
        )
    if not user_may_access_aquaculture_api(user):
        return JsonResponse(
            {"detail": "Aquaculture reports require Admin or app.aquaculture permission for this tenant."},
            status=403,
        )
    return None


def _period_block(start: date, end: date) -> dict[str, str]:
    return {"start_date": start.isoformat(), "end_date": end.isoformat()}


def _attach_fcr_to_report(
    payload: dict[str, Any],
    company_id: int,
    start: date,
    end: date,
    request: HttpRequest,
) -> dict[str, Any]:
    """Add standard FCR + feed block to date-range aquaculture reports."""
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return payload
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return payload
    payload["fcr"] = fcr_period_summary_block(
        company_id,
        start,
        end,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
    )
    return payload


def build_aquaculture_report(
    report_id: str, company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    user = getattr(request, "api_user", None)
    gate = aquaculture_gate(company_id, user)
    if gate:
        return gate

    payload: dict[str, Any] | JsonResponse | None = None
    if report_id == "aquaculture-pond-pl":
        payload = _report_pond_pl(company_id, start, end, request)
    elif report_id == "aquaculture-fish-sales":
        payload = _report_fish_sales(company_id, start, end, request)
    elif report_id == "aquaculture-pond-sales-comprehensive":
        payload = _report_pond_sales_comprehensive(company_id, start, end, request)
    elif report_id == "aquaculture-expenses":
        payload = _report_expenses(company_id, start, end, request)
    elif report_id == "aquaculture-feed-medicine-consumption":
        payload = _report_feed_medicine_consumption(company_id, start, end, request)
    elif report_id == "aquaculture-sampling":
        payload = _report_sampling(company_id, start, end, request)
    elif report_id == "aquaculture-production-cycles":
        payload = _report_production_cycles(company_id, start, end, request)
    elif report_id == "aquaculture-profit-transfers":
        payload = _report_profit_transfers(company_id, start, end, request)
    elif report_id == "aquaculture-fish-transfers":
        payload = _report_fish_transfers(company_id, start, end, request)
    elif report_id == "aquaculture-fingerling-transfers":
        payload = _report_fingerling_transfers(company_id, start, end, request)
    elif report_id == "aquaculture-pond-feed-stock":
        payload = _report_pond_warehouse_stock(company_id, end, request, stock_kind="feed")
    elif report_id == "aquaculture-pond-medicine-stock":
        payload = _report_pond_warehouse_stock(company_id, end, request, stock_kind="medicine")
    elif report_id == "aquaculture-pond-supplies-stock":
        payload = _report_pond_warehouse_stock(company_id, end, request, stock_kind="supplies")
    elif report_id == "aquaculture-fish-stock-position":
        payload = _report_fish_stock_position(company_id, end, request)
    elif report_id == "aquaculture-fish-stock-breakdown":
        payload = _report_fish_stock_breakdown(company_id, end, request)
    elif report_id == "aquaculture-fish-biomass-movements":
        payload = _report_fish_biomass_movements(company_id, start, end, request)
    elif report_id == "aquaculture-fish-stock-adjustments":
        payload = _report_fish_stock_adjustments(company_id, start, end, request)
    elif report_id == "aquaculture-shop-station-stock":
        payload = _report_shop_station_stock(company_id, end, request)
    elif report_id == "aquaculture-equipment-assets":
        payload = _report_equipment_assets(company_id, start, end, request)
    elif report_id == "aquaculture-pond-total-inventory":
        payload = _report_pond_total_inventory(company_id, end, request)
    elif report_id == "aquaculture-fcr-biomass":
        payload = _report_fcr_biomass(company_id, start, end, request)
    elif report_id == "aquaculture-fish-growth":
        payload = _report_fish_growth(company_id, start, end, request)
    elif report_id == "aquaculture-pond-performance":
        payload = _report_pond_performance(company_id, start, end, request)
    elif report_id == "aquaculture-biological-asset-ledger":
        payload = _report_biological_asset_ledger(company_id, start, end, request)
    else:
        return JsonResponse({"detail": "Unknown aquaculture report"}, status=404)

    if isinstance(payload, JsonResponse):
        return payload
    if isinstance(payload, dict):
        payload.setdefault("report_id", report_id)
        date_range_reports = {
            "aquaculture-pond-pl",
            "aquaculture-fish-sales",
            "aquaculture-pond-sales-comprehensive",
            "aquaculture-expenses",
            "aquaculture-feed-medicine-consumption",
            "aquaculture-sampling",
            "aquaculture-production-cycles",
            "aquaculture-profit-transfers",
            "aquaculture-fish-transfers",
            "aquaculture-fingerling-transfers",
            "aquaculture-equipment-assets",
            "aquaculture-fish-stock-position",
            "aquaculture-fish-stock-breakdown",
            "aquaculture-fish-biomass-movements",
            "aquaculture-fish-stock-adjustments",
            "aquaculture-biological-asset-ledger",
        }
        if report_id in date_range_reports:
            _attach_fcr_to_report(payload, company_id, start, end, request)
    return payload


def _classify_item_stock_kind(item: Item | None) -> str:
    """feed | medicine | fish | supplies — for pond warehouse and shop stock reports."""
    if not item:
        return "supplies"
    pc = (getattr(item, "pos_category", None) or "").strip().lower()
    if pc == "feed":
        return "feed"
    if pc == "medicine":
        return "medicine"
    if pc == "fish":
        return "fish"
    cat = (getattr(item, "category", None) or "").strip().lower()
    name = (getattr(item, "name", None) or "").strip().lower()
    blob = f"{cat} {name}"
    if "medicine" in blob or "vaccin" in blob or "veterinar" in blob:
        return "medicine"
    if "fuel" in pc or "fuel" in cat:
        return "fuel"
    return "supplies"


def _is_fuel_item(item: Item | None) -> bool:
    if not item:
        return False
    pc = (getattr(item, "pos_category", None) or "").strip().lower()
    cat = (getattr(item, "category", None) or "").strip().lower()
    return "fuel" in pc or "fuel" in cat


def _report_pond_warehouse_stock(
    company_id: int, as_of: date, request: HttpRequest, *, stock_kind: str
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    matrix = pond_warehouse_stock_matrix(company_id, pond_id=pond_filter_id)
    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    grand_qty = Decimal("0")
    grand_val = Decimal("0")
    grand_lines = 0
    for row in matrix:
        item_id = int(row["item_id"])
        it = Item.objects.filter(pk=item_id, company_id=company_id).first()
        kind = _classify_item_stock_kind(it)
        if kind == "fish":
            continue
        if kind != stock_kind:
            continue
        pid = int(row["pond_id"])
        qty = _decimal(row["quantity"])
        uc = _decimal(row.get("unit_cost") or "0")
        ext = _money_q(qty * uc)
        grand_qty += qty
        grand_val += ext
        grand_lines += 1
        pond_names[pid] = row.get("pond_name") or f"Pond #{pid}"
        line = {
            "item_id": item_id,
            "item_name": row.get("item_name") or "",
            "unit": row.get("unit") or "unit",
            "quantity": row.get("quantity") or "0",
            "unit_cost": row.get("unit_cost") or "0",
            "extended_value": str(ext),
            "reporting_category": row.get("reporting_category") or "",
            "pos_category": row.get("pos_category") or "",
            "content_weight_kg": row.get("content_weight_kg"),
        }
        by_pond[pid].append(line)

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_qty = sum((_decimal(l["quantity"]) for l in lines), Decimal("0"))
        sub_val = _money_q(sum((_decimal(l["extended_value"]) for l in lines), Decimal("0")))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_quantity": str(sub_qty),
                "subtotal_value": str(sub_val),
                "line_count": len(lines),
            }
        )

    kind_labels = {
        "feed": "Feed",
        "medicine": "Medicine",
        "supplies": "Supplies & other pond warehouse",
    }
    summary = {
        "stock_kind": stock_kind,
        "stock_kind_label": kind_labels.get(stock_kind, stock_kind),
        "as_of_date": as_of.isoformat(),
        "line_count": grand_lines,
        "pond_group_count": len(groups),
        "total_quantity": float(grand_qty),
        "total_value_bdt": float(_money_q(grand_val)),
    }
    return {
        "period": {"start_date": as_of.isoformat(), "end_date": as_of.isoformat()},
        "as_of_date": as_of.isoformat(),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "line_count": grand_lines,
            "total_quantity": str(grand_qty),
            "total_value": str(_money_q(grand_val)),
        },
        "accounting_note": note_pond_warehouse_stock(company_id),
    }


def _report_fish_stock_position(
    company_id: int, as_of: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_filter_id,
        include_inactive_ponds=False,
    )
    groups: list[dict[str, Any]] = []
    total_kg = Decimal("0")
    total_count = 0
    for r in rows:
        kg = _decimal(r.get("implied_net_weight_kg") or "0")
        cnt = int(r.get("implied_net_fish_count") or 0)
        total_kg += kg
        total_count += cnt
        groups.append(
            {
                "pond_id": r.get("pond_id"),
                "pond_name": r.get("pond_name") or "",
                "lines": [
                    {
                        "pond_role": r.get("pond_role"),
                        "implied_net_weight_kg": r.get("implied_net_weight_kg"),
                        "implied_net_fish_count": r.get("implied_net_fish_count"),
                        "transfer_in_weight_kg": r.get("transfer_in_weight_kg"),
                        "transfer_out_weight_kg": r.get("transfer_out_weight_kg"),
                        "vendor_bill_in_weight_kg": r.get("vendor_bill_in_weight_kg"),
                        "vendor_bill_in_fish_count": r.get("vendor_bill_in_fish_count"),
                        "stocked_weight_kg": r.get("stocked_weight_kg"),
                        "stocked_fish_count": r.get("stocked_fish_count"),
                        "mortality_weight_kg": r.get("mortality_weight_kg"),
                        "mortality_fish_count": r.get("mortality_fish_count"),
                        "other_adjustment_weight_kg": r.get("other_adjustment_weight_kg"),
                        "other_adjustment_fish_count": r.get("other_adjustment_fish_count"),
                        "sale_weight_kg": r.get("sale_weight_kg"),
                        "sale_fish_count": r.get("sale_fish_count"),
                        "ledger_weight_kg_delta": r.get("ledger_weight_kg_delta"),
                        "ledger_fish_count_delta": r.get("ledger_fish_count_delta"),
                        "latest_sample_date": r.get("latest_sample_date"),
                        "latest_sample_estimated_fish_count": r.get("latest_sample_estimated_fish_count"),
                        "latest_sample_estimated_total_weight_kg": r.get(
                            "latest_sample_estimated_total_weight_kg"
                        ),
                        "latest_sample_fish_species_label": r.get("latest_sample_fish_species_label"),
                        "stock_density_kg_per_decimal": r.get("stock_density_kg_per_decimal"),
                        "load_level": r.get("load_level"),
                        "load_level_label": r.get("load_level_label"),
                        "current_fish_per_kg": r.get("current_fish_per_kg"),
                        "current_avg_weight_kg": r.get("current_avg_weight_kg"),
                        "partial_harvest_applicable": r.get("partial_harvest_applicable"),
                        "partial_harvest_suggested_kg": r.get("partial_harvest_suggested_kg"),
                        "partial_harvest_suggested_fish_count": r.get("partial_harvest_suggested_fish_count"),
                        "partial_harvest_rationale": r.get("partial_harvest_rationale"),
                        "stocking_advice_status": r.get("stocking_advice_status"),
                        "stocking_advice_message": r.get("stocking_advice_message"),
                    }
                ],
                "subtotal_weight_kg": str(_money_q(kg)),
                "subtotal_fish_count": cnt,
            }
        )

    summary = {
        "as_of_date": as_of.isoformat(),
        "pond_count": len(groups),
        "total_implied_weight_kg": float(_money_q(total_kg)),
        "total_implied_fish_count": total_count,
    }
    return {
        "period": {"start_date": as_of.isoformat(), "end_date": as_of.isoformat()},
        "as_of_date": as_of.isoformat(),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "pond_count": len(groups),
            "total_implied_weight_kg": str(_money_q(total_kg)),
            "total_implied_fish_count": total_count,
        },
        "accounting_note": note_fish_stock_position(company_id),
    }


def _report_shop_station_stock(
    company_id: int, as_of: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    st_raw = (request.GET.get("station_id") or "").strip()
    station_filter: int | None = None
    if st_raw.isdigit():
        station_filter = int(st_raw)
        if not Station.objects.filter(pk=station_filter, company_id=company_id, is_active=True).exists():
            return JsonResponse({"detail": "Station not found"}, status=404)

    qs = (
        ItemStationStock.objects.filter(company_id=company_id)
        .select_related("item", "station")
        .order_by("station__station_name", "item__name", "item_id")
    )
    if station_filter is not None:
        qs = qs.filter(station_id=station_filter)

    by_station: dict[int, list[dict]] = defaultdict(list)
    station_names: dict[int, str] = {}
    grand_val = Decimal("0")
    grand_lines = 0
    for row in qs:
        q = row.quantity if row.quantity is not None else Decimal("0")
        if q <= 0:
            continue
        it = row.item
        if not it or not item_uses_station_bins(company_id, it):
            continue
        if _is_fuel_item(it):
            continue
        kind = _classify_item_stock_kind(it)
        if kind == "fish":
            pass
        uc = item_inventory_unit_cost(it)
        ext = _money_q(q * uc)
        grand_val += ext
        grand_lines += 1
        sid = int(row.station_id)
        st = row.station
        station_names[sid] = (st.station_name or f"Station #{sid}").strip() if st else f"Station #{sid}"
        by_station[sid].append(
            {
                "item_id": it.id,
                "item_name": (it.name or "").strip(),
                "item_number": (it.item_number or "").strip(),
                "unit": (it.unit or "").strip() or "unit",
                "quantity": str(q),
                "unit_cost": str(uc.quantize(Decimal("0.0001"))),
                "extended_value": str(ext),
                "stock_kind": kind,
                "stock_kind_label": {
                    "feed": "Feed",
                    "medicine": "Medicine",
                    "fish": "Fish / fry SKU",
                    "supplies": "Shop supplies",
                }.get(kind, kind),
                "pos_category": (it.pos_category or "").strip(),
                "reporting_category": (it.category or "").strip() or "General",
            }
        )

    groups: list[dict[str, Any]] = []
    for sid in sorted(by_station.keys(), key=lambda x: (station_names.get(x, ""), x)):
        lines = by_station[sid]
        sub_val = _money_q(sum((_decimal(l["extended_value"]) for l in lines), Decimal("0")))
        groups.append(
            {
                "station_id": sid,
                "station_name": station_names.get(sid, f"Station #{sid}"),
                "lines": lines,
                "subtotal_value": str(sub_val),
                "line_count": len(lines),
            }
        )

    summary = {
        "as_of_date": as_of.isoformat(),
        "line_count": grand_lines,
        "station_group_count": len(groups),
        "total_value_bdt": float(_money_q(grand_val)),
    }
    return {
        "period": {"start_date": as_of.isoformat(), "end_date": as_of.isoformat()},
        "as_of_date": as_of.isoformat(),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"line_count": grand_lines, "total_value": str(_money_q(grand_val))},
        "accounting_note": note_shop_station_stock(company_id),
    }


_EQUIPMENT_ASSET_CATEGORIES = frozenset({"equipment", "repair_maintenance", "miscellaneous"})

_POND_INVENTORY_SECTION_LABELS: dict[str, str] = {
    "feed": "Pond warehouse — Feed",
    "medicine": "Pond warehouse — Medicine",
    "supplies": "Pond warehouse — Supplies & materials (nets, wire, pumps, tools, etc.)",
    "fish_sku": "Pond warehouse — Fish / fry SKU",
    "biological_fish": "Live fish — biological stock",
    "equipment_assets": "Equipment & site assets (historical purchases)",
}


def _biological_fish_inventory_value(
    company_id: int, pond_id: int, as_of: date
) -> tuple[Decimal, dict[str, Any]]:
    from api.services.aquaculture_transfer_cost import lookup_transfer_cost_per_kg

    rows = compute_fish_stock_position_rows(company_id, pond_id=pond_id, include_inactive_ponds=False)
    if not rows:
        return Decimal("0"), {"implied_net_weight_kg": "0", "implied_net_fish_count": 0}
    row = rows[0]
    kg = _decimal(row.get("implied_net_weight_kg") or "0")
    count = int(row.get("implied_net_fish_count") or 0)
    active_cycle = (
        AquacultureProductionCycle.objects.filter(
            company_id=company_id, pond_id=pond_id, is_active=True
        )
        .order_by("-start_date", "-id")
        .first()
    )
    per_kg, note = lookup_transfer_cost_per_kg(
        company_id=company_id,
        from_pond_id=pond_id,
        transfer_date=as_of,
        from_cycle=active_cycle,
        line_weight_kg=kg if kg > 0 else None,
    )
    value = _money_q(kg * per_kg) if per_kg is not None and kg > 0 else Decimal("0")
    return value, {
        "implied_net_weight_kg": str(kg),
        "implied_net_fish_count": count,
        "cost_per_kg": str(per_kg) if per_kg is not None else None,
        "valuation_note": note or "",
        "production_cycle_name": (active_cycle.name or "").strip() if active_cycle else "",
        "value_bdt": str(value),
    }


def _pond_equipment_assets_through_date(company_id: int, pond_id: int, as_of: date) -> tuple[Decimal, list[dict]]:
    qs = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            expense_date__lte=as_of,
            expense_category__in=_EQUIPMENT_ASSET_CATEGORIES,
        )
        .order_by("-expense_date", "-id")
    )
    lines: list[dict] = []
    total = Decimal("0")
    for e in qs:
        amt = e.amount or Decimal("0")
        total += amt
        lines.append(
            {
                "id": e.id,
                "expense_date": e.expense_date.isoformat(),
                "expense_category_label": aquaculture_expense_label(company_id, e.expense_category),
                "amount": str(amt),
                "vendor_name": e.vendor_name or "",
                "memo": (e.memo or "")[:200],
            }
        )
    return _money_q(total), lines


def _report_pond_total_inventory(
    company_id: int, as_of: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr

    ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "name", "id"
    )
    if pond_filter_id is not None:
        ponds = ponds.filter(pk=pond_filter_id)

    matrix = pond_warehouse_stock_matrix(company_id, pond_id=pond_filter_id)
    warehouse_by_pond: dict[int, list[dict]] = defaultdict(list)
    for row in matrix:
        item_id = int(row["item_id"])
        it = Item.objects.filter(pk=item_id, company_id=company_id).first()
        kind = _classify_item_stock_kind(it)
        if kind == "fuel":
            continue
        pid = int(row["pond_id"])
        qty = _decimal(row["quantity"])
        uc = _decimal(row.get("unit_cost") or "0")
        ext = _money_q(qty * uc)
        warehouse_by_pond[pid].append(
            {
                "section": kind if kind != "fish" else "fish_sku",
                "section_label": _POND_INVENTORY_SECTION_LABELS.get(
                    kind if kind != "fish" else "fish_sku", kind
                ),
                "item_id": item_id,
                "item_name": row.get("item_name") or "",
                "unit": row.get("unit") or "unit",
                "quantity": row.get("quantity") or "0",
                "unit_cost": row.get("unit_cost") or "0",
                "value_bdt": str(ext),
                "reporting_category": row.get("reporting_category") or "",
            }
        )

    groups: list[dict[str, Any]] = []
    grand_total = Decimal("0")

    for pond in ponds:
        pid = pond.id
        pname = (pond.name or "").strip() or f"Pond #{pid}"
        lines: list[dict[str, Any]] = []
        subtotals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

        for wh in sorted(
            warehouse_by_pond.get(pid, []),
            key=lambda x: (x.get("section") or "", x.get("item_name") or ""),
        ):
            lines.append({**wh, "line_type": "warehouse_item"})
            sec = wh.get("section") or "supplies"
            subtotals[sec] += _decimal(wh.get("value_bdt"))

        fish_val, fish_meta = _biological_fish_inventory_value(company_id, pid, as_of)
        if fish_val > 0 or _decimal(fish_meta.get("implied_net_weight_kg") or "0") > 0:
            lines.append(
                {
                    "line_type": "biological_fish",
                    "section": "biological_fish",
                    "section_label": _POND_INVENTORY_SECTION_LABELS["biological_fish"],
                    "item_name": "Implied live fish biomass",
                    "quantity": fish_meta.get("implied_net_weight_kg") or "0",
                    "unit": "kg",
                    "implied_net_fish_count": fish_meta.get("implied_net_fish_count"),
                    "cost_per_kg": fish_meta.get("cost_per_kg"),
                    "valuation_note": fish_meta.get("valuation_note") or "",
                    "production_cycle_name": fish_meta.get("production_cycle_name") or "",
                    "value_bdt": str(fish_val),
                }
            )
            subtotals["biological_fish"] += fish_val

        equip_total, equip_lines = _pond_equipment_assets_through_date(company_id, pid, as_of)
        if equip_total > 0 or equip_lines:
            for el in equip_lines:
                lines.append(
                    {
                        "line_type": "equipment_expense",
                        "section": "equipment_assets",
                        "section_label": _POND_INVENTORY_SECTION_LABELS["equipment_assets"],
                        "item_name": el.get("expense_category_label") or "Asset purchase",
                        "expense_date": el.get("expense_date"),
                        "vendor_name": el.get("vendor_name") or "",
                        "memo": el.get("memo") or "",
                        "quantity": "1",
                        "unit": "purchase",
                        "value_bdt": el.get("amount") or "0",
                    }
                )
            subtotals["equipment_assets"] += equip_total

        pond_total = _money_q(
            sum(subtotals.values(), Decimal("0"))
        )
        grand_total += pond_total

        groups.append(
            {
                "pond_id": pid,
                "pond_name": pname,
                "lines": lines,
                "subtotals": {
                    "feed_bdt": str(_money_q(subtotals.get("feed", Decimal("0")))),
                    "medicine_bdt": str(_money_q(subtotals.get("medicine", Decimal("0")))),
                    "supplies_bdt": str(_money_q(subtotals.get("supplies", Decimal("0")))),
                    "fish_sku_bdt": str(_money_q(subtotals.get("fish_sku", Decimal("0")))),
                    "biological_fish_bdt": str(_money_q(subtotals.get("biological_fish", Decimal("0")))),
                    "equipment_assets_bdt": str(_money_q(subtotals.get("equipment_assets", Decimal("0")))),
                    "total_bdt": str(pond_total),
                },
                "line_count": len(lines),
            }
        )

    summary = {
        "as_of_date": as_of.isoformat(),
        "pond_count": len(groups),
        "grand_total_bdt": float(_money_q(grand_total)),
    }
    return {
        "period": {"start_date": as_of.isoformat(), "end_date": as_of.isoformat()},
        "as_of_date": as_of.isoformat(),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"grand_total_bdt": str(_money_q(grand_total)), "pond_count": len(groups)},
        "accounting_note": note_pond_total_inventory(company_id),
    }


def _report_equipment_assets(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            expense_date__gte=start,
            expense_date__lte=end,
            expense_category__in=_EQUIPMENT_ASSET_CATEGORIES,
        )
        .select_related("pond", "production_cycle", "source_station")
        .order_by("pond_id", "expense_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int | None, list[dict]] = defaultdict(list)
    pond_names: dict[int | None, str] = {}
    grand = Decimal("0")

    for e in qs:
        if e.pond_id is None:
            pname = "Shared / company"
            pid: int | None = None
        else:
            pid = e.pond_id
            pname = (e.pond.name or "").strip() if e.pond else f"Pond #{e.pond_id}"
        pond_names[pid] = pname
        amt = e.amount or Decimal("0")
        grand += amt
        by_pond[pid].append(
            {
                "id": e.id,
                "expense_date": e.expense_date.isoformat(),
                "expense_category": e.expense_category,
                "expense_category_label": aquaculture_expense_label(company_id, e.expense_category),
                "amount": str(amt),
                "vendor_name": e.vendor_name or "",
                "memo": (e.memo or "")[:300],
                "production_cycle_name": (e.production_cycle.name or "").strip()
                if e.production_cycle_id
                else "",
                "source_station_name": (e.source_station.station_name or "").strip()
                if getattr(e, "source_station_id", None) and getattr(e, "source_station", None)
                else "",
            }
        )

    groups: list[dict[str, Any]] = []
    for pid in sorted(
        by_pond.keys(),
        key=lambda x: (0 if x is None else 1, pond_names.get(x, ""), x or 0),
    ):
        lines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in lines), Decimal("0")))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, "Shared / company"),
                "lines": lines,
                "subtotal_amount": str(sub),
                "line_count": len(lines),
            }
        )

    summary = {
        "total_amount_bdt": float(_money_q(grand)),
        "line_count": sum(len(g["lines"]) for g in groups),
        "pond_group_count": len(groups),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(_money_q(grand)), "line_count": summary["line_count"]},
        "accounting_note": note_equipment_assets(company_id),
    }


def _report_pond_pl(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, scoped_cycle, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    if cycle_filter_id is not None and pond_filter_id is not None and scoped_cycle and scoped_cycle.pond_id != pond_filter_id:
        return JsonResponse({"detail": "cycle_id does not belong to the selected pond"}, status=400)
    if cycle_filter_id is not None and scoped_cycle:
        pond_filter_id = scoped_cycle.pond_id

    include_cycle_breakdown = str(request.GET.get("include_cycle_breakdown", "")).lower() in ("1", "true", "yes")

    base = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        pond_filter_id,
        cycle_filter_id,
        scoped_cycle,
        include_cycle_breakdown,
    )
    t = base.get("totals") or {}
    summary = {
        "total_revenue_bdt": float(Decimal(str(t.get("revenue", "0")))),
        "total_operating_expenses_bdt": float(Decimal(str(t.get("operating_expenses", "0")))),
        "total_payroll_allocated_bdt": float(Decimal(str(t.get("payroll_allocated", "0")))),
        "net_profit_bdt": float(Decimal(str(t.get("profit", "0")))),
    }
    base["period"] = _period_block(start, end)
    base["currency_code"] = BDT
    base["summary"] = summary
    base["filter"] = {
        "pond_id": pond_filter_id,
        "cycle_id": cycle_filter_id,
        "include_cycle_breakdown": include_cycle_breakdown,
    }
    return base


def _report_fish_sales(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureFishSale.objects.filter(
            company_id=company_id,
            sale_date__gte=start,
            sale_date__lte=end,
        )
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "sale_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for s in qs:
        sp = getattr(s, "fish_species", None) or "tilapia"
        spo = getattr(s, "fish_species_other", None) or ""
        by_pond[s.pond_id].append(
            {
                "id": s.id,
                "sale_date": s.sale_date.isoformat(),
                "income_type": s.income_type,
                "income_type_label": aquaculture_income_label(company_id, s.income_type),
                "fish_species": sp,
                "fish_species_other": spo,
                "fish_species_label": fish_species_display_label(sp, spo),
                "production_cycle_name": (s.production_cycle.name or "").strip() if s.production_cycle_id else "",
                "weight_kg": str(s.weight_kg),
                "fish_count": s.fish_count,
                "total_amount": str(s.total_amount),
                "buyer_name": s.buyer_name or "",
                "memo": (s.memo or "")[:200],
            }
        )
        pond_names[s.pond_id] = (s.pond.name or "").strip() if s.pond_id else ""

    groups: list[dict[str, Any]] = []
    grand_amt = Decimal("0")
    grand_wt = Decimal("0")
    grand_lines = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_a = _money_q(sum((_decimal(l["total_amount"]) for l in lines), Decimal("0")))
        sub_w = _money_q(sum((_decimal(l["weight_kg"]) for l in lines), Decimal("0")))
        grand_amt += sub_a
        grand_wt += sub_w
        grand_lines += len(lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_amount": str(sub_a),
                "subtotal_weight_kg": str(sub_w),
                "line_count": len(lines),
            }
        )

    summary = {
        "total_amount_bdt": float(grand_amt),
        "total_weight_kg": float(grand_wt),
        "line_count": grand_lines,
        "pond_group_count": len(groups),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "total_amount": str(grand_amt),
            "total_weight_kg": str(grand_wt),
            "line_count": grand_lines,
        },
    }


def _report_pos_pond_shop_sales(
    company_id: int, start: date, end: date, pond_filter_id: int | None
) -> dict[str, Any]:
    """
    Invoices (non-draft) to each pond's linked POS customer; excludes motor-fuel-classified lines
    (same rule as fuel-sales report).
    """
    pond_q = AquaculturePond.objects.filter(company_id=company_id).exclude(pos_customer_id__isnull=True)
    if pond_filter_id is not None:
        pond_q = pond_q.filter(pk=pond_filter_id)
    ponds = list(pond_q.only("id", "name", "pos_customer_id"))
    cust_to_pond: dict[int, AquaculturePond] = {}
    for p in ponds:
        cid_cust = getattr(p, "pos_customer_id", None)
        if cid_cust:
            cust_to_pond[int(cid_cust)] = p
    if not cust_to_pond:
        return {
            "groups": [],
            "totals": {"total_amount": "0.00", "line_count": 0},
            "summary": {"total_amount_bdt": 0.0, "line_count": 0, "pond_group_count": 0},
        }

    inv_qs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            customer_id__in=list(cust_to_pond.keys()),
        )
        .exclude(status="draft")
        .select_related("station", "customer")
    )
    inv_ids = list(inv_qs.values_list("id", flat=True))
    lines = (
        InvoiceLine.objects.filter(invoice_id__in=inv_ids)
        .select_related("item", "invoice", "invoice__station")
        .order_by("invoice_id", "id")
    )

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {p.id: (p.name or "").strip() for p in ponds}

    grand_amt = Decimal("0")
    grand_n = 0
    for line in lines:
        if _is_fuel_line(line):
            continue
        inv = line.invoice
        cust_id = inv.customer_id
        pond = cust_to_pond.get(cust_id)
        if not pond:
            continue
        pid = pond.id
        it = line.item
        amt = line.amount or Decimal("0")
        grand_amt += amt
        grand_n += 1
        st = inv.station
        st_name = (st.station_name or "").strip() if st else ""
        by_pond[pid].append(
            {
                "id": line.id,
                "invoice_id": inv.id,
                "invoice_number": inv.invoice_number or "",
                "invoice_date": inv.invoice_date.isoformat(),
                "invoice_status": inv.status or "",
                "station_name": st_name,
                "item_id": it.id if it else None,
                "item_name": ((it.name if it else "") or (line.description or ""))[:200],
                "item_number": (it.item_number or "") if it else "",
                "pos_category": (it.pos_category or "") if it else "",
                "reporting_category": (it.category or "") if it else "",
                "quantity": str(line.quantity or 0),
                "amount": str(amt),
                "line_description": (line.description or "")[:200],
            }
        )

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        plines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in plines), Decimal("0")))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": plines,
                "subtotal_amount": str(sub),
                "line_count": len(plines),
            }
        )

    g_amt = _money_q(grand_amt)
    summary = {
        "total_amount_bdt": float(g_amt),
        "line_count": grand_n,
        "pond_group_count": len(groups),
    }
    return {
        "groups": groups,
        "totals": {"total_amount": str(g_amt), "line_count": grand_n},
        "summary": summary,
    }


def _report_pond_sales_comprehensive(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr

    fish = _report_fish_sales(company_id, start, end, request)
    if isinstance(fish, JsonResponse):
        return fish

    pos = _report_pos_pond_shop_sales(company_id, start, end, pond_filter_id)

    fish_amt = _decimal(fish["totals"]["total_amount"])
    pos_amt = _decimal(pos["totals"]["total_amount"])
    combined = _money_q(fish_amt + pos_amt)

    by_income: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": Decimal("0"), "n": 0})
    for g in fish["groups"]:
        for ln in g["lines"]:
            k = str(ln.get("income_type") or "")
            by_income[k]["amount"] += _decimal(ln["total_amount"])
            by_income[k]["n"] += 1

    fish_by_income_type = [
        {
            "income_type": k,
            "income_type_label": aquaculture_income_label(company_id, k),
            "amount_bdt": float(_money_q(v["amount"])),
            "line_count": v["n"],
        }
        for k, v in sorted(by_income.items(), key=lambda x: (x[0] or ""))
    ]

    return {
        "period": fish["period"],
        "currency_code": BDT,
        "summary": {
            "fish_total_amount_bdt": fish["summary"]["total_amount_bdt"],
            "pos_non_fuel_total_amount_bdt": pos["summary"]["total_amount_bdt"],
            "combined_total_amount_bdt": float(combined),
            "fish_line_count": fish["summary"]["line_count"],
            "pos_non_fuel_line_count": pos["summary"]["line_count"],
            "fish_by_income_type": fish_by_income_type,
        },
        "fish_sales": {"groups": fish["groups"], "totals": fish["totals"], "summary": fish["summary"]},
        "pos_shop_sales": pos,
        "accounting_note": note_pond_sales_comprehensive(company_id),
    }


def _report_expenses(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    station_filter_id: int | None = None
    if pond_filter_id is None:
        from api.services.station_scope import effective_report_station_id

        st_id, st_err = effective_report_station_id(request, company_id)
        if st_err:
            return st_err
        station_filter_id = st_id
    from django.db.models import Q

    qs = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            expense_date__gte=start,
            expense_date__lte=end,
        )
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .order_by("pond_id", "expense_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(
            Q(pond_id=pond_filter_id)
            | Q(pond_id__isnull=True, pond_shares__pond_id=pond_filter_id)
        ).distinct()
    elif station_filter_id is not None:
        qs = qs.filter(source_station_id=station_filter_id)
    rows: list[AquacultureExpense] = list(qs)

    filtered_pond_name: str | None = None
    if pond_filter_id is not None:
        filtered_pond_name = (
            AquaculturePond.objects.filter(pk=pond_filter_id, company_id=company_id)
            .values_list("name", flat=True)
            .first()
        )

    def sort_key(e: AquacultureExpense):
        if pond_filter_id is not None and e.pond_id is None:
            return (pond_filter_id, e.expense_date, e.id)
        pid = e.pond_id if e.pond_id is not None else -1
        return (pid, e.expense_date, e.id)

    rows.sort(key=sort_key)

    by_pond: dict[int | None, list[dict]] = defaultdict(list)
    pond_names: dict[int | None, str] = {}

    for e in rows:
        shares_out = []
        line_amount = _money_q(e.amount)
        if e.pond_id is None:
            if pond_filter_id is not None:
                share = next(
                    (sh for sh in e.pond_shares.all() if sh.pond_id == pond_filter_id),
                    None,
                )
                if share is None:
                    continue
                pid = pond_filter_id
                pname = (filtered_pond_name or "").strip() or f"Pond #{pond_filter_id}"
                line_amount = _money_q(share.amount)
                shares_out = [
                    {
                        "pond_id": pond_filter_id,
                        "pond_name": pname,
                        "amount": str(line_amount),
                    }
                ]
            else:
                pname = "Shared (allocated to ponds)"
                pid = None
                for sh in e.pond_shares.all():
                    pn = (sh.pond.name or "").strip() if getattr(sh, "pond", None) else f"Pond #{sh.pond_id}"
                    shares_out.append({"pond_id": sh.pond_id, "pond_name": pn, "amount": str(sh.amount)})
        else:
            pid = e.pond_id
            pname = (e.pond.name or "").strip() if e.pond else f"Pond #{e.pond_id}"
        pond_names[pid] = pname
        by_pond[pid].append(
            {
                "id": e.id,
                "expense_date": e.expense_date.isoformat(),
                "expense_category": e.expense_category,
                "expense_category_label": aquaculture_expense_label(company_id, e.expense_category),
                "amount": str(line_amount),
                "vendor_name": e.vendor_name or "",
                "memo": (e.memo or "")[:200],
                "production_cycle_name": (e.production_cycle.name or "").strip() if e.production_cycle_id else "",
                "is_shared_header": e.pond_id is None,
                "pond_allocations": shares_out,
                "source_station_id": e.source_station_id,
                "source_station_name": (e.source_station.station_name or "").strip()
                if getattr(e, "source_station_id", None) and getattr(e, "source_station", None)
                else "",
            }
        )

    groups: list[dict[str, Any]] = []
    grand = Decimal("0")
    grand_n = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (-1 if x is None else x)):
        lines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in lines), Decimal("0")))
        grand += sub
        grand_n += len(lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, "Shared"),
                "lines": lines,
                "subtotal_amount": str(sub),
                "line_count": len(lines),
            }
        )

    summary = {
        "total_expense_bdt": float(grand),
        "line_count": grand_n,
        "pond_group_count": len(groups),
    }
    out: dict[str, Any] = {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(grand), "line_count": grand_n},
    }
    if pond_filter_id is not None:
        out["filter_pond_id"] = pond_filter_id
    elif station_filter_id is not None:
        out["filter_station_id"] = station_filter_id
        out["accounting_note"] = note_expenses_station_scope(company_id)
    return out


def _report_feed_medicine_consumption(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr

    rows = compute_pond_warehouse_consumption_rows(
        company_id,
        pond_id=pond_filter_id,
        date_from=start,
        date_to=end,
        limit=10000,
    )

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    grand_feed = Decimal("0")
    grand_med = Decimal("0")
    grand_feed_kg = Decimal("0")

    for r in rows:
        pid = int(r["pond_id"])
        pond_names[pid] = r.get("pond_name") or f"Pond #{pid}"
        by_pond[pid].append(r)
        amt = _decimal(r["amount"])
        if r.get("kind") == "feed":
            grand_feed += amt
            if r.get("feed_weight_kg"):
                grand_feed_kg += _decimal(r["feed_weight_kg"])
        else:
            grand_med += amt

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = sorted(by_pond[pid], key=lambda ln: (ln.get("entry_date") or "", ln.get("id") or 0))
        sub_feed = Decimal("0")
        sub_med = Decimal("0")
        sub_feed_kg = Decimal("0")
        for ln in lines:
            amt = _decimal(ln["amount"])
            if ln.get("kind") == "feed":
                sub_feed += amt
                if ln.get("feed_weight_kg"):
                    sub_feed_kg += _decimal(ln["feed_weight_kg"])
            else:
                sub_med += amt
        sub_total = _money_q(sub_feed + sub_med)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_feed_amount": str(_money_q(sub_feed)),
                "subtotal_medicine_amount": str(_money_q(sub_med)),
                "subtotal_amount": str(sub_total),
                "subtotal_feed_kg": str(_money_q(sub_feed_kg)),
                "line_count": len(lines),
            }
        )

    grand_total = _money_q(grand_feed + grand_med)
    summary = {
        "line_count": len(rows),
        "pond_group_count": len(groups),
        "total_feed_amount_bdt": float(_money_q(grand_feed)),
        "total_medicine_amount_bdt": float(_money_q(grand_med)),
        "total_amount_bdt": float(grand_total),
        "total_feed_kg": float(_money_q(grand_feed_kg)),
    }
    out: dict[str, Any] = {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "line_count": len(rows),
            "total_feed_amount": str(_money_q(grand_feed)),
            "total_medicine_amount": str(_money_q(grand_med)),
            "total_amount": str(grand_total),
            "total_feed_kg": str(_money_q(grand_feed_kg)),
        },
        "accounting_note": note_feed_medicine_consumption(company_id),
    }
    if pond_filter_id is not None:
        out["filter_pond_id"] = pond_filter_id
    return out


def _report_sampling(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            sample_date__gte=start,
            sample_date__lte=end,
        )
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "-sample_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for b in qs:
        sp = getattr(b, "fish_species", None) or "tilapia"
        spo = getattr(b, "fish_species_other", None) or ""
        by_pond[b.pond_id].append(
            {
                "id": b.id,
                "sample_date": b.sample_date.isoformat(),
                "production_cycle_id": b.production_cycle_id,
                "production_cycle_name": (
                    (b.production_cycle.name or "").strip()
                    if getattr(b, "production_cycle_id", None) and getattr(b, "production_cycle", None)
                    else ""
                ),
                "fish_species": sp,
                "fish_species_other": spo,
                "fish_species_label": fish_species_display_label(sp, spo),
                "estimated_fish_count": b.estimated_fish_count,
                "estimated_total_weight_kg": str(b.estimated_total_weight_kg) if b.estimated_total_weight_kg is not None else "",
                "fish_per_kg": _fish_per_kg_from_count_weight(b.estimated_fish_count, b.estimated_total_weight_kg),
                "avg_weight_kg": str(b.avg_weight_kg) if b.avg_weight_kg is not None else "",
                "avg_weight_g": (
                    str((_decimal(str(b.avg_weight_kg)) * Decimal("1000")).quantize(Decimal("0.1")))
                    if b.avg_weight_kg is not None
                    else ""
                ),
                "stock_reference_fish_count": b.stock_reference_fish_count,
                "stock_reference_net_weight_kg": (
                    str(b.stock_reference_net_weight_kg) if b.stock_reference_net_weight_kg is not None else ""
                ),
                "stock_reference_avg_weight_kg": (
                    str(b.stock_reference_avg_weight_kg) if b.stock_reference_avg_weight_kg is not None else ""
                ),
                "extrapolated_biomass_kg": str(b.extrapolated_biomass_kg) if b.extrapolated_biomass_kg is not None else "",
                "biomass_gain_kg": str(b.biomass_gain_kg) if b.biomass_gain_kg is not None else "",
                "market_price_per_kg": str(b.market_price_per_kg) if b.market_price_per_kg is not None else "",
                "market_value": str(b.market_value) if b.market_value is not None else "",
                "book_bioasset_value": str(b.book_bioasset_value) if b.book_bioasset_value is not None else "",
                "book_cost_per_kg": str(b.book_cost_per_kg) if b.book_cost_per_kg is not None else "",
                "bioasset_margin": str(b.bioasset_margin) if b.bioasset_margin is not None else "",
                "bioasset_margin_per_kg": str(b.bioasset_margin_per_kg) if b.bioasset_margin_per_kg is not None else "",
                "full_cycle_margin": str(b.full_cycle_margin) if b.full_cycle_margin is not None else "",
                "full_cycle_margin_per_kg": str(b.full_cycle_margin_per_kg) if b.full_cycle_margin_per_kg is not None else "",
                "notes": (b.notes or "")[:200],
            }
        )
        pond_names[b.pond_id] = (b.pond.name or "").strip() if b.pond_id else ""

    groups: list[dict[str, Any]] = []
    total_samples = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        total_samples += len(lines)
        wt_sum = Decimal("0")
        for ln in lines:
            if ln.get("estimated_total_weight_kg"):
                wt_sum += _decimal(str(ln["estimated_total_weight_kg"]))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_samples": len(lines),
                "subtotal_estimated_weight_kg": str(_money_q(wt_sum)) if wt_sum != 0 else "0",
            }
        )

    summary = {"sample_count": total_samples, "pond_group_count": len(groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"sample_count": total_samples},
        "accounting_note": note_sampling(company_id),
    }


def _report_fish_stock_breakdown(
    company_id: int, as_of: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    rows = compute_fish_stock_position_breakdown_rows(
        company_id,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
        include_inactive_ponds=False,
    )
    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    total_kg = Decimal("0")
    total_count = 0
    for r in rows:
        pid = int(r.get("pond_id") or 0)
        kg = _decimal(r.get("implied_net_weight_kg") or "0")
        cnt = int(r.get("implied_net_fish_count") or 0)
        total_kg += kg
        total_count += cnt
        pond_names[pid] = r.get("pond_name") or f"Pond #{pid}"
        by_pond[pid].append(
            {
                "production_cycle_id": r.get("production_cycle_id"),
                "production_cycle_name": r.get("production_cycle_name") or "",
                "fish_species": r.get("fish_species"),
                "fish_species_label": r.get("fish_species_label") or "",
                "implied_net_weight_kg": r.get("implied_net_weight_kg"),
                "implied_net_fish_count": r.get("implied_net_fish_count"),
                "stocked_weight_kg": r.get("stocked_weight_kg"),
                "stocked_fish_count": r.get("stocked_fish_count"),
                "sale_weight_kg": r.get("sale_weight_kg"),
                "sale_fish_count": r.get("sale_fish_count"),
                "mortality_weight_kg": r.get("mortality_weight_kg"),
                "mortality_fish_count": r.get("mortality_fish_count"),
                "other_adjustment_weight_kg": r.get("other_adjustment_weight_kg"),
                "other_adjustment_fish_count": r.get("other_adjustment_fish_count"),
                "current_fish_per_kg": r.get("current_fish_per_kg"),
                "current_avg_weight_kg": r.get("current_avg_weight_kg"),
                "latest_sample_date": r.get("latest_sample_date"),
                "stock_density_kg_per_decimal": r.get("stock_density_kg_per_decimal"),
                "load_level_label": r.get("load_level_label"),
            }
        )

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_kg = sum((_decimal(str(ln.get("implied_net_weight_kg") or "0")) for ln in lines), Decimal("0"))
        sub_cnt = sum(int(ln.get("implied_net_fish_count") or 0) for ln in lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_weight_kg": str(_money_q(sub_kg)),
                "subtotal_fish_count": sub_cnt,
                "line_count": len(lines),
            }
        )

    summary = {
        "as_of_date": as_of.isoformat(),
        "pond_count": len(groups),
        "bucket_count": sum(len(g["lines"]) for g in groups),
        "total_implied_weight_kg": float(_money_q(total_kg)),
        "total_implied_fish_count": total_count,
    }
    return {
        "period": {"start_date": as_of.isoformat(), "end_date": as_of.isoformat()},
        "as_of_date": as_of.isoformat(),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "pond_count": len(groups),
            "bucket_count": summary["bucket_count"],
            "total_implied_weight_kg": str(_money_q(total_kg)),
            "total_implied_fish_count": total_count,
        },
        "accounting_note": note_fish_stock_breakdown(company_id),
    }


def _report_fish_biomass_movements(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    rows = compute_fish_biomass_ledger_rows(
        company_id,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
        date_from=start,
        date_to=end,
        limit=5000,
    )
    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    grand_kg = Decimal("0")
    grand_fish = 0
    for r in rows:
        pid = int(r.get("pond_id") or 0)
        pond_names[pid] = (r.get("pond_name") or "").strip() or f"Pond #{pid}"
        by_pond[pid].append(r)
        grand_kg += _decimal(str(r.get("weight_kg_delta") or "0"))
        grand_fish += int(r.get("fish_count_delta") or 0)

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_kg = sum((_decimal(str(ln.get("weight_kg_delta") or "0")) for ln in lines), Decimal("0"))
        sub_fish = sum(int(ln.get("fish_count_delta") or 0) for ln in lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_weight_kg_delta": str(_money_q(sub_kg)),
                "subtotal_fish_count_delta": sub_fish,
                "line_count": len(lines),
            }
        )

    summary = {
        "movement_count": len(rows),
        "pond_group_count": len(groups),
        "total_weight_kg_delta": float(_money_q(grand_kg)),
        "total_fish_count_delta": grand_fish,
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "movement_count": len(rows),
            "total_weight_kg_delta": str(_money_q(grand_kg)),
            "total_fish_count_delta": grand_fish,
        },
        "accounting_note": note_fish_biomass_movements(company_id),
    }


def _report_biological_asset_ledger(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    """Pond biological asset valuation and movement ledger as of period end."""
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, cycle_obj, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    as_of = end

    def _pond_group(pid: int, pname: str) -> dict[str, Any]:
        cycle = cycle_obj if cycle_obj and cycle_obj.pond_id == pid else None
        summary = compute_pond_biological_asset_summary(
            company_id,
            pond_id=pid,
            as_of_date=as_of,
            production_cycle=cycle,
        )
        rows = compute_biological_asset_ledger_rows(
            company_id,
            pond_id=pid,
            as_of_date=as_of,
            production_cycle=cycle,
            limit=500,
        )
        return {
            "pond_id": pid,
            "pond_name": pname,
            "summary": summary,
            "lines": rows,
            "line_count": len(rows),
        }

    groups: list[dict[str, Any]] = []
    if pond_filter_id is not None:
        pond = AquaculturePond.objects.filter(pk=pond_filter_id, company_id=company_id).first()
        pname = (pond.name or "").strip() if pond else f"Pond #{pond_filter_id}"
        groups.append(_pond_group(pond_filter_id, pname))
    else:
        portfolio = compute_biological_asset_portfolio(company_id, as_of_date=as_of)
        for prow in portfolio.get("ponds") or []:
            pid = int(prow["pond_id"])
            groups.append(_pond_group(pid, str(prow.get("pond_name") or f"Pond #{pid}")))

    grand_value = Decimal("0")
    grand_fish = 0
    for g in groups:
        s = g.get("summary") or {}
        grand_value += _decimal(str(s.get("total_biological_asset_value") or "0"))
        grand_fish += int(s.get("live_fish_count") or 0)

    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "as_of_date": as_of.isoformat(),
        "summary": {
            "pond_count": len(groups),
            "total_biological_asset_value": str(_money_q(grand_value)),
            "total_live_fish_count": grand_fish,
        },
        "groups": groups,
        "totals": {
            "pond_count": len(groups),
            "total_biological_asset_value": str(_money_q(grand_value)),
            "total_live_fish_count": grand_fish,
        },
        "methodology": (
            "Biological asset value = direct pond production costs (fry, feed, medicine, labour, and other "
            "direct buckets) + transfer-in − transfer-out − harvest bio relief. Mortality reduces live fish "
            "count but does not reduce this accumulated total unless a separate book write-off is posted. "
            "Figures are as of the report period end date."
        ),
    }


def _report_fish_stock_adjustments(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureFishStockLedger.objects.filter(
            company_id=company_id,
            entry_date__gte=start,
            entry_date__lte=end,
        )
        .select_related("pond", "production_cycle", "journal_entry")
        .order_by("pond_id", "-entry_date", "-id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    grand_kg = Decimal("0")
    grand_fish = 0
    loss_kg = Decimal("0")
    loss_fish = 0
    for x in qs:
        lr = (x.loss_reason or "").strip()
        cyc_id = getattr(x, "production_cycle_id", None)
        cname = ""
        if cyc_id and getattr(x, "production_cycle", None):
            cname = (x.production_cycle.name or "").strip()
        je = x.journal_entry
        line = {
            "id": x.id,
            "entry_date": x.entry_date.isoformat(),
            "entry_kind": x.entry_kind,
            "entry_kind_label": STOCK_LEDGER_ENTRY_KIND_LABELS.get(x.entry_kind, x.entry_kind),
            "loss_reason": lr,
            "loss_reason_label": STOCK_LEDGER_LOSS_REASON_LABELS.get(lr, "") or None,
            "production_cycle_name": cname,
            "fish_species_label": fish_species_display_label(x.fish_species, x.fish_species_other),
            "fish_count_delta": x.fish_count_delta,
            "weight_kg_delta": str(x.weight_kg_delta),
            "book_value": str(x.book_value),
            "post_to_books": bool(x.post_to_books),
            "memo": (x.memo or "")[:200],
            "journal_entry_number": (je.entry_number or "") if je else "",
        }
        by_pond[x.pond_id].append(line)
        pond_names[x.pond_id] = (x.pond.name or "").strip() if x.pond_id else ""
        wkd = _decimal(str(x.weight_kg_delta))
        fcd = int(x.fish_count_delta or 0)
        grand_kg += wkd
        grand_fish += fcd
        if x.entry_kind == "loss":
            loss_kg += wkd
            loss_fish += fcd

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_kg = sum((_decimal(str(ln.get("weight_kg_delta") or "0")) for ln in lines), Decimal("0"))
        sub_fish = sum(int(ln.get("fish_count_delta") or 0) for ln in lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_weight_kg_delta": str(_money_q(sub_kg)),
                "subtotal_fish_count_delta": sub_fish,
                "line_count": len(lines),
            }
        )

    summary = {
        "entry_count": qs.count(),
        "pond_group_count": len(groups),
        "total_weight_kg_delta": float(_money_q(grand_kg)),
        "total_fish_count_delta": grand_fish,
        "loss_weight_kg_delta": float(_money_q(loss_kg)),
        "loss_fish_count_delta": loss_fish,
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "entry_count": summary["entry_count"],
            "total_weight_kg_delta": str(_money_q(grand_kg)),
            "total_fish_count_delta": grand_fish,
            "loss_weight_kg_delta": str(_money_q(loss_kg)),
            "loss_fish_count_delta": loss_fish,
        },
        "accounting_note": note_fish_stock_adjustments(company_id),
    }


def _report_fcr_biomass(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    """Dedicated FCR, feed consumption, biomass gain, and pond load report for a date range."""
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr

    fcr_block = fcr_period_summary_block(
        company_id,
        start,
        end,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
    )
    stock_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
        include_inactive_ponds=False,
    )
    load_rows: list[dict[str, Any]] = []
    for r in stock_rows:
        load_rows.append(
            {
                "pond_id": r.get("pond_id"),
                "pond_name": r.get("pond_name") or "",
                "pond_role": r.get("pond_role"),
                "water_area_decimal": r.get("water_area_decimal"),
                "implied_net_weight_kg": r.get("implied_net_weight_kg"),
                "implied_net_fish_count": r.get("implied_net_fish_count"),
                "current_fish_per_kg": r.get("current_fish_per_kg"),
                "stock_density_kg_per_decimal": r.get("stock_density_kg_per_decimal"),
                "load_level": r.get("load_level"),
                "load_level_label": r.get("load_level_label"),
                "partial_harvest_applicable": r.get("partial_harvest_applicable"),
                "partial_harvest_suggested_kg": r.get("partial_harvest_suggested_kg"),
                "partial_harvest_suggested_fish_count": r.get("partial_harvest_suggested_fish_count"),
                "partial_harvest_rationale": r.get("partial_harvest_rationale"),
            }
        )

    portfolio = fcr_block.get("portfolio") or {}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": {
            "feed_kg": portfolio.get("feed_kg"),
            "biomass_gain_kg": portfolio.get("biomass_gain_kg"),
            "harvest_kg": portfolio.get("harvest_kg"),
            "fcr_biomass": portfolio.get("fcr_biomass"),
            "fcr_harvest": portfolio.get("fcr_harvest"),
            "pond_count_with_load": len(load_rows),
        },
        "fcr": fcr_block,
        "load_by_pond": load_rows,
        "methodology": fcr_block.get("methodology"),
    }


def _report_fish_growth(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    """Sample-to-sample growth intervals with ADG, interval FCR, period FCR, and pond load."""
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    species_raw = (request.GET.get("fish_species") or "").strip() or None

    body = build_fish_growth_report(
        company_id,
        start,
        end,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
        fish_species=species_raw,
    )
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        **body,
    }


def _report_pond_performance(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    """All-pond performance snapshot: FCR, load, ADG, biomass, and bioasset for a date range."""
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, _, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    species_raw = (request.GET.get("fish_species") or "").strip() or None

    body = build_pond_performance_report(
        company_id,
        start,
        end,
        pond_id=pond_filter_id,
        production_cycle_id=cycle_filter_id,
        fish_species=species_raw,
    )
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        **body,
    }


def _report_production_cycles(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = AquacultureProductionCycle.objects.filter(company_id=company_id).select_related("pond").order_by(
        "pond_id", "sort_order", "-start_date", "id"
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    lines: list[dict[str, Any]] = []
    by_pond: dict[int, list[dict]] = defaultdict(list)
    for c in qs:
        if c.end_date and c.end_date < start:
            continue
        if c.start_date > end:
            continue
        row = {
            "id": c.id,
            "pond_id": c.pond_id,
            "pond_name": (c.pond.name or "").strip() if c.pond_id else "",
            "name": c.name,
            "code": c.code or "",
            "start_date": c.start_date.isoformat(),
            "end_date": c.end_date.isoformat() if c.end_date else "",
            "is_active": c.is_active,
            "notes": (c.notes or "")[:200],
        }
        lines.append(row)
        by_pond[c.pond_id].append(row)

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (by_pond[x][0].get("pond_name", ""), x)):
        glines = by_pond[pid]
        groups.append(
            {
                "pond_id": pid,
                "pond_name": glines[0].get("pond_name", f"Pond #{pid}"),
                "lines": glines,
                "subtotal_cycles": len(glines),
            }
        )

    summary = {"cycle_count": len(lines), "pond_group_count": len(groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "lines": lines,
        "groups": groups,
        "totals": {"cycle_count": len(lines)},
    }


def _report_profit_transfers(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquaculturePondProfitTransfer.objects.filter(
            company_id=company_id,
            transfer_date__gte=start,
            transfer_date__lte=end,
        )
        .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
        .order_by("pond_id", "-transfer_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for t in qs:
        row = {
            "id": t.id,
            "transfer_date": t.transfer_date.isoformat(),
            "amount": str(t.amount),
            "memo": (t.memo or "")[:200],
            "production_cycle_name": (t.production_cycle.name or "").strip() if t.production_cycle_id else "",
            "debit_account_code": (t.debit_account.account_code or "") if t.debit_account_id else "",
            "debit_account_name": (t.debit_account.account_name or "") if t.debit_account_id else "",
            "credit_account_code": (t.credit_account.account_code or "") if t.credit_account_id else "",
            "credit_account_name": (t.credit_account.account_name or "") if t.credit_account_id else "",
            "journal_entry_number": (t.journal_entry.entry_number if t.journal_entry_id and t.journal_entry else ""),
        }
        by_pond[t.pond_id].append(row)
        pond_names[t.pond_id] = (t.pond.name or "").strip() if t.pond_id else ""

    groups: list[dict[str, Any]] = []
    grand = Decimal("0")
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in lines), Decimal("0")))
        grand += sub
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_amount": str(sub),
                "line_count": len(lines),
            }
        )

    summary = {"total_transfers_bdt": float(grand), "line_count": sum(len(g["lines"]) for g in groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(grand), "line_count": summary["line_count"]},
    }


def _report_fingerling_transfers(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    from api.services.aquaculture_fingerling_transfer_report import (
        compute_fingerling_transfer_report,
        parse_fingerling_transfer_report_filters,
    )

    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    filters = parse_fingerling_transfer_report_filters(
        search_q=request.GET.get("q") or request.GET.get("search"),
        species=request.GET.get("species"),
        min_cost_raw=request.GET.get("min_cost"),
        max_cost_raw=request.GET.get("max_cost"),
        nursing_pond_id_raw=request.GET.get("nursing_pond_id"),
        growout_pond_id_raw=request.GET.get("growout_pond_id"),
        balance=request.GET.get("balance"),
    )
    body = compute_fingerling_transfer_report(
        company_id,
        start=start,
        end=end,
        pond_filter_id=pond_filter_id,
        filters=filters,
    )
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        **body,
    }


def _report_fish_transfers(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            transfer_date__gte=start,
            transfer_date__lte=end,
        )
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .order_by("-transfer_date", "-id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(
            models.Q(from_pond_id=pond_filter_id) | models.Q(lines__to_pond_id=pond_filter_id)
        ).distinct()

    groups: list[dict[str, Any]] = []
    grand_wt = Decimal("0")
    grand_cost = Decimal("0")
    grand_lines = 0
    for t in qs:
        from_name = (t.from_pond.name or "").strip() if t.from_pond_id else ""
        line_rows: list[dict[str, Any]] = []
        sub_wt = Decimal("0")
        sub_cost = Decimal("0")
        for ln in t.lines.all():
            wt = ln.weight_kg or Decimal("0")
            cost = ln.cost_amount or Decimal("0")
            sub_wt += wt
            sub_cost += cost
            to_name = (ln.to_pond.name or "").strip() if ln.to_pond_id else ""
            line_rows.append(
                {
                    "id": ln.id,
                    "to_pond_id": ln.to_pond_id,
                    "to_pond_name": to_name,
                    "to_cycle_name": (
                        (ln.to_production_cycle.name or "").strip()
                        if ln.to_production_cycle_id
                        else ""
                    ),
                    "weight_kg": str(wt),
                    "fish_count": ln.fish_count,
                    "cost_amount": str(cost),
                }
            )
        grand_wt += sub_wt
        grand_cost += sub_cost
        grand_lines += len(line_rows)
        sp = getattr(t, "fish_species", None) or "tilapia"
        spo = getattr(t, "fish_species_other", None) or ""
        groups.append(
            {
                "id": t.id,
                "transfer_date": t.transfer_date.isoformat(),
                "from_pond_id": t.from_pond_id,
                "from_pond_name": from_name,
                "from_cycle_name": (
                    (t.from_production_cycle.name or "").strip()
                    if t.from_production_cycle_id
                    else ""
                ),
                "fish_species": sp,
                "fish_species_label": fish_species_display_label(sp, spo),
                "memo": (t.memo or "")[:200],
                "lines": line_rows,
                "subtotal_weight_kg": str(_money_q(sub_wt)),
                "subtotal_cost_amount": str(_money_q(sub_cost)),
                "line_count": len(line_rows),
            }
        )

    summary = {
        "transfer_count": len(groups),
        "line_count": grand_lines,
        "total_weight_kg": float(_money_q(grand_wt)),
        "total_cost_amount_bdt": float(_money_q(grand_cost)),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "transfer_count": len(groups),
            "line_count": grand_lines,
            "total_weight_kg": str(_money_q(grand_wt)),
            "total_cost_amount": str(_money_q(grand_cost)),
        },
    }
