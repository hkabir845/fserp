"""Dispensers API: list, create, get, update, delete (company-scoped)."""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Dispenser, Island


def _dispenser_to_json(d):
    return {
        "id": d.id,
        "dispenser_code": d.dispenser_code or "",
        "dispenser_name": d.dispenser_name,
        "island_id": d.island_id,
        "island_name": d.island.island_name if d.island_id else "",
        "station_name": d.island.station.station_name if d.island_id and getattr(d.island, "station", None) else "",
        "model": getattr(d, "model", "") or "",
        "serial_number": getattr(d, "serial_number", "") or "",
        "meter_count": d.meters.count() if hasattr(d, "meters") else 0,
        "is_active": d.is_active,
    }


@csrf_exempt
@auth_required
@require_company_id
def dispensers_list_or_create(request):
    if request.method == "GET":
        qs = Dispenser.objects.filter(company_id=request.company_id).select_related("island", "island__station").order_by("id")
        return JsonResponse([_dispenser_to_json(d) for d in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        island_id = body.get("island_id")
        if not island_id:
            return JsonResponse({"detail": "island_id is required"}, status=400)
        if not Island.objects.filter(id=island_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "Island not found"}, status=400)
        name = (body.get("dispenser_name") or "").strip() or "Dispenser"
        d = Dispenser(
            company_id=request.company_id,
            island_id=island_id,
            dispenser_name=name,
            dispenser_code=body.get("dispenser_code") or "",
            model=body.get("model") or "",
            serial_number=body.get("serial_number") or "",
            is_active=body.get("is_active", True),
        )
        d.save()
        if not d.dispenser_code:
            d.dispenser_code = f"DSP-{d.id}"
            Dispenser.objects.filter(pk=d.pk).update(dispenser_code=d.dispenser_code)
        d.refresh_from_db()
        d.island  # load for response
        return JsonResponse(_dispenser_to_json(d), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def dispenser_detail(request, dispenser_id: int):
    d = Dispenser.objects.filter(id=dispenser_id, company_id=request.company_id).select_related("island", "island__station").first()
    if not d:
        return JsonResponse({"detail": "Dispenser not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_dispenser_to_json(d))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("dispenser_name") is not None:
            d.dispenser_name = (body.get("dispenser_name") or "").strip() or d.dispenser_name
        if body.get("island_id") and Island.objects.filter(id=body["island_id"], company_id=request.company_id).exists():
            d.island_id = body["island_id"]
        if "model" in body:
            d.model = body.get("model") or ""
        if "serial_number" in body:
            d.serial_number = body.get("serial_number") or ""
        if "is_active" in body:
            d.is_active = bool(body["is_active"])
        d.save()
        return JsonResponse(_dispenser_to_json(d))

    if request.method == "DELETE":
        d.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
