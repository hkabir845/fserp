"""Supplemental per-entity metrics for All Entities reports (inventory, AR/AP, shop pass-through)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Q

from api.models import (
    AquaculturePond,
    Bill,
    BillLine,
    Invoice,
    Item,
    ItemStationStock,
    JournalEntryLine,
    Station,
)
from api.services.aquaculture_reports_registry import _classify_item_stock_kind, _is_fuel_item
from api.services.payment_allocation import bill_open_amount, invoice_open_amount
from api.services.gl_posting import item_inventory_unit_cost
from api.services.station_stock import item_uses_station_bins
from api.services.station_business_kind import KIND_SHOP_HUB, station_business_kind


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _decimal(raw) -> Decimal:
    try:
        return Decimal(str(raw or 0))
    except Exception:
        return Decimal("0")


def station_shop_inventory_value_bdt(company_id: int, station_id: int) -> Decimal:
    """On-hand shop bin value (feed, medicine, supplies) — excludes motor fuel."""
    total = Decimal("0")
    for row in ItemStationStock.objects.filter(company_id=company_id, station_id=station_id).select_related(
        "item"
    ):
        q = row.quantity if row.quantity is not None else Decimal("0")
        if q <= 0:
            continue
        it = row.item
        if not it or not item_uses_station_bins(company_id, it) or _is_fuel_item(it):
            continue
        total += _money_q(q * item_inventory_unit_cost(it))
    return _money_q(total)


def station_pond_pass_through_pl(
    company_id: int, station_id: int, start: date, end: date
) -> dict[str, Decimal]:
    """
    GL P&L on lines tagged to a pond but originating at this shop station
    (POS / bills with receipt station = shop hub). Excluded from the station's direct P&L row.
    """
    from api.services.reporting import _period_pl_totals_from_line_qs

    qs = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
        aquaculture_pond_id__isnull=False,
    ).filter(
        Q(station_id=station_id)
        | Q(station_id__isnull=True, journal_entry__station_id=station_id)
    )
    return _period_pl_totals_from_line_qs(company_id, start, end, qs)


def pond_open_ar_bdt(company_id: int, pond_id: int) -> Decimal:
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond or not pond.pos_customer_id:
        return Decimal("0")
    total = Decimal("0")
    for inv in Invoice.objects.filter(
        company_id=company_id,
        customer_id=pond.pos_customer_id,
    ).exclude(status__in=("draft", "paid", "void")):
        total += invoice_open_amount(inv, company_id)
    return _money_q(total)


def pond_open_ap_bdt(company_id: int, pond_id: int) -> Decimal:
    total = Decimal("0")
    bill_ids = (
        BillLine.objects.filter(
            bill__company_id=company_id,
            aquaculture_pond_id=pond_id,
        )
        .values_list("bill_id", flat=True)
        .distinct()
    )
    for bill in Bill.objects.filter(pk__in=bill_ids).exclude(status__in=("draft", "paid", "void")):
        total += bill_open_amount(bill, company_id)
    return _money_q(total)


def pond_warehouse_inventory_value_bdt(company_id: int, pond_id: int) -> Decimal:
    """Pond warehouse SKU value (feed, medicine, supplies) — excludes live fish biomass."""
    from api.services.aquaculture_pond_stock_service import pond_warehouse_stock_matrix

    total = Decimal("0")
    for row in pond_warehouse_stock_matrix(company_id, pond_id=pond_id):
        it = Item.objects.filter(pk=int(row["item_id"]), company_id=company_id).first()
        kind = _classify_item_stock_kind(it)
        if kind in ("fuel", "fish"):
            continue
        qty = _decimal(row.get("quantity"))
        uc = _decimal(row.get("unit_cost"))
        if qty > 0:
            total += _money_q(qty * uc)
    return _money_q(total)


def enrich_station_entity_row(
    company_id: int,
    station: Station,
    row: dict,
    *,
    start: date,
    end: date,
) -> None:
    from api.services.station_business_kind import station_business_kind_label

    kind = station_business_kind(station)
    row["business_kind"] = kind
    row["business_kind_label"] = station_business_kind_label(kind)
    row["shop_inventory_value_bdt"] = str(station_shop_inventory_value_bdt(company_id, station.id))

    if kind == KIND_SHOP_HUB:
        pt = station_pond_pass_through_pl(company_id, station.id, start, end)
        row["shop_sales_to_ponds_income"] = str(_money_q(pt["income"]))
        row["shop_sales_to_ponds_cogs"] = str(_money_q(pt["cogs"]))
        row["shop_sales_to_ponds_gross_profit"] = str(_money_q(pt["gross_profit"]))
        row["shop_sales_to_ponds_net_income"] = str(_money_q(pt["net_income"]))
        direct_inc = _decimal(row.get("income"))
        direct_cogs = _decimal(row.get("cost_of_goods_sold"))
        direct_exp = _decimal(row.get("expenses"))
        row["combined_shop_income"] = str(_money_q(direct_inc + pt["income"]))
        row["combined_shop_cogs"] = str(_money_q(direct_cogs + pt["cogs"]))
        row["combined_shop_gross_profit"] = str(
            _money_q(direct_inc + pt["income"] - direct_cogs - pt["cogs"])
        )
        row["combined_shop_net_income"] = str(
            _money_q(direct_inc + pt["income"] - direct_cogs - pt["cogs"] - direct_exp - pt["expenses"])
        )


def enrich_pond_entity_row(company_id: int, pond_id: int, row: dict) -> None:
    row["pond_warehouse_inventory_value_bdt"] = str(pond_warehouse_inventory_value_bdt(company_id, pond_id))
    row["pond_open_ar_bdt"] = str(pond_open_ar_bdt(company_id, pond_id))
    row["pond_open_ap_bdt"] = str(pond_open_ap_bdt(company_id, pond_id))
