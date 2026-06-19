"""Per-station stock availability and inter-station transfers (shop inventory)."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, Q, Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import (
    InventoryAdjustment,
    InventoryAdjustmentLine,
    InventoryTransfer,
    InventoryTransferLine,
    Item,
    PondWarehouseStockReceipt,
    PondWarehouseStockReceiptLine,
    PondWarehouseStockReturn,
    PondWarehouseStockReturnLine,
    Station,
    User,
)
from api.exceptions import StockBusinessError
from api.services.aquaculture_pond_stock_service import (
    amend_pond_warehouse_stock_receipt,
    reverse_pond_warehouse_stock_receipt,
    reverse_pond_warehouse_stock_return,
)
from api.services.gl_posting import (
    delete_auto_inventory_adjustment_journal,
    delete_auto_inventory_transfer_journal,
    item_inventory_unit_cost,
    post_inventory_adjustment_journal,
    post_inventory_transfer_journal,
)
from api.services.station_stock import (
    add_station_stock,
    get_station_stock,
    item_uses_station_bins,
    per_pond_quantities,
    per_station_quantities,
    set_station_stock,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, _serialize_decimal


def _user_home_station_id(request) -> int | None:
    api = getattr(request, "api_user", None)
    if not api:
        return None
    u = User.objects.filter(pk=getattr(api, "id", None)).only("home_station_id").first()
    if not u or not u.home_station_id:
        return None
    return int(u.home_station_id)


def _inventory_transfer_visible_for_user(request, tr: InventoryTransfer) -> bool:
    h = _user_home_station_id(request)
    if h is None:
        return True
    return int(tr.from_station_id) == h or int(tr.to_station_id) == h


def _pond_receipt_visible_for_user(request, rec: PondWarehouseStockReceipt) -> bool:
    h = _user_home_station_id(request)
    if h is None:
        return True
    return int(rec.from_station_id) == h


def _pond_return_visible_for_user(request, ret: PondWarehouseStockReturn) -> bool:
    h = _user_home_station_id(request)
    if h is None:
        return True
    return int(ret.to_station_id) == h


def _inventory_line_value_fields(item: Item | None, quantity: Decimal) -> dict:
    qty = quantity or Decimal("0")
    unit_cost = item_inventory_unit_cost(item)
    if qty <= 0 or unit_cost <= 0:
        line_value = Decimal("0")
    else:
        line_value = (qty * unit_cost).quantize(Decimal("0.01"))
    return {
        "unit_cost": _serialize_decimal(unit_cost) if unit_cost > 0 else None,
        "line_value": _serialize_decimal(line_value),
    }


def _pond_receipt_to_json(rec: PondWarehouseStockReceipt) -> dict:
    lines = list(rec.lines.all().select_related("item"))
    line_rows = []
    total_value = Decimal("0")
    for ln in lines:
        cost_fields = _inventory_line_value_fields(ln.item, ln.quantity or Decimal("0"))
        total_value += Decimal(cost_fields["line_value"])
        line_rows.append(
            {
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "") if ln.item_id else "",
                "quantity": _serialize_decimal(ln.quantity),
                **cost_fields,
            }
        )
    return {
        "id": rec.id,
        "movement_type": "shop_to_pond",
        "receipt_number": rec.receipt_number or "",
        "document_number": rec.receipt_number or "",
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
        "from_station_id": rec.from_station_id,
        "from_station_name": (rec.from_station.station_name or "") if rec.from_station_id else "",
        "pond_id": rec.pond_id,
        "pond_name": (rec.pond.name or "") if rec.pond_id else "",
        "to_station_id": None,
        "to_station_name": "",
        "total_value": _serialize_decimal(total_value.quantize(Decimal("0.01"))),
        "lines": line_rows,
    }


def _pond_return_to_json(ret: PondWarehouseStockReturn) -> dict:
    lines = list(ret.lines.all().select_related("item"))
    line_rows = []
    total_value = Decimal("0")
    for ln in lines:
        cost_fields = _inventory_line_value_fields(ln.item, ln.quantity or Decimal("0"))
        total_value += Decimal(cost_fields["line_value"])
        line_rows.append(
            {
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "") if ln.item_id else "",
                "quantity": _serialize_decimal(ln.quantity),
                **cost_fields,
            }
        )
    return {
        "id": ret.id,
        "movement_type": "pond_to_shop",
        "return_number": ret.return_number or "",
        "document_number": ret.return_number or "",
        "created_at": ret.created_at.isoformat() if ret.created_at else None,
        "from_station_id": None,
        "from_station_name": "",
        "pond_id": ret.pond_id,
        "pond_name": (ret.pond.name or "") if ret.pond_id else "",
        "to_station_id": ret.to_station_id,
        "to_station_name": (ret.to_station.station_name or "") if ret.to_station_id else "",
        "memo": ret.memo or "",
        "total_value": _serialize_decimal(total_value.quantize(Decimal("0.01"))),
        "lines": line_rows,
    }


def _transfer_to_json(tr: InventoryTransfer):
    lines = list(tr.lines.all().select_related("item"))
    posted = tr.status == InventoryTransfer.STATUS_POSTED
    line_rows = []
    total_value = Decimal("0")
    for ln in lines:
        cost_fields = _inventory_line_value_fields(ln.item, ln.quantity or Decimal("0"))
        total_value += Decimal(cost_fields["line_value"])
        line_rows.append(
            {
                "id": ln.id,
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "") if ln.item_id else "",
                "quantity": _serialize_decimal(ln.quantity),
                **cost_fields,
            }
        )
    return {
        "id": tr.id,
        "transfer_number": tr.transfer_number or "",
        "transfer_date": tr.transfer_date.isoformat() if tr.transfer_date else None,
        "status": tr.status,
        "memo": tr.memo or "",
        "from_station_id": tr.from_station_id,
        "to_station_id": tr.to_station_id,
        "from_station_name": (tr.from_station.station_name or "") if tr.from_station_id else "",
        "to_station_name": (tr.to_station.station_name or "") if tr.to_station_id else "",
        "posted_at": tr.posted_at.isoformat() if tr.posted_at else None,
        "auto_journal_entry_number": (f"AUTO-ISTR-{tr.id}" if posted else None),
        "total_value": _serialize_decimal(total_value.quantize(Decimal("0.01"))),
        "lines": line_rows,
    }


def _parse_interstation_transfer_draft_body(
    *,
    cid: int,
    body: dict,
    request,
    editing_transfer: InventoryTransfer | None = None,
) -> JsonResponse | tuple[int, int, date, str, list[tuple[Item, Decimal]]]:
    """
    Validate JSON for creating or updating an inter-station transfer draft.
    Returns an error JsonResponse or (from_station_id, to_station_id, transfer_date, memo, parsed_lines).
    """
    try:
        fs = int(body.get("from_station_id"))
        ts = int(body.get("to_station_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "from_station_id and to_station_id are required"}, status=400)
    if fs == ts:
        return JsonResponse({"detail": "from_station_id and to_station_id must differ"}, status=400)
    n_active = Station.objects.filter(company_id=cid, is_active=True).count()
    if n_active < 2:
        return JsonResponse(
            {
                "detail": (
                    "At least two active sites are required to move stock between stations. "
                    "With one site, shop stock lives at that site only; turn on multiple sites in Company if you operate more than one location."
                )
            },
            status=400,
        )
    api = getattr(request, "api_user", None)
    if api:
        u = User.objects.filter(pk=getattr(api, "id", None)).only("home_station_id").first()
        h = u.home_station_id if u else None
        if h and int(fs) != int(h) and int(ts) != int(h):
            return JsonResponse(
                {
                    "detail": "Your account is tied to one site — transfers must involve your home site "
                    "as the sender or receiver."
                },
                status=403,
            )
    if not Station.objects.filter(
        pk=fs, company_id=cid, is_active=True
    ).exists() or not Station.objects.filter(pk=ts, company_id=cid, is_active=True).exists():
        return JsonResponse({"detail": "Invalid station for this company"}, status=400)

    raw_date = body.get("transfer_date")
    if not raw_date:
        td = timezone.localdate()
    else:
        try:
            td = date.fromisoformat(str(raw_date).split("T")[0])
        except Exception:
            return JsonResponse({"detail": "Invalid transfer_date"}, status=400)
    lines_in = body.get("lines")
    if not isinstance(lines_in, list) or not lines_in:
        return JsonResponse({"detail": "lines must be a non-empty array of {item_id, quantity}"}, status=400)
    memo = (body.get("memo") or "")[:500]
    parsed_lines: list[tuple[Item, Decimal]] = []
    for row in lines_in:
        try:
            iid = int(row.get("item_id"))
            q = Decimal(str(row.get("quantity")))
        except Exception:
            return JsonResponse({"detail": "Each line needs item_id and quantity"}, status=400)
        if q <= 0:
            return JsonResponse({"detail": "Quantity must be positive"}, status=400)
        it = Item.objects.filter(pk=iid, company_id=cid).first()
        if not it:
            return JsonResponse({"detail": f"Unknown item_id {iid}"}, status=404)
        if not item_uses_station_bins(cid, it):
            return JsonResponse(
                {
                    "detail": (
                        f'"{it.name}" is not a shop (per-station) product. '
                        "Transfer fuel using tank operations; tank stock is not moved by this screen."
                    )
                },
                status=400,
            )
        parsed_lines.append((it, q))
    need_by_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    items_by_id: dict[int, Item] = {}
    for it, q in parsed_lines:
        need_by_item[it.id] += q
        items_by_id[it.id] = it
    for iid, total_need in need_by_item.items():
        it = items_by_id[iid]
        have = get_station_stock(cid, fs, iid)
        if editing_transfer is not None and int(editing_transfer.from_station_id) == int(fs):
            reserved = (
                InventoryTransferLine.objects.filter(
                    transfer_id=editing_transfer.id, item_id=iid
                ).aggregate(s=Sum("quantity"))["s"]
                or Decimal("0")
            )
            have += reserved
        if total_need > have:
            return JsonResponse(
                {
                    "detail": (
                        f'Not enough stock of "{it.name}" at the source station to save this transfer: '
                        f"need {_serialize_decimal(total_need)} in total but only {_serialize_decimal(have)} on hand."
                    )
                },
                status=400,
            )
    return fs, ts, td, memo, parsed_lines


def _transfer_stock_lines_reverse(
    cid: int, from_station_id: int, to_station_id: int, lines: list
) -> None:
    """Undo a posted transfer's bin movement (destination −qty, source +qty)."""
    for ln in lines:
        qty = ln.quantity or Decimal("0")
        if qty <= 0:
            continue
        add_station_stock(cid, to_station_id, ln.item_id, -qty)
        add_station_stock(cid, from_station_id, ln.item_id, qty)


def _transfer_stock_lines_apply(
    cid: int, from_station_id: int, to_station_id: int, parsed_lines: list[tuple[Item, Decimal]]
) -> None:
    for it, qty in parsed_lines:
        if qty <= 0:
            continue
        add_station_stock(cid, from_station_id, it.id, -qty)
        add_station_stock(cid, to_station_id, it.id, qty)


def _validate_destination_can_reverse_transfer(
    cid: int, to_station_id: int, lines: list, *, items_by_id: dict[int, Item]
) -> JsonResponse | None:
    need_by_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for ln in lines:
        qty = ln.quantity or Decimal("0")
        if qty <= 0:
            continue
        need_by_item[ln.item_id] += qty
    for iid, total_need in need_by_item.items():
        it = items_by_id[iid]
        have = get_station_stock(cid, to_station_id, iid)
        if total_need > have:
            return JsonResponse(
                {
                    "detail": (
                        f'Cannot update: not enough "{(it.name or "").strip()}" at the receiving site to '
                        f"reverse the current transfer: need {_serialize_decimal(total_need)} but only "
                        f"{_serialize_decimal(have)} on hand."
                    )
                },
                status=400,
            )
    return None


def _inventory_transfer_amend_posted(request, tr: InventoryTransfer) -> JsonResponse:
    """Reverse prior bin movement, apply new lines/stations, refresh AUTO-ISTR journal."""
    cid = request.company_id
    if tr.status != InventoryTransfer.STATUS_POSTED:
        return JsonResponse({"detail": "Only posted transfers can be amended this way"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    parsed = _parse_interstation_transfer_draft_body(cid=cid, body=body, request=request)
    if isinstance(parsed, JsonResponse):
        return parsed
    fs, ts, td, memo, parsed_lines = parsed
    with transaction.atomic():
        locked = (
            InventoryTransfer.objects.select_for_update()
            .filter(pk=tr.pk, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryTransfer.STATUS_POSTED:
            return JsonResponse({"detail": "Transfer is not posted"}, status=400)
        old_lines = list(
            InventoryTransferLine.objects.filter(transfer_id=locked.id).select_related("item")
        )
        items_by_id: dict[int, Item] = {ln.item_id: ln.item for ln in old_lines if ln.item_id}
        err_resp = _validate_destination_can_reverse_transfer(
            cid, locked.to_station_id, old_lines, items_by_id=items_by_id
        )
        if err_resp:
            return err_resp
        reverse_delta: defaultdict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))
        for ln in old_lines:
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            reverse_delta[(locked.to_station_id, ln.item_id)] -= qty
            reverse_delta[(locked.from_station_id, ln.item_id)] += qty

        def stock_after_reverse(station_id: int, item_id: int) -> Decimal:
            return get_station_stock(cid, station_id, item_id) + reverse_delta.get(
                (station_id, item_id), Decimal("0")
            )

        need_by_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
        new_items: dict[int, Item] = {}
        for it, q in parsed_lines:
            need_by_item[it.id] += q
            new_items[it.id] = it
        for iid, total_need in need_by_item.items():
            it = new_items[iid]
            have = stock_after_reverse(fs, iid)
            if total_need > have:
                return JsonResponse(
                    {
                        "detail": (
                            f'Not enough stock of "{it.name}" at the source station after reversing the '
                            f"prior move: need {_serialize_decimal(total_need)} but only "
                            f"{_serialize_decimal(have)} on hand."
                        )
                    },
                    status=400,
                )
        _transfer_stock_lines_reverse(cid, locked.from_station_id, locked.to_station_id, old_lines)
        delete_auto_inventory_transfer_journal(cid, locked.id)
        locked.from_station_id = fs
        locked.to_station_id = ts
        locked.transfer_date = td
        locked.memo = memo
        locked.save()
        InventoryTransferLine.objects.filter(transfer_id=locked.pk).delete()
        for it, q in parsed_lines:
            InventoryTransferLine.objects.create(transfer=locked, item=it, quantity=q)
        _transfer_stock_lines_apply(cid, fs, ts, parsed_lines)
        post_inventory_transfer_journal(cid, locked.id)
    tr2 = (
        InventoryTransfer.objects.filter(pk=tr.pk)
        .select_related("from_station", "to_station")
        .first()
    )
    return JsonResponse(_transfer_to_json(tr2 or tr))


def _inventory_transfer_put_draft(request, tr: InventoryTransfer) -> JsonResponse:
    cid = request.company_id
    if tr.status != InventoryTransfer.STATUS_DRAFT:
        return JsonResponse({"detail": "Only draft transfers can be updated"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    parsed = _parse_interstation_transfer_draft_body(
        cid=cid, body=body, request=request, editing_transfer=tr
    )
    if isinstance(parsed, JsonResponse):
        return parsed
    fs, ts, td, memo, parsed_lines = parsed
    with transaction.atomic():
        locked = (
            InventoryTransfer.objects.select_for_update()
            .filter(pk=tr.pk, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryTransfer.STATUS_DRAFT:
            return JsonResponse({"detail": "Transfer is not a draft"}, status=400)
        locked.from_station_id = fs
        locked.to_station_id = ts
        locked.transfer_date = td
        locked.memo = memo
        locked.save()
        InventoryTransferLine.objects.filter(transfer_id=locked.pk).delete()
        for it, q in parsed_lines:
            InventoryTransferLine.objects.create(transfer=locked, item=it, quantity=q)
    tr2 = (
        InventoryTransfer.objects.filter(pk=tr.pk)
        .select_related("from_station", "to_station")
        .first()
    )
    return JsonResponse(_transfer_to_json(tr2 or tr))


@require_GET
@auth_required
@require_company_id
def pond_warehouse_receipts_list(request):
    """
    GET /api/inventory/pond-warehouse-receipts/
    Shop → pond warehouse moves (immediate); same home-station visibility rule as inter-station transfers.
    """
    cid = request.company_id
    line_qs = PondWarehouseStockReceiptLine.objects.select_related("item")
    qs = (
        PondWarehouseStockReceipt.objects.filter(company_id=cid)
        .select_related("from_station", "pond")
        .prefetch_related(Prefetch("lines", queryset=line_qs))
    )
    h = _user_home_station_id(request)
    if h is not None:
        qs = qs.filter(from_station_id=h)
    qs = qs.order_by("-created_at", "-id")[:200]
    return JsonResponse([_pond_receipt_to_json(r) for r in qs], safe=False)


@csrf_exempt
@require_http_methods(["GET", "PUT"])
@auth_required
@require_company_id
def pond_warehouse_receipt_detail_or_amend(request, receipt_id: int):
    """GET one receipt; PUT amends lines/route and updates shop + pond warehouse stock."""
    cid = request.company_id
    line_qs = PondWarehouseStockReceiptLine.objects.select_related("item")
    rec = (
        PondWarehouseStockReceipt.objects.filter(pk=receipt_id, company_id=cid)
        .select_related("from_station", "pond")
        .prefetch_related(Prefetch("lines", queryset=line_qs))
        .first()
    )
    if not rec or not _pond_receipt_visible_for_user(request, rec):
        return JsonResponse({"detail": "Receipt not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_pond_receipt_to_json(rec))

    body, err = parse_json_body(request)
    if err:
        return err
    raw_sid = body.get("station_id")
    raw_pid = body.get("pond_id")
    if raw_sid is None or raw_sid == "":
        return JsonResponse({"detail": "station_id is required"}, status=400)
    if raw_pid is None or raw_pid == "":
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    try:
        station_id = int(raw_sid)
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "station_id and pond_id must be integers"}, status=400)
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return JsonResponse({"detail": "items must be a non-empty array of { item_id, quantity }"}, status=400)
    try:
        rec2 = amend_pond_warehouse_stock_receipt(
            company_id=cid,
            receipt_id=receipt_id,
            station_id=station_id,
            pond_id=pond_id,
            items=items,
        )
    except StockBusinessError as ex:
        return JsonResponse({"detail": ex.detail}, status=400)
    rec3 = (
        PondWarehouseStockReceipt.objects.filter(pk=rec2.pk, company_id=cid)
        .select_related("from_station", "pond")
        .prefetch_related(Prefetch("lines", queryset=line_qs))
        .first()
    )
    return JsonResponse(_pond_receipt_to_json(rec3 or rec2))


@require_GET
@auth_required
@require_company_id
def inventory_item_availability(request):
    """
    GET /api/inventory/availability/?item_id=
    Returns per-station on-hand for shop (non-tank) SKUs; fuel/tank products return tank-based info only at tank APIs.
    For aquaculture, also returns pond_warehouses (ItemPondStock) with quantity > 0 — feeding apply consumes pond
    warehouse, not station bins.
    """
    raw = request.GET.get("item_id")
    if not raw:
        return JsonResponse({"detail": "item_id is required"}, status=400)
    try:
        iid = int(raw)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "item_id must be an integer"}, status=400)
    it = Item.objects.filter(pk=iid, company_id=request.company_id).first()
    if not it:
        return JsonResponse({"detail": "Item not found"}, status=404)
    if not item_uses_station_bins(request.company_id, it):
        return JsonResponse(
            {
                "item_id": it.id,
                "name": it.name,
                "tracks_per_station": False,
                "message": "This product is tracked in fuel tanks, not per-station shop bins.",
                "stations": [],
            }
        )
    pond_rows = [
        p
        for p in per_pond_quantities(request.company_id, it.id)
        if Decimal(str(p.get("quantity") or "0")) > 0
    ]
    return JsonResponse(
        {
            "item_id": it.id,
            "name": it.name,
            "tracks_per_station": True,
            "unit": it.unit or "piece",
            "total_on_hand": _serialize_decimal(it.quantity_on_hand or Decimal("0")),
            "stations": per_station_quantities(request.company_id, it.id),
            "pond_warehouses": pond_rows,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def inventory_transfers_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = InventoryTransfer.objects.filter(company_id=cid).select_related("from_station", "to_station")
        h = _user_home_station_id(request)
        if h is not None:
            qs = qs.filter(Q(from_station_id=h) | Q(to_station_id=h))
        qs = qs.order_by("-transfer_date", "-id")[:200]
        return JsonResponse([_transfer_to_json(t) for t in qs], safe=False)
    body, err = parse_json_body(request)
    if err:
        return err
    parsed = _parse_interstation_transfer_draft_body(cid=cid, body=body, request=request)
    if isinstance(parsed, JsonResponse):
        return parsed
    fs, ts, td, memo, parsed_lines = parsed
    with transaction.atomic():
        tr = InventoryTransfer(
            company_id=cid,
            from_station_id=fs,
            to_station_id=ts,
            transfer_date=td,
            status=InventoryTransfer.STATUS_DRAFT,
            memo=memo,
        )
        tr.save()
        tr.transfer_number = f"TR-{tr.id}"
        tr.save(update_fields=["transfer_number"])
        for it, q in parsed_lines:
            InventoryTransferLine.objects.create(transfer=tr, item=it, quantity=q)
    tr2 = (
        InventoryTransfer.objects.filter(pk=tr.id)
        .select_related("from_station", "to_station")
        .first()
    )
    return JsonResponse(_transfer_to_json(tr2 or tr), status=201)


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
@auth_required
@require_company_id
def inventory_transfer_detail_or_post(request, transfer_id: int):
    cid = request.company_id
    tr = (
        InventoryTransfer.objects.filter(pk=transfer_id, company_id=cid)
        .select_related("from_station", "to_station")
        .first()
    )
    if not tr:
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if not _inventory_transfer_visible_for_user(request, tr):
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_transfer_to_json(tr))
    if request.method == "PUT":
        if tr.status == InventoryTransfer.STATUS_POSTED:
            return _inventory_transfer_amend_posted(request, tr)
        return _inventory_transfer_put_draft(request, tr)
    if tr.status == InventoryTransfer.STATUS_POSTED:
        return JsonResponse({"detail": "Transfer is already posted"}, status=400)
    with transaction.atomic():
        locked = (
            InventoryTransfer.objects.select_for_update()
            .filter(pk=tr.id, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryTransfer.STATUS_DRAFT:
            return JsonResponse({"detail": "Transfer is not a draft"}, status=400)
        lines = list(
            InventoryTransferLine.objects.filter(transfer_id=locked.id).select_related("item")
        )
        need_by_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
        items_by_id: dict[int, Item] = {}
        for ln in lines:
            it = ln.item
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            need_by_item[it.id] += qty
            items_by_id[it.id] = it
        for iid, total_need in need_by_item.items():
            it = items_by_id[iid]
            have = get_station_stock(cid, locked.from_station_id, iid)
            if total_need > have:
                return JsonResponse(
                    {
                        "detail": (
                            f'Not enough stock of "{it.name}" at source station: '
                            f"need {_serialize_decimal(total_need)} in total across lines but only "
                            f"{_serialize_decimal(have)} on hand."
                        )
                    },
                    status=400,
                )
        for ln in lines:
            it = ln.item
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            add_station_stock(cid, locked.from_station_id, it.id, -qty)
            add_station_stock(cid, locked.to_station_id, it.id, qty)
        now = timezone.now()
        InventoryTransfer.objects.filter(pk=locked.id).update(
            status=InventoryTransfer.STATUS_POSTED,
            posted_at=now,
        )
    post_inventory_transfer_journal(cid, transfer_id)
    tr.refresh_from_db()
    return JsonResponse(_transfer_to_json(tr))


@csrf_exempt
@require_http_methods(["DELETE"])
@auth_required
@require_company_id
def inventory_transfer_delete(request, transfer_id: int):
    cid = request.company_id
    tr = InventoryTransfer.objects.filter(pk=transfer_id, company_id=cid).first()
    if not tr:
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if not _inventory_transfer_visible_for_user(request, tr):
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if tr.status == InventoryTransfer.STATUS_POSTED:
        return JsonResponse({"detail": "Cannot delete a posted transfer"}, status=400)
    tr.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def inventory_transfer_unpost(request, transfer_id: int):
    """
    Roll back a posted inter-station transfer: return stock to the source station, remove AUTO-ISTR journal,
    set transfer back to draft (lines preserved).
    """
    cid = request.company_id
    tr = (
        InventoryTransfer.objects.filter(pk=transfer_id, company_id=cid)
        .select_related("from_station", "to_station")
        .first()
    )
    if not tr:
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if not _inventory_transfer_visible_for_user(request, tr):
        return JsonResponse({"detail": "Transfer not found"}, status=404)
    if tr.status != InventoryTransfer.STATUS_POSTED:
        return JsonResponse({"detail": "Only posted transfers can be rolled back"}, status=400)
    with transaction.atomic():
        locked = (
            InventoryTransfer.objects.select_for_update()
            .filter(pk=tr.id, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryTransfer.STATUS_POSTED:
            return JsonResponse({"detail": "Transfer is not posted"}, status=400)
        lines = list(
            InventoryTransferLine.objects.filter(transfer_id=locked.id).select_related("item")
        )
        need_by_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
        items_by_id: dict[int, Item] = {}
        for ln in lines:
            it = ln.item
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            need_by_item[it.id] += qty
            items_by_id[it.id] = it
        for iid, total_need in need_by_item.items():
            it = items_by_id[iid]
            have = get_station_stock(cid, locked.to_station_id, iid)
            if total_need > have:
                return JsonResponse(
                    {
                        "detail": (
                            f'Cannot roll back: not enough "{it.name}" at the receiving station to return: '
                            f"need {_serialize_decimal(total_need)} but only {_serialize_decimal(have)} on hand."
                        )
                    },
                    status=400,
                )
        for ln in lines:
            it = ln.item
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            add_station_stock(cid, locked.to_station_id, it.id, -qty)
            add_station_stock(cid, locked.from_station_id, it.id, qty)
        delete_auto_inventory_transfer_journal(cid, transfer_id)
        InventoryTransfer.objects.filter(pk=locked.id).update(
            status=InventoryTransfer.STATUS_DRAFT,
            posted_at=None,
        )
    tr2 = (
        InventoryTransfer.objects.filter(pk=transfer_id, company_id=cid)
        .select_related("from_station", "to_station")
        .first()
    )
    return JsonResponse(_transfer_to_json(tr2 or tr))


_ADJUSTMENT_REASONS = {"count", "damage", "theft", "expiry", "other"}


def _inventory_adjustment_visible_for_user(request, adj: InventoryAdjustment) -> bool:
    h = _user_home_station_id(request)
    if h is None:
        return True
    return int(adj.station_id) == h


def _adjustment_to_json(adj: InventoryAdjustment) -> dict:
    lines = list(adj.lines.all().select_related("item"))
    posted = adj.status == InventoryAdjustment.STATUS_POSTED
    return {
        "id": adj.id,
        "adjustment_number": adj.adjustment_number or "",
        "adjustment_date": adj.adjustment_date.isoformat() if adj.adjustment_date else None,
        "status": adj.status,
        "reason": adj.reason or "count",
        "memo": adj.memo or "",
        "station_id": adj.station_id,
        "station_name": (adj.station.station_name or "") if adj.station_id else "",
        "posted_at": adj.posted_at.isoformat() if adj.posted_at else None,
        "auto_journal_entry_number": (f"AUTO-INVADJ-{adj.id}" if posted else None),
        "lines": [
            {
                "id": ln.id,
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "") if ln.item_id else "",
                "unit": (ln.item.unit or "piece") if ln.item_id else "",
                "counted_quantity": _serialize_decimal(ln.counted_quantity),
                "book_quantity": _serialize_decimal(ln.book_quantity)
                if ln.book_quantity is not None
                else None,
                "unit_cost": _serialize_decimal(ln.unit_cost) if ln.unit_cost is not None else None,
            }
            for ln in lines
        ],
    }


def _parse_adjustment_draft_body(*, cid: int, body: dict, request):
    """Validate JSON for creating/updating a stock-adjustment draft.

    Returns an error JsonResponse, or (station_id, date, reason, memo, [(Item, counted_qty)]).
    """
    try:
        sid = int(body.get("station_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "station_id is required"}, status=400)
    if not Station.objects.filter(pk=sid, company_id=cid, is_active=True).exists():
        return JsonResponse({"detail": "Invalid station for this company"}, status=400)
    h = _user_home_station_id(request)
    if h is not None and int(sid) != int(h):
        return JsonResponse(
            {"detail": "You can only adjust stock for your assigned home station."}, status=403
        )

    raw_date = body.get("adjustment_date")
    if not raw_date:
        ad = timezone.localdate()
    else:
        try:
            ad = date.fromisoformat(str(raw_date).split("T")[0])
        except Exception:
            return JsonResponse({"detail": "Invalid adjustment_date"}, status=400)

    reason = (body.get("reason") or "count").strip().lower()
    if reason not in _ADJUSTMENT_REASONS:
        return JsonResponse(
            {"detail": f"reason must be one of: {', '.join(sorted(_ADJUSTMENT_REASONS))}"},
            status=400,
        )
    memo = (body.get("memo") or "")[:500]

    lines_in = body.get("lines")
    if not isinstance(lines_in, list) or not lines_in:
        return JsonResponse(
            {"detail": "lines must be a non-empty array of {item_id, counted_quantity}"},
            status=400,
        )
    seen: set[int] = set()
    parsed_lines: list[tuple[Item, Decimal]] = []
    for row in lines_in:
        try:
            iid = int(row.get("item_id"))
            counted = Decimal(str(row.get("counted_quantity")))
        except Exception:
            return JsonResponse({"detail": "Each line needs item_id and counted_quantity"}, status=400)
        if counted < 0:
            return JsonResponse({"detail": "counted_quantity cannot be negative"}, status=400)
        if iid in seen:
            return JsonResponse(
                {"detail": "Each item can appear only once per adjustment"}, status=400
            )
        seen.add(iid)
        it = Item.objects.filter(pk=iid, company_id=cid).first()
        if not it:
            return JsonResponse({"detail": f"Unknown item_id {iid}"}, status=404)
        if not item_uses_station_bins(cid, it):
            return JsonResponse(
                {
                    "detail": (
                        f'"{it.name}" is not a shop (per-station) product. '
                        "Adjust fuel with tank dips and fish with the aquaculture stock ledger."
                    )
                },
                status=400,
            )
        parsed_lines.append((it, counted))
    return sid, ad, reason, memo, parsed_lines


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def inventory_adjustments_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = InventoryAdjustment.objects.filter(company_id=cid).select_related("station")
        h = _user_home_station_id(request)
        if h is not None:
            qs = qs.filter(station_id=h)
        qs = qs.order_by("-adjustment_date", "-id")[:200]
        return JsonResponse([_adjustment_to_json(a) for a in qs], safe=False)
    body, err = parse_json_body(request)
    if err:
        return err
    parsed = _parse_adjustment_draft_body(cid=cid, body=body, request=request)
    if isinstance(parsed, JsonResponse):
        return parsed
    sid, ad, reason, memo, parsed_lines = parsed
    with transaction.atomic():
        adj = InventoryAdjustment(
            company_id=cid,
            station_id=sid,
            adjustment_date=ad,
            reason=reason,
            status=InventoryAdjustment.STATUS_DRAFT,
            memo=memo,
        )
        adj.save()
        adj.adjustment_number = f"ADJ-{adj.id}"
        adj.save(update_fields=["adjustment_number"])
        for it, counted in parsed_lines:
            InventoryAdjustmentLine.objects.create(
                adjustment=adj, item=it, counted_quantity=counted
            )
    adj2 = InventoryAdjustment.objects.filter(pk=adj.id).select_related("station").first()
    return JsonResponse(_adjustment_to_json(adj2 or adj), status=201)


def _inventory_adjustment_put_draft(request, adj: InventoryAdjustment) -> JsonResponse:
    cid = request.company_id
    if adj.status != InventoryAdjustment.STATUS_DRAFT:
        return JsonResponse({"detail": "Only draft adjustments can be updated"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    parsed = _parse_adjustment_draft_body(cid=cid, body=body, request=request)
    if isinstance(parsed, JsonResponse):
        return parsed
    sid, ad, reason, memo, parsed_lines = parsed
    with transaction.atomic():
        locked = (
            InventoryAdjustment.objects.select_for_update()
            .filter(pk=adj.pk, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryAdjustment.STATUS_DRAFT:
            return JsonResponse({"detail": "Adjustment is not a draft"}, status=400)
        locked.station_id = sid
        locked.adjustment_date = ad
        locked.reason = reason
        locked.memo = memo
        locked.save()
        InventoryAdjustmentLine.objects.filter(adjustment_id=locked.pk).delete()
        for it, counted in parsed_lines:
            InventoryAdjustmentLine.objects.create(
                adjustment=locked, item=it, counted_quantity=counted
            )
    adj2 = InventoryAdjustment.objects.filter(pk=adj.pk).select_related("station").first()
    return JsonResponse(_adjustment_to_json(adj2 or adj))


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
@auth_required
@require_company_id
def inventory_adjustment_detail_or_post(request, adjustment_id: int):
    cid = request.company_id
    adj = (
        InventoryAdjustment.objects.filter(pk=adjustment_id, company_id=cid)
        .select_related("station")
        .first()
    )
    if not adj:
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if not _inventory_adjustment_visible_for_user(request, adj):
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_adjustment_to_json(adj))
    if request.method == "PUT":
        return _inventory_adjustment_put_draft(request, adj)
    if adj.status == InventoryAdjustment.STATUS_POSTED:
        return JsonResponse({"detail": "Adjustment is already posted"}, status=400)
    with transaction.atomic():
        locked = (
            InventoryAdjustment.objects.select_for_update()
            .filter(pk=adj.id, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryAdjustment.STATUS_DRAFT:
            return JsonResponse({"detail": "Adjustment is not a draft"}, status=400)
        lines = list(
            InventoryAdjustmentLine.objects.filter(adjustment_id=locked.id).select_related("item")
        )
        if not lines:
            return JsonResponse({"detail": "Add at least one item before posting"}, status=400)
        for ln in lines:
            it = ln.item
            book = get_station_stock(cid, locked.station_id, it.id)
            counted = ln.counted_quantity if ln.counted_quantity is not None else Decimal("0")
            ln.book_quantity = book
            ln.unit_cost = item_inventory_unit_cost(it)
            ln.save(update_fields=["book_quantity", "unit_cost"])
            set_station_stock(cid, locked.station_id, it.id, counted)
        now = timezone.now()
        InventoryAdjustment.objects.filter(pk=locked.id).update(
            status=InventoryAdjustment.STATUS_POSTED,
            posted_at=now,
        )
    post_inventory_adjustment_journal(cid, adjustment_id)
    adj.refresh_from_db()
    return JsonResponse(_adjustment_to_json(adj))


@csrf_exempt
@require_http_methods(["DELETE"])
@auth_required
@require_company_id
def inventory_adjustment_delete(request, adjustment_id: int):
    cid = request.company_id
    adj = InventoryAdjustment.objects.filter(pk=adjustment_id, company_id=cid).first()
    if not adj:
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if not _inventory_adjustment_visible_for_user(request, adj):
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if adj.status == InventoryAdjustment.STATUS_POSTED:
        return JsonResponse({"detail": "Cannot delete a posted adjustment"}, status=400)
    adj.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def inventory_adjustment_unpost(request, adjustment_id: int):
    """Roll back a posted stock adjustment: restore each item's on-hand to the booked quantity,
    remove the AUTO-INVADJ journal, and set the adjustment back to draft (counted lines preserved)."""
    cid = request.company_id
    adj = (
        InventoryAdjustment.objects.filter(pk=adjustment_id, company_id=cid)
        .select_related("station")
        .first()
    )
    if not adj:
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if not _inventory_adjustment_visible_for_user(request, adj):
        return JsonResponse({"detail": "Adjustment not found"}, status=404)
    if adj.status != InventoryAdjustment.STATUS_POSTED:
        return JsonResponse({"detail": "Only posted adjustments can be rolled back"}, status=400)
    with transaction.atomic():
        locked = (
            InventoryAdjustment.objects.select_for_update()
            .filter(pk=adj.id, company_id=cid)
            .first()
        )
        if not locked or locked.status != InventoryAdjustment.STATUS_POSTED:
            return JsonResponse({"detail": "Adjustment is not posted"}, status=400)
        lines = list(
            InventoryAdjustmentLine.objects.filter(adjustment_id=locked.id).select_related("item")
        )
        for ln in lines:
            it = ln.item
            book = ln.book_quantity if ln.book_quantity is not None else Decimal("0")
            set_station_stock(cid, locked.station_id, it.id, book)
            ln.book_quantity = None
            ln.unit_cost = None
            ln.save(update_fields=["book_quantity", "unit_cost"])
        delete_auto_inventory_adjustment_journal(cid, adjustment_id)
        InventoryAdjustment.objects.filter(pk=locked.id).update(
            status=InventoryAdjustment.STATUS_DRAFT,
            posted_at=None,
        )
    adj2 = InventoryAdjustment.objects.filter(pk=adjustment_id, company_id=cid).select_related("station").first()
    return JsonResponse(_adjustment_to_json(adj2 or adj))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def pond_warehouse_receipt_reverse_view(request, receipt_id: int):
    """Undo a shop → pond warehouse move if the pond still holds the quantities."""
    cid = request.company_id
    rec = PondWarehouseStockReceipt.objects.filter(pk=receipt_id, company_id=cid).first()
    if not rec:
        return JsonResponse({"detail": "Receipt not found"}, status=404)
    if not _pond_receipt_visible_for_user(request, rec):
        return JsonResponse({"detail": "Receipt not found"}, status=404)
    try:
        reverse_pond_warehouse_stock_receipt(company_id=cid, receipt_id=receipt_id)
    except StockBusinessError as ex:
        return JsonResponse({"detail": ex.detail}, status=400)
    return JsonResponse({"detail": "Receipt reversed; stock returned to the shop station."}, status=200)


@require_GET
@auth_required
@require_company_id
def pond_warehouse_returns_list(request):
    """
    GET /api/inventory/pond-warehouse-returns/
    Pond warehouse → shop moves (immediate); home-station users see returns into their site.
    """
    cid = request.company_id
    line_qs = PondWarehouseStockReturnLine.objects.select_related("item")
    qs = (
        PondWarehouseStockReturn.objects.filter(company_id=cid)
        .select_related("pond", "to_station")
        .prefetch_related(Prefetch("lines", queryset=line_qs))
    )
    h = _user_home_station_id(request)
    if h is not None:
        qs = qs.filter(to_station_id=h)
    qs = qs.order_by("-created_at", "-id")[:200]
    return JsonResponse([_pond_return_to_json(r) for r in qs], safe=False)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def pond_warehouse_return_reverse_view(request, return_id: int):
    """Undo a pond → shop warehouse move if the shop still holds the quantities."""
    cid = request.company_id
    ret = PondWarehouseStockReturn.objects.filter(pk=return_id, company_id=cid).first()
    if not ret:
        return JsonResponse({"detail": "Return not found"}, status=404)
    if not _pond_return_visible_for_user(request, ret):
        return JsonResponse({"detail": "Return not found"}, status=404)
    try:
        reverse_pond_warehouse_stock_return(company_id=cid, return_id=return_id)
    except StockBusinessError as ex:
        return JsonResponse({"detail": ex.detail}, status=400)
    return JsonResponse({"detail": "Return reversed; stock moved back to the pond warehouse."}, status=200)
