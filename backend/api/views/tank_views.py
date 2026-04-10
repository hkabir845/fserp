"""Tanks API: list, create, get, update, delete (company-scoped)."""
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Tank, Station, Item


def _tank_to_json(t):
    station = getattr(t, "station", None)
    product = getattr(t, "product", None)
    return {
        "id": t.id,
        "tank_number": t.tank_number or "",
        "tank_name": t.tank_name,
        "station_id": t.station_id,
        "station_name": station.station_name if station else "",
        "product_id": t.product_id,
        "product_name": product.name if product else "",
        "capacity": str(t.capacity),
        "current_stock": str(t.current_stock),
        "reorder_level": str(t.reorder_level),
        "unit_of_measure": t.unit_of_measure or "L",
        "is_active": t.is_active,
    }


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        s = str(val).strip().replace(",", "").replace(" ", "")
        if not s:
            return default
        return Decimal(s)
    except Exception:
        return default


@csrf_exempt
@auth_required
@require_company_id
def tanks_list_or_create(request):
    if request.method == "GET":
        qs = Tank.objects.filter(company_id=request.company_id).select_related("station", "product").order_by("id")
        return JsonResponse([_tank_to_json(t) for t in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        station_id = body.get("station_id")
        product_id = body.get("product_id")
        if not station_id or not product_id:
            return JsonResponse({"detail": "station_id and product_id are required"}, status=400)
        if not Station.objects.filter(id=station_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "Station not found"}, status=400)
        if not Item.objects.filter(id=product_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "Product (item) not found"}, status=400)
        t = Tank(
            company_id=request.company_id,
            station_id=station_id,
            product_id=product_id,
            tank_name=(body.get("tank_name") or "").strip() or "Tank",
            capacity=_decimal(body.get("capacity"), 10000),
            current_stock=_decimal(body.get("current_stock")),
            reorder_level=_decimal(body.get("min_stock_level", body.get("reorder_level")), 2000),
            unit_of_measure=body.get("unit_of_measure") or "L",
            is_active=body.get("is_active", True),
        )
        t.save()
        if not t.tank_number:
            t.tank_number = f"TNK-{t.id}"
            Tank.objects.filter(pk=t.pk).update(tank_number=t.tank_number)
        t.refresh_from_db()
        return JsonResponse(_tank_to_json(t), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def tank_detail(request, tank_id: int):
    t = Tank.objects.filter(id=tank_id, company_id=request.company_id).select_related("station", "product").first()
    if not t:
        return JsonResponse({"detail": "Tank not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_tank_to_json(t))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("tank_name") is not None:
            t.tank_name = (body.get("tank_name") or "").strip() or t.tank_name
        if body.get("station_id") and Station.objects.filter(id=body["station_id"], company_id=request.company_id).exists():
            t.station_id = body["station_id"]
        if body.get("product_id") and Item.objects.filter(id=body["product_id"], company_id=request.company_id).exists():
            t.product_id = body["product_id"]
        if "capacity" in body:
            t.capacity = _decimal(body.get("capacity"), t.capacity)
        if "current_stock" in body:
            t.current_stock = _decimal(body.get("current_stock"), t.current_stock)
        if "min_stock_level" in body or "reorder_level" in body:
            t.reorder_level = _decimal(body.get("min_stock_level") or body.get("reorder_level"), t.reorder_level)
        if "is_active" in body:
            t.is_active = bool(body["is_active"])
        try:
            t.save()
        except ValidationError as e:
            return JsonResponse(
                {"detail": "Validation failed", "errors": getattr(e, "message_dict", str(e))},
                status=400,
            )
        return JsonResponse(_tank_to_json(t))

    if request.method == "DELETE":
        t.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
