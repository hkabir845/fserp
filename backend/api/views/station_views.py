"""Stations API: list, create, get, update, delete (company-scoped)."""
import json
from django.db.models.deletion import ProtectedError
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Company, Station
from api.services.station_policy import (
    MIN_ONE_ACTIVE_STATION_DETAIL,
    active_station_count,
    delete_would_leave_zero_active,
    first_other_active_station_id,
    post_inactive_would_leave_zero_active,
    repoint_defaults_from_station,
    single_mode_blocks_new_active_station,
    would_leave_zero_active_stations,
)


def _station_to_json(s):
    return {
        "id": s.id,
        "station_number": s.station_number or "",
        "station_name": s.station_name,
        "address_line1": s.address_line1 or "",
        "city": s.city or "",
        "state": s.state or "",
        "phone": s.phone or "",
        "postal_code": s.postal_code or "",
        "is_active": s.is_active,
    }


@csrf_exempt
@auth_required
@require_company_id
def stations_list_or_create(request):
    if request.method == "GET":
        qs = Station.objects.filter(company_id=request.company_id).order_by("id")
        return JsonResponse([_station_to_json(s) for s in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = (body.get("station_name") or "").strip()
        if not name:
            return JsonResponse({"detail": "station_name is required"}, status=400)
        co = Company.objects.filter(id=request.company_id).first()
        wants_active = bool(body.get("is_active", True))
        if post_inactive_would_leave_zero_active(request.company_id, wants_active):
            return JsonResponse({"detail": MIN_ONE_ACTIVE_STATION_DETAIL}, status=400)
        if co and (getattr(co, "station_mode", None) or "single") == "single":
            if wants_active and single_mode_blocks_new_active_station(request.company_id):
                return JsonResponse(
                    {
                        "detail": "Single-site mode: only one *active* station. Deactivate a site to archive it, add this row as Inactive, "
                        "or open Company → Site model and set Multiple stations to add more operating locations."
                    },
                    status=400,
                )
        s = Station(
            company_id=request.company_id,
            station_name=name,
            address_line1=body.get("address_line1") or "",
            city=body.get("city") or "",
            state=body.get("state") or "",
            phone=body.get("phone") or "",
            postal_code=body.get("postal_code") or "",
            is_active=wants_active,
        )
        s.save()
        return JsonResponse(_station_to_json(s), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def station_detail(request, station_id: int):
    s = Station.objects.filter(id=station_id, company_id=request.company_id).first()
    if not s:
        return JsonResponse({"detail": "Station not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_station_to_json(s))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("station_name"):
            s.station_name = (body["station_name"] or "").strip() or s.station_name
        if "address_line1" in body:
            s.address_line1 = (body.get("address_line1") or "")[:300]
        if "city" in body:
            s.city = (body.get("city") or "")[:100]
        if "state" in body:
            s.state = (body.get("state") or "")[:100]
        if "phone" in body:
            s.phone = (body.get("phone") or "")[:30]
        if "postal_code" in body:
            s.postal_code = (body.get("postal_code") or "")[:20]
        if "is_active" in body:
            new_active = bool(body["is_active"])
            turning_on = new_active and not s.is_active
            turning_off = not new_active and s.is_active
            if turning_off and would_leave_zero_active_stations(
                request.company_id, currently_active=s.is_active, turning_active_off=True
            ):
                return JsonResponse({"detail": MIN_ONE_ACTIVE_STATION_DETAIL}, status=400)
            if turning_on:
                co = Company.objects.filter(id=request.company_id).first()
                if co and (getattr(co, "station_mode", None) or "single") == "single":
                    if active_station_count(request.company_id) >= 1:
                        return JsonResponse(
                            {
                                "detail": "Single-site mode: only one *active* station. Deactivate the other site first, or switch the company to Multiple stations."
                            },
                            status=400,
                        )
            if turning_off:
                fb = first_other_active_station_id(request.company_id, s.id)
                if fb is not None:
                    repoint_defaults_from_station(request.company_id, s.id, fb)
            s.is_active = new_active
        s.save()
        return JsonResponse(_station_to_json(s))

    if request.method == "DELETE":
        if delete_would_leave_zero_active(request.company_id, s):
            return JsonResponse({"detail": MIN_ONE_ACTIVE_STATION_DETAIL}, status=400)
        try:
            s.delete()
        except ProtectedError:
            return JsonResponse(
                {
                    "detail": "This station cannot be deleted while historical records (for example, inventory transfers) still reference it. "
                    "Deactivate the station to stop using it, or resolve dependent records in the database if your workflow allows."
                },
                status=409,
            )
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
