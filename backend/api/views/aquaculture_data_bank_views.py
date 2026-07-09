"""Aquaculture Data Bank: per-pond year close, locks, admin reopen for reference."""
from __future__ import annotations

from datetime import date

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import Company, Station
from api.services.aquaculture_data_bank_service import (
    close_pond,
    close_station,
    list_data_bank,
    list_readiness_overview,
    pond_close_to_dict,
    preview_pond_close,
    preview_station_close,
    relock_close,
    reopen_close_for_reference,
    return_pond_warehouse_for_year_close,
    unlock_pond_close,
    user_may_manage_aquaculture_data_bank,
)
from api.views.aquaculture_views import _aquaculture_access, _pond_for_company
from api.views.common import parse_json_body, require_company_id
from api.utils.auth import auth_required


def _data_bank_admin_required(request):
    err = _aquaculture_access(request)
    if err:
        return err
    user = getattr(request, "api_user", None)
    if not user_may_manage_aquaculture_data_bank(user):
        return JsonResponse(
            {"detail": "Data Bank pond year close requires tenant Admin role."},
            status=403,
        )
    return None


def _parse_date_field(raw, field_name: str, required: bool = True) -> tuple[date | None, JsonResponse | None]:
    if raw is None or str(raw).strip() == "":
        if required:
            return None, JsonResponse({"detail": f"{field_name} is required."}, status=400)
        return None, None
    try:
        return date.fromisoformat(str(raw).strip()[:10]), None
    except ValueError:
        return None, JsonResponse({"detail": f"{field_name} must be YYYY-MM-DD."}, status=400)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_data_bank_list(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(list_data_bank(request.company_id))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_data_bank_preview_pond_close(request):
    """Preview period range for one pond before close."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    raw_pond = request.GET.get("pond_id")
    if not raw_pond or not str(raw_pond).strip().isdigit():
        return JsonResponse({"detail": "pond_id is required."}, status=400)
    pond = _pond_for_company(cid, int(raw_pond))
    if not pond:
        return JsonResponse({"detail": "Pond not found."}, status=404)
    period_end, date_err = _parse_date_field(request.GET.get("period_end"), "period_end")
    if date_err:
        return date_err
    period_start, ps_err = _parse_date_field(
        request.GET.get("period_start"), "period_start", required=False
    )
    if ps_err:
        return ps_err
    company = Company.objects.filter(pk=cid).first()
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)
    try:
        payload = preview_pond_close(company, pond, period_end, period_start)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_data_bank_readiness_overview(request):
    """Fleet readiness for year close (open ponds only scored)."""
    err = _aquaculture_access(request)
    if err:
        return err
    period_end, date_err = _parse_date_field(
        request.GET.get("period_end") or request.GET.get("as_of"),
        "period_end",
    )
    if date_err:
        return date_err
    return JsonResponse(list_readiness_overview(request.company_id, period_end))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_return_warehouse(request):
    """Return all pond-warehouse stock to shop (confirmed year-close prep helper)."""
    err = _data_bank_admin_required(request)
    if err:
        return err
    body, parse_err = parse_json_body(request)
    if parse_err:
        return parse_err
    cid = request.company_id
    raw_pond = body.get("pond_id")
    try:
        pond_id = int(raw_pond)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer."}, status=400)
    raw_station = body.get("station_id")
    station_id: int | None = None
    if raw_station is not None and str(raw_station).strip() != "":
        try:
            station_id = int(raw_station)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "station_id must be an integer."}, status=400)
    result, msg = return_pond_warehouse_for_year_close(
        company_id=cid,
        pond_id=pond_id,
        user=getattr(request, "api_user", None),
        station_id=station_id,
        memo=(body.get("memo") or "").strip(),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=400)
    return JsonResponse(
        {
            **result,
            "message": (
                f"Returned {result['returned_lines']} warehouse line(s) from pond "
                f"#{pond_id} to shop station #{result['station_id']}."
            ),
        },
        status=201,
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_data_bank_preview_station_close(request):
    """Preview fiscal close for all ponds linked to a shop station."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    raw_station = request.GET.get("station_id")
    if not raw_station or not str(raw_station).strip().isdigit():
        return JsonResponse({"detail": "station_id is required."}, status=400)
    station = Station.objects.filter(pk=int(raw_station), company_id=cid).first()
    if not station:
        return JsonResponse({"detail": "Station not found."}, status=404)
    period_end, date_err = _parse_date_field(request.GET.get("period_end"), "period_end")
    if date_err:
        return date_err
    period_start, ps_err = _parse_date_field(
        request.GET.get("period_start"), "period_start", required=False
    )
    if ps_err:
        return ps_err
    company = Company.objects.filter(pk=cid).first()
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)
    try:
        payload = preview_station_close(company, station, period_end, period_start)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_close_pond(request):
    """Close a single pond for its own year-end date."""
    err = _data_bank_admin_required(request)
    if err:
        return err
    body, parse_err = parse_json_body(request)
    if parse_err:
        return parse_err
    cid = request.company_id
    raw_pond = body.get("pond_id")
    try:
        pond_id = int(raw_pond)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer."}, status=400)
    period_end, date_err = _parse_date_field(body.get("period_end"), "period_end")
    if date_err:
        return date_err
    period_start, ps_err = _parse_date_field(body.get("period_start"), "period_start", required=False)
    if ps_err:
        return ps_err
    close, msg = close_pond(
        company_id=cid,
        pond_id=pond_id,
        period_end=period_end,
        period_start=period_start,
        user=getattr(request, "api_user", None),
        label=(body.get("label") or "").strip(),
        notes=(body.get("notes") or "").strip(),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=400)
    return JsonResponse(
        {
            **pond_close_to_dict(close),
            "message": (
                f"Year close for {close.pond.name}: {close.period_start.isoformat()} "
                f"– {close.period_end.isoformat()}. Pond data is locked."
            ),
        },
        status=201,
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_close_station(request):
    """Close all ponds linked to one shop station for the same period end."""
    err = _data_bank_admin_required(request)
    if err:
        return err
    body, parse_err = parse_json_body(request)
    if parse_err:
        return parse_err
    cid = request.company_id
    raw_station = body.get("station_id")
    try:
        station_id = int(raw_station)
    except (TypeError, ValueError):
        return JsonResponse(
            {"detail": "station_id is required and must be an integer."}, status=400
        )
    period_end, date_err = _parse_date_field(body.get("period_end"), "period_end")
    if date_err:
        return date_err
    period_start, ps_err = _parse_date_field(body.get("period_start"), "period_start", required=False)
    if ps_err:
        return ps_err
    result, msg = close_station(
        company_id=cid,
        station_id=station_id,
        period_end=period_end,
        period_start=period_start,
        user=getattr(request, "api_user", None),
        notes=(body.get("notes") or "").strip(),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=400)
    return JsonResponse(result, status=201)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_reopen_close(request, close_id: int):
    err = _data_bank_admin_required(request)
    if err:
        return err
    body, parse_err = parse_json_body(request)
    if parse_err:
        return parse_err
    close, msg = reopen_close_for_reference(
        company_id=request.company_id,
        close_id=close_id,
        user=getattr(request, "api_user", None),
        reason=(body.get("reason") or "").strip(),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=404)
    return JsonResponse(
        {
            "pond_close": pond_close_to_dict(close),
            "message": "Pond opened for reference in Data Bank. Operational edits remain locked.",
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_unlock_close(request, close_id: int):
    """Remove operational lock from a pond close (reverses test or mistaken year close)."""
    err = _data_bank_admin_required(request)
    if err:
        return err
    close, msg = unlock_pond_close(
        company_id=request.company_id,
        close_id=close_id,
        user=getattr(request, "api_user", None),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=404)
    return JsonResponse(
        {
            "pond_close": pond_close_to_dict(close),
            "message": (
                f"{close.pond.name} is open for operations again. "
                f"The {close.period_start.isoformat()} – {close.period_end.isoformat()} "
                "close remains in history but no longer blocks edits."
            ),
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_data_bank_relock_close(request, close_id: int):
    err = _data_bank_admin_required(request)
    if err:
        return err
    close, msg = relock_close(
        company_id=request.company_id,
        close_id=close_id,
        user=getattr(request, "api_user", None),
    )
    if msg:
        return JsonResponse({"detail": msg}, status=404)
    return JsonResponse(
        {
            "pond_close": pond_close_to_dict(close),
            "message": "Pond reference access revoked; data is fully locked again.",
        }
    )
