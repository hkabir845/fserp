"""Per-station stock availability and inter-station transfers (shop inventory)."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import InventoryTransfer, InventoryTransferLine, Item, Station, User
from api.services.gl_posting import delete_auto_inventory_transfer_journal, post_inventory_transfer_journal
from api.services.station_stock import (
    add_station_stock,
    get_station_stock,
    item_uses_station_bins,
    per_station_quantities,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, _serialize_decimal


def _transfer_to_json(tr: InventoryTransfer):
    lines = list(tr.lines.all().select_related("item"))
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
        "lines": [
            {
                "id": ln.id,
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "") if ln.item_id else "",
                "quantity": _serialize_decimal(ln.quantity),
            }
            for ln in lines
        ],
    }


@require_GET
@auth_required
@require_company_id
def inventory_item_availability(request):
    """
    GET /api/inventory/availability/?item_id=
    Returns per-station on-hand for shop (non-tank) SKUs; fuel/tank products return tank-based info only at tank APIs.
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
    return JsonResponse(
        {
            "item_id": it.id,
            "name": it.name,
            "tracks_per_station": True,
            "unit": it.unit or "piece",
            "total_on_hand": _serialize_decimal(it.quantity_on_hand or Decimal("0")),
            "stations": per_station_quantities(request.company_id, it.id),
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
        api = getattr(request, "api_user", None)
        if api:
            u = User.objects.filter(pk=getattr(api, "id", None)).only("home_station_id").first()
            h = u.home_station_id if u else None
            if h:
                qs = qs.filter(Q(from_station_id=h) | Q(to_station_id=h))
        qs = qs.order_by("-transfer_date", "-id")[:200]
        return JsonResponse([_transfer_to_json(t) for t in qs], safe=False)
    body, err = parse_json_body(request)
    if err:
        return err
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
        if h and (int(fs) != int(h) or int(ts) != int(h)):
            return JsonResponse(
                {
                    "detail": "Moving stock between sites is restricted to users without a single-site assignment. "
                    "Use a company-wide account, or ask an admin to clear Home station on this user."
                },
                status=403,
            )
    if not Station.objects.filter(
        pk=fs, company_id=cid, is_active=True
    ).exists() or not Station.objects.filter(pk=ts, company_id=cid, is_active=True).exists():
        return JsonResponse({"detail": "Invalid station for this company"}, status=400)
    from datetime import date as date_cls

    raw_date = body.get("transfer_date")
    if not raw_date:
        td = timezone.localdate()
    else:
        try:
            td = date_cls.fromisoformat(str(raw_date).split("T")[0])
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
@require_http_methods(["GET", "POST"])
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
    if request.method == "GET":
        return JsonResponse(_transfer_to_json(tr))
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
        for ln in lines:
            it = ln.item
            qty = ln.quantity or Decimal("0")
            if qty <= 0:
                continue
            have = get_station_stock(cid, locked.from_station_id, it.id)
            if qty > have:
                return JsonResponse(
                    {
                        "detail": (
                            f'Not enough stock of "{it.name}" at source station: '
                            f"need {qty} but only {have} on hand."
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
    if tr.status == InventoryTransfer.STATUS_POSTED:
        return JsonResponse({"detail": "Cannot delete a posted transfer"}, status=400)
    tr.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)
