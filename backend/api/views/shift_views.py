"""Shifts API: templates CRUD, sessions list/open/close, shifts list (company-scoped)."""
from datetime import datetime
from decimal import Decimal

from django.http import JsonResponse
from django.utils import timezone as django_timezone
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import ShiftTemplate, ShiftSession, Station


def _serialize_datetime(dt):
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def _decimal(val, default=None):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def _parse_time_value(val):
    """Parse 'HH:MM' or 'HH:MM:SS' from JSON / time inputs."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


def _template_to_json(t):
    return {
        "id": t.id,
        "name": t.name,
        "start_time": t.start_time.isoformat()[:8] if t.start_time else None,
        "end_time": t.end_time.isoformat()[:8] if t.end_time else None,
    }


def _session_to_json(s):
    return {
        "id": s.id,
        "station_id": s.station_id,
        "template_id": s.template_id,
        "opened_at": _serialize_datetime(s.opened_at),
        "closed_at": _serialize_datetime(s.closed_at),
        "opened_by_user_id": s.opened_by_user_id,
        "closed_by_user_id": s.closed_by_user_id,
        "opening_cash_float": str(s.opening_cash_float or Decimal("0")),
        "expected_cash_total": str(s.expected_cash_total or Decimal("0")),
        "closing_cash_counted": (
            str(s.closing_cash_counted) if s.closing_cash_counted is not None else None
        ),
        "cash_variance": str(s.cash_variance or Decimal("0")),
        "total_sales_amount": str(s.total_sales_amount or Decimal("0")),
        "sale_transaction_count": s.sale_transaction_count or 0,
    }


@csrf_exempt
@auth_required
@require_company_id
def shift_templates_list_or_create(request):
    if request.method == "GET":
        qs = ShiftTemplate.objects.filter(company_id=request.company_id).order_by("id")
        return JsonResponse([_template_to_json(t) for t in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = (body.get("name") or "").strip() or "Shift"
        if ShiftTemplate.objects.filter(company_id=request.company_id, name__iexact=name).exists():
            return JsonResponse(
                {"detail": f"A shift template named '{name}' already exists for this company."},
                status=409,
            )
        t = ShiftTemplate(
            company_id=request.company_id,
            name=name,
            start_time=_parse_time_value(body.get("start_time")),
            end_time=_parse_time_value(body.get("end_time")),
        )
        t.save()
        return JsonResponse(_template_to_json(t), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def shift_template_detail(request, template_id: int):
    t = ShiftTemplate.objects.filter(id=template_id, company_id=request.company_id).first()
    if not t:
        return JsonResponse({"detail": "Template not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_template_to_json(t))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("name"):
            new_name = (body.get("name") or "").strip() or t.name
            if (
                new_name
                and ShiftTemplate.objects.filter(company_id=request.company_id, name__iexact=new_name)
                .exclude(id=t.id)
                .exists()
            ):
                return JsonResponse(
                    {"detail": f"A shift template named '{new_name}' already exists for this company."},
                    status=409,
                )
            t.name = new_name
        if "start_time" in body:
            st = body.get("start_time")
            t.start_time = None if st in (None, "") else _parse_time_value(st)
        if "end_time" in body:
            et = body.get("end_time")
            t.end_time = None if et in (None, "") else _parse_time_value(et)
        t.save()
        return JsonResponse(_template_to_json(t))
    if request.method == "DELETE":
        t.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def shifts_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    qs = ShiftSession.objects.filter(company_id=request.company_id).select_related("station", "template").order_by("-opened_at")
    limit = int(request.GET.get("limit", 100))
    qs = qs[:limit]
    return JsonResponse([_session_to_json(s) for s in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def shifts_sessions_active(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    s = ShiftSession.objects.filter(company_id=request.company_id, closed_at__isnull=True).select_related("station", "template").first()
    if not s:
        return JsonResponse(None, safe=False)
    return JsonResponse(_session_to_json(s))


@csrf_exempt
@auth_required
@require_company_id
def shifts_sessions_open(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    station_id = body.get("station_id")
    template_id = body.get("template_id")
    if ShiftSession.objects.filter(company_id=request.company_id, closed_at__isnull=True).exists():
        return JsonResponse({"detail": "An active shift session already exists"}, status=400)
    if station_id and not Station.objects.filter(id=station_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Station not found"}, status=400)
    opening = _decimal(body.get("opening_cash_float"), Decimal("0"))
    if opening is None:
        opening = Decimal("0")
    s = ShiftSession(
        company_id=request.company_id,
        station_id=station_id or None,
        template_id=template_id or None,
        opened_at=django_timezone.now(),
        opened_by_user_id=getattr(request.api_user, "id", None),
        opening_cash_float=opening,
    )
    s.save()
    return JsonResponse(_session_to_json(s), status=201)


@csrf_exempt
@auth_required
@require_company_id
def shifts_sessions_close(request, session_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    s = ShiftSession.objects.filter(id=session_id, company_id=request.company_id).first()
    if not s:
        return JsonResponse({"detail": "Session not found"}, status=404)
    if s.closed_at:
        return JsonResponse({"detail": "Session already closed"}, status=400)
    s.closed_at = django_timezone.now()
    s.closed_by_user_id = getattr(request.api_user, "id", None)
    if body.get("closing_cash_counted") is not None:
        s.closing_cash_counted = _decimal(body.get("closing_cash_counted"))
    expected = (s.opening_cash_float or Decimal("0")) + (s.expected_cash_total or Decimal("0"))
    if s.closing_cash_counted is not None:
        s.cash_variance = s.closing_cash_counted - expected
    s.save()
    return JsonResponse(_session_to_json(s))
