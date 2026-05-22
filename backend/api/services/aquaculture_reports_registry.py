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
from django.db.models import Sum

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishSale,
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
from api.services.aquaculture_constants import fish_species_display_label
from api.services.aquaculture_pond_stock_service import pond_warehouse_stock_matrix
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.gl_posting import item_inventory_unit_cost
from api.services.station_stock import item_uses_station_bins
from api.services.tenant_reporting_categories import aquaculture_expense_label, aquaculture_income_label
from api.services.reporting import _is_fuel_line
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.permission_service import user_may_access_aquaculture_api
from django.http import HttpRequest, JsonResponse


BDT = "BDT"


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _decimal(s: str) -> Decimal:
    try:
        return Decimal(str(s))
    except Exception:
        return Decimal("0")


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


def build_aquaculture_report(
    report_id: str, company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    user = getattr(request, "api_user", None)
    gate = aquaculture_gate(company_id, user)
    if gate:
        return gate

    if report_id == "aquaculture-pond-pl":
        return _report_pond_pl(company_id, start, end, request)
    if report_id == "aquaculture-fish-sales":
        return _report_fish_sales(company_id, start, end, request)
    if report_id == "aquaculture-pond-sales-comprehensive":
        return _report_pond_sales_comprehensive(company_id, start, end, request)
    if report_id == "aquaculture-expenses":
        return _report_expenses(company_id, start, end, request)
    if report_id == "aquaculture-sampling":
        return _report_sampling(company_id, start, end, request)
    if report_id == "aquaculture-production-cycles":
        return _report_production_cycles(company_id, start, end, request)
    if report_id == "aquaculture-profit-transfers":
        return _report_profit_transfers(company_id, start, end, request)
    if report_id == "aquaculture-fish-transfers":
        return _report_fish_transfers(company_id, start, end, request)
    if report_id == "aquaculture-pond-feed-stock":
        return _report_pond_warehouse_stock(company_id, end, request, stock_kind="feed")
    if report_id == "aquaculture-pond-medicine-stock":
        return _report_pond_warehouse_stock(company_id, end, request, stock_kind="medicine")
    if report_id == "aquaculture-pond-supplies-stock":
        return _report_pond_warehouse_stock(company_id, end, request, stock_kind="supplies")
    if report_id == "aquaculture-fish-stock-position":
        return _report_fish_stock_position(company_id, end, request)
    if report_id == "aquaculture-shop-station-stock":
        return _report_shop_station_stock(company_id, end, request)
    if report_id == "aquaculture-equipment-assets":
        return _report_equipment_assets(company_id, start, end, request)
    if report_id == "aquaculture-pond-total-inventory":
        return _report_pond_total_inventory(company_id, end, request)
    return JsonResponse({"detail": "Unknown aquaculture report"}, status=404)


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
        "accounting_note": (
            "On-hand quantities in each pond warehouse (ItemPondStock). "
            "Values use average inventory unit cost. Snapshot as of the report end date."
        ),
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
        "accounting_note": (
            "Biological fish position per pond from transfers, vendor fry bills, sales, stock ledger, "
            "and latest biomass sample. Not the same as inventoried fry SKUs in the pond warehouse."
        ),
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
        "accounting_note": (
            "Shop / station bin on-hand (ItemStationStock) for SKUs tracked per station — feed, medicine, "
            "fish fry SKUs, and general supplies. Excludes motor fuel. Transfer to ponds via pond warehouse transfer."
        ),
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
        "accounting_note": (
            "Per-pond total inventory and asset value as of the report end date. "
            "Pond warehouse lines use on-hand quantity × average unit cost. "
            "Live fish uses implied biomass kg × production cost per kg (same basis as inter-pond transfers). "
            "Equipment & site assets are cumulative equipment, repair, and miscellaneous pond expenses through "
            "that date (expensed purchases — aerators, boats, nets, tools, wire, pumps, etc.). "
            "Shop station stock is not included until transferred to the pond."
        ),
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
        "accounting_note": (
            "Operating purchases for equipment, repair & maintenance, and miscellaneous pond assets "
            "(aerators, boats, nets, tools, cameras, wire, etc.). There is no separate fixed-asset register; "
            "use this register with vendor bills and pond expenses for durable goods."
        ),
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
        "accounting_note": (
            "Fish: all Aquaculture pond income lines in the period (every income_type). "
            "POS: invoices to each pond's linked POS customer; lines classified as motor fuel are excluded."
        ),
    }


def _report_expenses(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
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
    rows: list[AquacultureExpense] = list(qs)

    def sort_key(e: AquacultureExpense):
        pid = e.pond_id if e.pond_id is not None else -1
        return (pid, e.expense_date, e.id)

    rows.sort(key=sort_key)

    by_pond: dict[int | None, list[dict]] = defaultdict(list)
    pond_names: dict[int | None, str] = {}

    for e in rows:
        if e.pond_id is None:
            pname = "Shared (allocated to ponds)"
            pid: int | None = None
        else:
            pid = e.pond_id
            pname = (e.pond.name or "").strip() if e.pond else f"Pond #{e.pond_id}"
        pond_names[pid] = pname
        shares_out = []
        if e.pond_id is None:
            for sh in e.pond_shares.all():
                pn = (sh.pond.name or "").strip() if getattr(sh, "pond", None) else f"Pond #{sh.pond_id}"
                shares_out.append({"pond_id": sh.pond_id, "pond_name": pn, "amount": str(sh.amount)})
        by_pond[pid].append(
            {
                "id": e.id,
                "expense_date": e.expense_date.isoformat(),
                "expense_category": e.expense_category,
                "expense_category_label": aquaculture_expense_label(company_id, e.expense_category),
                "amount": str(e.amount),
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
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(grand), "line_count": grand_n},
    }


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
        .select_related("pond")
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
                "fish_species": sp,
                "fish_species_other": spo,
                "fish_species_label": fish_species_display_label(sp, spo),
                "estimated_fish_count": b.estimated_fish_count,
                "estimated_total_weight_kg": str(b.estimated_total_weight_kg) if b.estimated_total_weight_kg is not None else "",
                "avg_weight_kg": str(b.avg_weight_kg) if b.avg_weight_kg is not None else "",
                "stock_reference_fish_count": b.stock_reference_fish_count,
                "stock_reference_avg_weight_kg": (
                    str(b.stock_reference_avg_weight_kg) if b.stock_reference_avg_weight_kg is not None else ""
                ),
                "extrapolated_biomass_kg": str(b.extrapolated_biomass_kg) if b.extrapolated_biomass_kg is not None else "",
                "biomass_gain_kg": str(b.biomass_gain_kg) if b.biomass_gain_kg is not None else "",
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
