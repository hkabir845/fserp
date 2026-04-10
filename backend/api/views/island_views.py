"""Islands API: list, create, get, update, delete (company-scoped)."""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Island, Station


def _island_to_json(i):
    return {
        "id": i.id,
        "island_code": i.island_code or "",
        "island_name": i.island_name,
        "station_id": i.station_id,
        "station_name": i.station.station_name if i.station_id else "",
        "location_description": i.location_description or "",
        "dispenser_count": i.dispensers.count() if hasattr(i, "dispensers") else 0,
        "is_active": i.is_active,
    }


@csrf_exempt
@auth_required
@require_company_id
def islands_list_or_create(request):
    if request.method == "GET":
        qs = Island.objects.filter(company_id=request.company_id).select_related("station").order_by("id")
        return JsonResponse([_island_to_json(i) for i in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        station_id = body.get("station_id")
        if not station_id:
            return JsonResponse({"detail": "station_id is required"}, status=400)
        if not Station.objects.filter(id=station_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "Station not found"}, status=400)
        name = (body.get("island_name") or "").strip() or "Island"
        i = Island(
            company_id=request.company_id,
            station_id=station_id,
            island_name=name,
            location_description=body.get("location_description") or "",
            is_active=body.get("is_active", True),
        )
        i.save()
        if not i.island_code:
            i.island_code = f"ISL-{i.id}"
            Island.objects.filter(pk=i.pk).update(island_code=i.island_code)
        i.refresh_from_db()
        i.station  # trigger select_related for response
        return JsonResponse(_island_to_json(i), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def island_detail(request, island_id: int):
    i = Island.objects.filter(id=island_id, company_id=request.company_id).select_related("station").first()
    if not i:
        return JsonResponse({"detail": "Island not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_island_to_json(i))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("island_name") is not None:
            i.island_name = (body.get("island_name") or "").strip() or i.island_name
        if body.get("station_id") and Station.objects.filter(id=body["station_id"], company_id=request.company_id).exists():
            i.station_id = body["station_id"]
        if "location_description" in body:
            i.location_description = body.get("location_description") or ""
        if "is_active" in body:
            i.is_active = bool(body["is_active"])
        i.save()
        return JsonResponse(_island_to_json(i))

    if request.method == "DELETE":
        i.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
