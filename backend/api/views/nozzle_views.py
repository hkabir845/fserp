"""Nozzles API: list, create, get, update, delete (company-scoped)."""
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Nozzle, Meter, Tank, Item
from api.services.station_capabilities import require_fuel_forecourt_station
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
        "station_id": station.id if station else None,
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


def _nozzles_forecourt_qs(company_id: int):
    """Exclude nozzles whose hierarchy resolves to a non-fuel station (e.g. legacy misconfiguration).

    Internal helper only: takes ``company_id``, not a request. Do not wrap with view decorators.
    """
    return (
        Nozzle.objects.filter(company_id=company_id)
        .exclude(meter__dispenser__island__station__operates_fuel_retail=False)
        .select_related("meter", "tank", "product", "meter__dispenser__island__station")
    )


@csrf_exempt
@auth_required
@require_company_id
@csrf_exempt
@auth_required
@require_company_id
def nozzles_list_or_create(request):
    if request.method == "GET":
        qs = _nozzles_forecourt_qs(request.company_id).order_by("id")
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
        _nozzles_forecourt_qs(request.company_id)
        .filter(is_active=True, is_operational=True)
        .order_by("id")
    )
    return JsonResponse([_nozzle_to_pos_json(n) for n in qs], safe=False)


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
    meter = (
        Meter.objects.filter(id=meter_id, company_id=request.company_id)
        .select_related("dispenser__island__station")
        .first()
    )
    if not meter:
        return JsonResponse({"detail": "Meter not found"}, status=400)
    tank = Tank.objects.filter(id=tank_id, company_id=request.company_id).select_related("station").first()
    if not tank:
        return JsonResponse({"detail": "Tank not found"}, status=400)
    serr = require_fuel_forecourt_station(request.company_id, tank.station_id)
    if serr:
        return serr
    ms_id = None
    if meter.dispenser_id and getattr(meter.dispenser, "island_id", None):
        isl = getattr(meter.dispenser, "island", None)
        if isl:
            ms_id = isl.station_id
    if ms_id is None or ms_id != tank.station_id:
        return JsonResponse(
            {"detail": "Meter and tank must belong to the same fuel forecourt station."},
            status=400,
        )
    name = (body.get("nozzle_name") or "").strip() or f"Nozzle-{meter_id}-{tank_id}"
    num_in = (body.get("nozzle_number") or "").strip()
    code, c_err = user_supplied_code_or_auto(
        request.company_id, Nozzle, "nozzle_number", "NZL", num_in or None, None
    )
    if c_err:
        return JsonResponse({"detail": c_err}, status=400)
    is_op = (
        body.get("is_operational", True)
        if isinstance(body.get("is_operational"), bool)
        else (body.get("is_operational") not in ("N", "false", "0"))
    )
    if "is_operational" in body:
        is_active_val = is_op
    elif "is_active" in body:
        is_active_val = bool(body["is_active"])
    else:
        is_active_val = is_op
    n = Nozzle(
        company_id=request.company_id,
        meter_id=meter_id,
        tank_id=tank_id,
        product_id=tank.product_id,
        nozzle_name=name,
        nozzle_code=body.get("nozzle_code") or "",
        nozzle_number=code or "",
        color_code=body.get("color_code") or "#3B82F6",
        is_operational=is_op,
        is_active=is_active_val,
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
    n = (
        Nozzle.objects.filter(id=nozzle_id, company_id=request.company_id)
        .select_related("meter", "meter__dispenser__island", "tank", "tank__station", "product")
        .first()
    )
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
        new_mid = n.meter_id
        if body.get("meter_id") is not None and body.get("meter_id") != "":
            try:
                new_mid = int(body["meter_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "meter_id must be an integer"}, status=400)
        new_tid = n.tank_id
        if body.get("tank_id") is not None and body.get("tank_id") != "":
            try:
                new_tid = int(body["tank_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "tank_id must be an integer"}, status=400)
        if (body.get("meter_id") is not None and body.get("meter_id") != "") or (
            body.get("tank_id") is not None and body.get("tank_id") != ""
        ):
            meter = (
                Meter.objects.filter(id=new_mid, company_id=request.company_id)
                .select_related("dispenser__island")
                .first()
            )
            if not meter:
                return JsonResponse({"detail": "Meter not found"}, status=400)
            tank = Tank.objects.filter(id=new_tid, company_id=request.company_id).select_related("station").first()
            if not tank:
                return JsonResponse({"detail": "Tank not found"}, status=400)
            serr = require_fuel_forecourt_station(request.company_id, tank.station_id)
            if serr:
                return serr
            ms_id = None
            if meter.dispenser_id and getattr(meter.dispenser, "island_id", None):
                isl = getattr(meter.dispenser, "island", None)
                if isl:
                    ms_id = isl.station_id
            if ms_id is None or ms_id != tank.station_id:
                return JsonResponse(
                    {"detail": "Meter and tank must belong to the same fuel forecourt station."},
                    status=400,
                )
            n.meter_id = new_mid
            n.tank_id = new_tid
            n.product_id = tank.product_id
        if "color_code" in body:
            n.color_code = (body.get("color_code") or "#3B82F6")[:20]
        if "is_operational" in body:
            v = body["is_operational"]
            n.is_operational = v is True or v not in ("N", "false", "0", False)
            n.is_active = n.is_operational
        elif "is_active" in body:
            n.is_active = bool(body["is_active"])
        n.save()
        return JsonResponse(_nozzle_to_json(n))

    if request.method == "DELETE":
        n.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
