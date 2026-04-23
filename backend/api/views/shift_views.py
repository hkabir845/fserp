"""Shifts API: templates CRUD, sessions list/open/close, shifts list (company-scoped)."""
from datetime import datetime
from decimal import Decimal

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone as django_timezone
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Employee, Meter, ShiftTemplate, ShiftSession, Station


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
    om = getattr(s, "opening_meters", None) or []
    es = getattr(s, "employee_schedule", None) or []
    if not isinstance(om, list):
        om = []
    if not isinstance(es, list):
        es = []
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
        "opening_meters": om,
        "employee_schedule": es,
    }


def _build_employee_schedule(company_id: int, raw) -> tuple[list | None, str | None]:
    if raw is None:
        return [], None
    if not isinstance(raw, list):
        return None, "employee_schedule must be a JSON array"
    out = []
    seen: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            return None, "Each employee_schedule entry must be an object"
        eid = item.get("employee_id")
        if eid is None:
            return None, "Each employee row needs employee_id"
        try:
            eid = int(eid)
        except (TypeError, ValueError):
            return None, f"Invalid employee_id: {item.get('employee_id')}"
        if eid in seen:
            return None, f"Duplicate employee_id: {eid}"
        seen.add(eid)
        e = Employee.objects.filter(id=eid, company_id=company_id, is_active=True).first()
        if not e:
            return None, f"Active employee {eid} not found in this company"
        st = str(item.get("scheduled_start") or "").strip()[:16]
        en = str(item.get("scheduled_end") or "").strip()[:16]
        notes = str(item.get("notes") or "")[:500]
        out.append(
            {
                "employee_id": e.id,
                "first_name": e.first_name,
                "last_name": (e.last_name or ""),
                "scheduled_start": st,
                "scheduled_end": en,
                "notes": notes,
            }
        )
    return out, None


def _parse_opening_meter_intent(company_id: int, station_id, raw) -> tuple[list[tuple[int, Decimal]] | None, str | None]:
    """
    Validate opening_meters JSON without writing. Returns (meter_id, reading) rows or an error.
    """
    if not raw:
        return [], None
    if not isinstance(raw, list):
        return None, "opening_meters must be a JSON array"
    want_sid = int(station_id) if station_id else None
    to_apply: list[tuple[int, Decimal]] = []
    seen_mid: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            return None, "Each opening_meters entry must be an object"
        mid = item.get("meter_id")
        if mid is None:
            return None, "Each meter row needs meter_id"
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            return None, f"Invalid meter_id: {item.get('meter_id')}"
        if mid in seen_mid:
            return None, f"Duplicate meter_id: {mid}"
        seen_mid.add(mid)
        m = (
            Meter.objects.filter(id=mid, company_id=company_id, is_active=True)
            .select_related("dispenser", "dispenser__island", "dispenser__island__station")
            .first()
        )
        if not m:
            return None, f"Meter {mid} not found or inactive"
        m_sid = m.dispenser.island.station_id if m.dispenser and m.dispenser.island_id else None
        if want_sid is not None and m_sid != want_sid:
            return None, f"Meter {mid} is not on the selected station (station_id={m_sid}, expected {want_sid})"
        r = _decimal(item.get("reading"), None)
        if r is None or r < 0:
            return None, f"Invalid reading for meter {mid} (use a non-negative number)"
        to_apply.append((mid, r))
    return to_apply, None


def _apply_opening_meter_intent(company_id: int, station_id, to_apply: list[tuple[int, Decimal]]) -> list[dict]:
    """
    Apply validated (meter_id, reading) rows and return snapshot. Call inside transaction.atomic().
    """
    if not to_apply:
        return []
    want_sid = int(station_id) if station_id else None
    snapshot: list[dict] = []
    for mid, r in to_apply:
        m = (
            Meter.objects.filter(id=mid, company_id=company_id, is_active=True)
            .select_for_update()
            .select_related("dispenser", "dispenser__island", "dispenser__island__station")
            .first()
        )
        if not m:
            raise ValueError(f"Meter {mid} not found or inactive")
        m_sid = m.dispenser.island.station_id if m.dispenser and m.dispenser.island_id else None
        if want_sid is not None and m_sid != want_sid:
            raise ValueError(
                f"Meter {mid} is not on the selected station (station_id={m_sid}, expected {want_sid})"
            )
        prev = m.current_reading
        m.current_reading = r
        m.save(update_fields=["current_reading", "updated_at"])
        snapshot.append(
            {
                "meter_id": m.id,
                "reading": str(r),
                "previous_reading": str(prev),
                "meter_name": (m.meter_name or m.meter_code or str(m.id)),
                "dispenser_name": m.dispenser.dispenser_name if m.dispenser_id else "",
            }
        )
    return snapshot


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
    es, eerr = _build_employee_schedule(request.company_id, body.get("employee_schedule"))
    if eerr:
        return JsonResponse({"detail": eerr}, status=400)
    to_apply, merr = _parse_opening_meter_intent(
        request.company_id, station_id, body.get("opening_meters") or []
    )
    if merr:
        return JsonResponse({"detail": merr}, status=400)
    try:
        with transaction.atomic():
            snap = _apply_opening_meter_intent(request.company_id, station_id, to_apply)
            s = ShiftSession(
                company_id=request.company_id,
                station_id=station_id or None,
                template_id=template_id or None,
                opened_at=django_timezone.now(),
                opened_by_user_id=getattr(request.api_user, "id", None),
                opening_cash_float=opening,
                employee_schedule=es or [],
                opening_meters=snap,
            )
            s.save()
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    s.refresh_from_db()
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
