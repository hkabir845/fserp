"""Tank dips API: list, create, get, update, delete (company-scoped)."""
from __future__ import annotations

from datetime import date
from typing import Optional
from decimal import Decimal

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import TankDip, Tank
from api.services.station_capabilities import require_fuel_forecourt_station
from api.services.gl_posting import (
    bulk_sync_tank_dip_variance_journals,
    delete_tank_dip_variance_journal,
    sync_tank_dip_variance_journal,
    tank_dip_variance_gl_status,
)

_GL_SKIP_HINTS = {
    "no_book_snapshot": (
        "Book-at-dip snapshot missing (often legacy data). Edit this dip and save (without skip GL) "
        "or record a new dip so variance can post."
    ),
    "no_variance": "No variance vs book at dip — measured equaled system stock.",
    "item_cost_and_price_zero": (
        "Set cost or unit price on the tank’s product so the variance can be valued in BDT."
    ),
    "rounded_zero": "Variance value rounds to zero at current cost.",
    "missing_inventory_or_cogs_account": (
        "Chart is missing fuel inventory (1200) and/or fuel COGS (5100). Seed or add those accounts."
    ),
}


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _dip_to_json(d, company_id: Optional[int] = None):
    out = {
        "id": d.id,
        "tank_id": d.tank_id,
        "tank_name": d.tank.tank_name if d.tank_id else "",
        "dip_date": _serialize_date(d.dip_date),
        "volume": str(d.volume),
        "book_stock_before": str(d.book_stock_before) if d.book_stock_before is not None else None,
        "water_level": str(d.water_level) if d.water_level is not None else None,
        "notes": d.notes or "",
    }
    if company_id is not None:
        st = tank_dip_variance_gl_status(company_id, d)
        out["gl_journal_posted"] = st["posted"]
        out["gl_entry_number"] = st["entry_number"]
        sr = st["skip_reason"]
        out["gl_skip_reason"] = sr
        out["gl_journal_hint"] = _GL_SKIP_HINTS.get(sr) if sr else None
    return out


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def _reconcile_tank_book_stock(tank_id: int, company_id: int, volume: Decimal) -> None:
    """Set tank book stock to the physically measured volume (clamped to capacity)."""
    tank = Tank.objects.filter(id=tank_id, company_id=company_id).first()
    if not tank:
        return
    vol = _decimal(volume, Decimal("0"))
    if vol < 0:
        vol = Decimal("0")
    cap = tank.capacity or Decimal("0")
    if cap > 0 and vol > cap:
        vol = cap
    tank.current_stock = vol
    tank.save(update_fields=["current_stock"])


def reconcile_all_tanks_to_latest_dip(company_id: int) -> list[dict]:
    """
    For each tank that has at least one dip, set book stock (current_stock) to the latest dip's measured volume.
    Use after importing historical dips or if book drifted; POS sales / receipts after the dip will still move book.
    """
    results: list[dict] = []
    for tank in Tank.objects.filter(company_id=company_id).order_by("id"):
        latest = (
            TankDip.objects.filter(tank_id=tank.id, company_id=company_id)
            .order_by("-dip_date", "-id")
            .first()
        )
        if not latest:
            continue
        _reconcile_tank_book_stock(tank.id, company_id, latest.volume)
        tank.refresh_from_db()
        results.append(
            {
                "tank_id": tank.id,
                "tank_name": tank.tank_name,
                "book_liters": str(tank.current_stock),
                "dip_date": _serialize_date(latest.dip_date),
            }
        )
    return results


def _maybe_reconcile_tank_from_dip(dip: TankDip) -> None:
    """
    Update book stock only when this row is the latest dip for the tank (by dip_date, then id).
    Avoids historical edits overwriting current inventory.
    """
    latest = (
        TankDip.objects.filter(tank_id=dip.tank_id, company_id=dip.company_id)
        .order_by("-dip_date", "-id")
        .first()
    )
    if latest and latest.id == dip.id:
        _reconcile_tank_book_stock(dip.tank_id, dip.company_id, dip.volume)


@csrf_exempt
@auth_required
@require_company_id
def tank_dips_reconcile_all_from_latest(request):
    """POST: set every tank's book stock to its chronologically latest dip reading (company scope)."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    with transaction.atomic():
        results = reconcile_all_tanks_to_latest_dip(request.company_id)
    return JsonResponse(
        {
            "ok": True,
            "tanks_synced": len(results),
            "results": results,
        },
        status=200,
    )


@csrf_exempt
@auth_required
@require_company_id
def tank_dips_sync_variance_gl_all(request):
    """
    POST: re-post (or remove) variance journal for every tank dip using current Item cost/unit_price.

    Run after changing product unit to Liter, setting cost, etc. Replaces each AUTO-TANKDIP-{id}-VAR.
    """
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    result = bulk_sync_tank_dip_variance_journals(request.company_id)
    return JsonResponse({"ok": True, **result}, status=200)


@csrf_exempt
@auth_required
@require_company_id
def tank_dips_list_or_create(request):
    if request.method == "GET":
        qs = TankDip.objects.filter(company_id=request.company_id).select_related("tank").order_by("-dip_date", "-id")
        cid = request.company_id
        return JsonResponse([_dip_to_json(d, cid) for d in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        tank_id = body.get("tank_id")
        tank = Tank.objects.filter(id=tank_id, company_id=request.company_id).select_related("station").first()
        if not tank_id or not tank:
            return JsonResponse({"detail": "Valid tank_id required"}, status=400)
        serr = require_fuel_forecourt_station(request.company_id, tank.station_id)
        if serr:
            return serr
        book_before = tank.current_stock if tank.current_stock is not None else Decimal("0")
        d = TankDip(
            company_id=request.company_id,
            tank_id=tank_id,
            dip_date=_parse_date(body.get("dip_date")) or date.today(),
            volume=_decimal(body.get("volume")),
            book_stock_before=book_before,
            water_level=_decimal(body.get("water_level")) if body.get("water_level") is not None else None,
            notes=body.get("notes") or "",
        )
        skip_gl = bool(body.get("skip_variance_gl") or body.get("skip_gl"))
        with transaction.atomic():
            d.save()
            _maybe_reconcile_tank_from_dip(d)
            gl_info = None if skip_gl else sync_tank_dip_variance_journal(request.company_id, d.id)
        out = _dip_to_json(d, request.company_id)
        if not skip_gl:
            out["gl_variance"] = gl_info
        return JsonResponse(out, status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def tank_dip_detail(request, dip_id: int):
    d = TankDip.objects.filter(id=dip_id, company_id=request.company_id).select_related("tank").first()
    if not d:
        return JsonResponse({"detail": "Tank dip not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_dip_to_json(d, request.company_id))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("dip_date"):
            d.dip_date = _parse_date(body["dip_date"]) or d.dip_date
        if "volume" in body:
            d.volume = _decimal(body.get("volume"), d.volume)
        if "water_level" in body:
            d.water_level = _decimal(body.get("water_level")) if body.get("water_level") is not None else None
        if "notes" in body:
            d.notes = body.get("notes") or ""
        skip_gl = bool(body.get("skip_variance_gl") or body.get("skip_gl"))
        with transaction.atomic():
            d.save()
            _maybe_reconcile_tank_from_dip(d)
            gl_info = None if skip_gl else sync_tank_dip_variance_journal(request.company_id, d.id)
        out = _dip_to_json(d, request.company_id)
        if not skip_gl:
            out["gl_variance"] = gl_info
        return JsonResponse(out)
    if request.method == "DELETE":
        delete_tank_dip_variance_journal(request.company_id, dip_id)
        d.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)
