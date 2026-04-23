"""Meters API: list, create, get, update, delete, reset (company-scoped)."""
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, _serialize_datetime
from api.models import Meter, Dispenser


def _meter_to_json(m):
    return {
        "id": m.id,
        "meter_number": m.meter_number or m.meter_code or "",
        "meter_name": m.meter_name or (m.meter_code or str(m.id)),
        "dispenser_id": m.dispenser_id,
        "dispenser_name": m.dispenser.dispenser_name if m.dispenser_id else "",
        "island_name": m.dispenser.island.island_name if m.dispenser_id and m.dispenser.island_id else "",
        "station_id": m.dispenser.island.station_id if m.dispenser_id and m.dispenser.island_id else None,
        "station_name": m.dispenser.island.station.station_name if m.dispenser_id and m.dispenser.island_id else "",
        "current_reading": str(m.current_reading),
        "last_reset_date": _serialize_datetime(m.last_reset_date),
        "reset_count": getattr(m, "reset_count", 0),
        "nozzle_count": m.nozzles.count() if hasattr(m, "nozzles") else 0,
        "is_active": m.is_active,
    }


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


@csrf_exempt
@auth_required
@require_company_id
def meters_list_or_create(request):
    if request.method == "GET":
        qs = Meter.objects.filter(company_id=request.company_id).select_related("dispenser", "dispenser__island", "dispenser__island__station").order_by("id")
        return JsonResponse([_meter_to_json(m) for m in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        dispenser_id = body.get("dispenser_id")
        if not dispenser_id:
            return JsonResponse({"detail": "dispenser_id is required"}, status=400)
        if not Dispenser.objects.filter(id=dispenser_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "Dispenser not found"}, status=400)
        name = (body.get("meter_name") or "").strip() or "Meter"
        m = Meter(
            company_id=request.company_id,
            dispenser_id=dispenser_id,
            meter_name=name,
            meter_code=body.get("meter_code") or "",
            meter_number=body.get("meter_number") or "",
            current_reading=_decimal(body.get("current_reading")),
            is_active=body.get("is_active", True),
        )
        m.save()
        if not m.meter_code:
            m.meter_code = f"MTR-{m.id}"
            Meter.objects.filter(pk=m.pk).update(meter_code=m.meter_code)
        m.refresh_from_db()
        return JsonResponse(_meter_to_json(m), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def meter_detail(request, meter_id: int):
    m = Meter.objects.filter(id=meter_id, company_id=request.company_id).select_related("dispenser", "dispenser__island", "dispenser__island__station").first()
    if not m:
        return JsonResponse({"detail": "Meter not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_meter_to_json(m))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("meter_name") is not None:
            m.meter_name = (body.get("meter_name") or "").strip() or m.meter_name
        if body.get("dispenser_id") and Dispenser.objects.filter(id=body["dispenser_id"], company_id=request.company_id).exists():
            m.dispenser_id = body["dispenser_id"]
        if "current_reading" in body:
            m.current_reading = _decimal(body.get("current_reading"), m.current_reading)
        if "is_active" in body:
            m.is_active = bool(body["is_active"])
        m.save()
        return JsonResponse(_meter_to_json(m))

    if request.method == "DELETE":
        m.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def meter_reset(request, meter_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    m = Meter.objects.filter(id=meter_id, company_id=request.company_id).first()
    if not m:
        return JsonResponse({"detail": "Meter not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    m.current_reading = 0
    m.last_reset_date = timezone.now()
    m.reset_count = getattr(m, "reset_count", 0) + 1
    m.save()
    return JsonResponse(_meter_to_json(m))
