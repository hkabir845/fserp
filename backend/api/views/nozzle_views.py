"""Nozzles API: list, create, get, update, delete (company-scoped)."""
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Nozzle, Meter, Tank, Item
from api.services.reference_code import assign_string_code_if_empty, user_supplied_code_or_auto


def _decimal_val(v, default=0):
    if v is None:
        return default
    try:
        return float(Decimal(str(v)))
    except Exception:
        return default


def _nozzle_to_json(n):
    return {
        "id": n.id,
        "nozzle_number": n.nozzle_number or "",
        "nozzle_code": n.nozzle_code or "",
        "nozzle_name": n.nozzle_name or (n.nozzle_number or str(n.id)),
        "meter_id": n.meter_id,
        "tank_id": n.tank_id,
        "product_id": n.product_id if n.product_id else None,
        "color_code": getattr(n, "color_code", "#3B82F6") or "#3B82F6",
        "is_operational": getattr(n, "is_operational", True),
        "is_active": n.is_active,
    }


def _nozzle_to_pos_json(n):
    """Enriched payload for POS/cashier: product, meter reading, tank stock, station hierarchy."""
    meter = getattr(n, "meter", None)
    tank = getattr(n, "tank", None)
    product = getattr(n, "product", None)
    dispenser = getattr(meter, "dispenser", None) if meter else None
    island = getattr(dispenser, "island", None) if dispenser else None
    station = getattr(island, "station", None) if island else None
    product_name = product.name if product else ""
    product_price = _decimal_val(getattr(product, "unit_price", None), 0)
    product_unit = getattr(product, "unit", None) or "L"
    return {
        **_nozzle_to_json(n),
        "product_name": product_name,
        "product_price": product_price,
        "product_unit": product_unit,
        "unit_price": product_price,
        "station_name": station.station_name if station else "",
        "station_number": getattr(station, "station_number", "") or (str(station.id) if station else ""),
        "island_name": island.island_name if island else "",
        "island_number": getattr(island, "island_code", "") or "",
        "dispenser_name": dispenser.dispenser_name if dispenser else "",
        "dispenser_number": getattr(dispenser, "dispenser_code", "") or "",
        "meter_name": meter.meter_name if meter else "",
        "meter_number": meter.meter_number if meter else "",
        "current_reading": _decimal_val(getattr(meter, "current_reading", None), 0),
        "current_stock": _decimal_val(getattr(tank, "current_stock", None), 0),
        "tank_id": tank.id if tank else None,
        "tank_name": tank.tank_name if tank else "",
        "tank_number": tank.tank_number if tank else "",
        "tank_capacity": _decimal_val(getattr(tank, "capacity", None), 0),
    }


def _nozzle_to_list_json(n):
    """Enriched payload for nozzles list page (same hierarchy as POS, with unit_price)."""
    return _nozzle_to_pos_json(n)


@csrf_exempt
@auth_required
@require_company_id
def nozzles_list_or_create(request):
    if request.method == "GET":
        qs = (
            Nozzle.objects.filter(company_id=request.company_id)
            .select_related("meter", "tank", "product", "meter__dispenser__island__station")
            .order_by("id")
        )
        return JsonResponse([_nozzle_to_list_json(n) for n in qs], safe=False)
    if request.method == "POST":
        return nozzles_list_post(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def nozzles_details(request):
    """GET /api/nozzles/details/ - enriched list for POS (product, meter, tank, station)."""
    qs = (
        Nozzle.objects.filter(company_id=request.company_id)
        .select_related("meter", "tank", "product", "meter__dispenser__island__station")
        .order_by("id")
    )
    return JsonResponse([_nozzle_to_pos_json(n) for n in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def nozzles_list_post(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    meter_id = body.get("meter_id")
    tank_id = body.get("tank_id")
    if not meter_id or not tank_id:
        return JsonResponse({"detail": "meter_id and tank_id are required"}, status=400)
    if not Meter.objects.filter(id=meter_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Meter not found"}, status=400)
    if not Tank.objects.filter(id=tank_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Tank not found"}, status=400)
    tank = Tank.objects.get(id=tank_id)
    name = (body.get("nozzle_name") or "").strip() or f"Nozzle-{meter_id}-{tank_id}"
    num_in = (body.get("nozzle_number") or "").strip()
    code, err = user_supplied_code_or_auto(
        request.company_id, Nozzle, "nozzle_number", "NZL", num_in or None, None
    )
    if err:
        return JsonResponse({"detail": err}, status=400)
    n = Nozzle(
        company_id=request.company_id,
        meter_id=meter_id,
        tank_id=tank_id,
        product_id=tank.product_id,
        nozzle_name=name,
        nozzle_code=body.get("nozzle_code") or "",
        nozzle_number=code or "",
        color_code=body.get("color_code") or "#3B82F6",
        is_operational=body.get("is_operational", True) if isinstance(body.get("is_operational"), bool) else (body.get("is_operational") not in ("N", "false", "0")),
        is_active=body.get("is_active", True),
    )
    n.save()
    if not n.nozzle_number:
        assigned, err2 = assign_string_code_if_empty(
            request.company_id, Nozzle, "nozzle_number", "NZL", n.pk, None, None
        )
        if err2:
            n.delete()
            return JsonResponse({"detail": err2}, status=400)
        n.nozzle_number = assigned
    return JsonResponse(_nozzle_to_json(n), status=201)


@csrf_exempt
@auth_required
@require_company_id
def nozzle_detail(request, nozzle_id: int):
    n = Nozzle.objects.filter(id=nozzle_id, company_id=request.company_id).select_related("meter", "tank", "product").first()
    if not n:
        return JsonResponse({"detail": "Nozzle not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_nozzle_to_json(n))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("nozzle_name") is not None:
            n.nozzle_name = (body.get("nozzle_name") or "").strip() or n.nozzle_name
        if body.get("meter_id") and Meter.objects.filter(id=body["meter_id"], company_id=request.company_id).exists():
            n.meter_id = body["meter_id"]
        if body.get("tank_id") and Tank.objects.filter(id=body["tank_id"], company_id=request.company_id).exists():
            tank = Tank.objects.get(id=body["tank_id"])
            n.tank_id = tank.id
            n.product_id = tank.product_id
        if "color_code" in body:
            n.color_code = (body.get("color_code") or "#3B82F6")[:20]
        if "is_operational" in body:
            v = body["is_operational"]
            n.is_operational = v is True or v not in ("N", "false", "0", False)
        if "is_active" in body:
            n.is_active = bool(body["is_active"])
        n.save()
        return JsonResponse(_nozzle_to_json(n))

    if request.method == "DELETE":
        n.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
