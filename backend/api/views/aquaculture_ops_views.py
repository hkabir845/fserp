"""Aquaculture day log, harvest lot plan, and sale-clearance APIs (P0 ops)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import (
    AquacultureHarvestLotPlan,
    AquaculturePond,
    AquaculturePondDayLog,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_company_flags import effective_aquaculture_enabled
from api.services.aquaculture_sale_clearance_service import (
    assert_pond_cleared_for_sale,
    optional_decimal,
    optional_int,
    pond_sale_clearance,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_aquaculture_module, require_company_id


def _aquaculture_access(request):
    c = (
        Company.objects.filter(pk=request.company_id)
        .only("aquaculture_enabled", "company_code", "name")
        .first()
    )
    if not c or not effective_aquaculture_enabled(c):
        return JsonResponse(
            {
                "detail": "Aquaculture is not enabled for this company. Ask a platform administrator to turn it on in Company settings.",
            },
            status=403,
        )
    return None


def _parse_date(raw) -> date | None:
    if raw in (None, ""):
        return None
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()[:10]
    try:
        y, m, d = (int(p) for p in s.split("-"))
        return date(y, m, d)
    except Exception:
        return None


def _pond(cid: int, pond_id: int) -> AquaculturePond | None:
    return AquaculturePond.objects.filter(pk=pond_id, company_id=cid).first()


def _q(v: Decimal | None) -> str | None:
    if v is None:
        return None
    return str(v)


def _day_log_to_json(row: AquaculturePondDayLog) -> dict:
    pond_name = ""
    if getattr(row, "pond", None):
        pond_name = (row.pond.name or "").strip()
    return {
        "id": row.id,
        "pond_id": row.pond_id,
        "pond_name": pond_name,
        "log_date": row.log_date.isoformat(),
        "do_morning_mg_l": _q(row.do_morning_mg_l),
        "do_evening_mg_l": _q(row.do_evening_mg_l),
        "ph": _q(row.ph),
        "temp_c": _q(row.temp_c),
        "ammonia_mg_l": _q(row.ammonia_mg_l),
        "mortality_count": row.mortality_count,
        "mortality_kg": _q(row.mortality_kg),
        "feed_kg": _q(row.feed_kg),
        "aerator_hours": _q(row.aerator_hours),
        "appetite": row.appetite or "",
        "weather": row.weather or "",
        "notes": row.notes or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


def _apply_day_log_fields(row: AquaculturePondDayLog, body: dict) -> str | None:
    for field, caster in (
        ("do_morning_mg_l", optional_decimal),
        ("do_evening_mg_l", optional_decimal),
        ("ph", optional_decimal),
        ("temp_c", optional_decimal),
        ("ammonia_mg_l", optional_decimal),
        ("mortality_kg", optional_decimal),
        ("feed_kg", optional_decimal),
        ("aerator_hours", optional_decimal),
    ):
        if field in body:
            setattr(row, field, caster(body.get(field)))
    if "mortality_count" in body:
        mc = optional_int(body.get("mortality_count"))
        if mc is not None and mc < 0:
            return "mortality_count cannot be negative"
        row.mortality_count = mc
    if "appetite" in body:
        row.appetite = str(body.get("appetite") or "")[:32]
    if "weather" in body:
        row.weather = str(body.get("weather") or "")[:120]
    if "notes" in body:
        row.notes = str(body.get("notes") or "")[:5000]
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
@require_aquaculture_module("app.aquaculture.day_log", methods=("POST", "PUT", "PATCH", "DELETE"))
def aquaculture_pond_day_logs_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquaculturePondDayLog.objects.filter(company_id=cid).select_related("pond")
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        df = _parse_date(request.GET.get("date_from"))
        dt = _parse_date(request.GET.get("date_to"))
        if df:
            qs = qs.filter(log_date__gte=df)
        if dt:
            qs = qs.filter(log_date__lte=dt)
        qs = qs.order_by("-log_date", "-id")[:500]
        return JsonResponse([_day_log_to_json(r) for r in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    log_date = _parse_date(body.get("log_date"))
    if not log_date:
        return JsonResponse({"detail": "log_date is required (YYYY-MM-DD)"}, status=400)
    existing = AquaculturePondDayLog.objects.filter(
        company_id=cid, pond_id=pond_id, log_date=log_date
    ).first()
    if existing:
        ferr = _apply_day_log_fields(existing, body)
        if ferr:
            return JsonResponse({"detail": ferr}, status=400)
        existing.save()
        existing = (
            AquaculturePondDayLog.objects.filter(pk=existing.pk).select_related("pond").first()
        )
        return JsonResponse(_day_log_to_json(existing))
    row = AquaculturePondDayLog(company_id=cid, pond=pond, log_date=log_date)
    ferr = _apply_day_log_fields(row, body)
    if ferr:
        return JsonResponse({"detail": ferr}, status=400)
    row.save()
    row = AquaculturePondDayLog.objects.filter(pk=row.pk).select_related("pond").first()
    return JsonResponse(_day_log_to_json(row), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
@require_aquaculture_module("app.aquaculture.day_log", methods=("POST", "PUT", "PATCH", "DELETE"))
def aquaculture_pond_day_log_detail(request, log_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    row = (
        AquaculturePondDayLog.objects.filter(pk=log_id, company_id=cid)
        .select_related("pond")
        .first()
    )
    if not row:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_day_log_to_json(row))
    if request.method == "DELETE":
        row.delete()
        return JsonResponse({"ok": True})
    body, e = parse_json_body(request)
    if e:
        return e
    if "pond_id" in body:
        try:
            pond_id = int(body.get("pond_id"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        pond = _pond(cid, pond_id)
        if not pond:
            return JsonResponse({"detail": "Pond not found"}, status=404)
        row.pond = pond
    if "log_date" in body:
        ld = _parse_date(body.get("log_date"))
        if not ld:
            return JsonResponse({"detail": "log_date must be YYYY-MM-DD"}, status=400)
        row.log_date = ld
    ferr = _apply_day_log_fields(row, body)
    if ferr:
        return JsonResponse({"detail": ferr}, status=400)
    try:
        with transaction.atomic():
            row.save()
    except Exception as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    row = AquaculturePondDayLog.objects.filter(pk=row.pk).select_related("pond").first()
    return JsonResponse(_day_log_to_json(row))


_LOT_STATUSES = {c[0] for c in AquacultureHarvestLotPlan.STATUS_CHOICES}


def _lot_to_json(row: AquacultureHarvestLotPlan, *, clearance: dict | None = None) -> dict:
    pond_name = ""
    if getattr(row, "pond", None):
        pond_name = (row.pond.name or "").strip()
    cycle_name = ""
    if row.production_cycle_id and getattr(row, "production_cycle", None):
        cycle_name = (row.production_cycle.name or "").strip()
    out = {
        "id": row.id,
        "pond_id": row.pond_id,
        "pond_name": pond_name,
        "production_cycle_id": row.production_cycle_id,
        "production_cycle_name": cycle_name,
        "title": row.title or "",
        "planned_start": row.planned_start.isoformat(),
        "planned_end": row.planned_end.isoformat(),
        "target_avg_weight_g": _q(row.target_avg_weight_g),
        "target_weight_kg": _q(row.target_weight_kg),
        "target_fish_count": row.target_fish_count,
        "priority": row.priority,
        "status": row.status,
        "depends_on_clearance": bool(row.depends_on_clearance),
        "notes": row.notes or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }
    if clearance is not None:
        out["sale_clearance"] = clearance
    return out


def _apply_lot_fields(row: AquacultureHarvestLotPlan, body: dict, cid: int) -> str | None:
    if "title" in body:
        row.title = str(body.get("title") or "")[:200]
    if "planned_start" in body:
        ps = _parse_date(body.get("planned_start"))
        if not ps:
            return "planned_start must be YYYY-MM-DD"
        row.planned_start = ps
    if "planned_end" in body:
        pe = _parse_date(body.get("planned_end"))
        if not pe:
            return "planned_end must be YYYY-MM-DD"
        row.planned_end = pe
    if row.planned_end < row.planned_start:
        return "planned_end cannot be before planned_start"
    if "target_avg_weight_g" in body:
        row.target_avg_weight_g = optional_decimal(body.get("target_avg_weight_g"))
    if "target_weight_kg" in body:
        row.target_weight_kg = optional_decimal(body.get("target_weight_kg"))
    if "target_fish_count" in body:
        tc = optional_int(body.get("target_fish_count"))
        if tc is not None and tc < 0:
            return "target_fish_count cannot be negative"
        row.target_fish_count = tc
    if "priority" in body:
        pr = optional_int(body.get("priority"))
        row.priority = pr if pr is not None else 100
    if "status" in body:
        st = str(body.get("status") or "").strip()
        if st not in _LOT_STATUSES:
            return f"status must be one of: {', '.join(sorted(_LOT_STATUSES))}"
        row.status = st
    if "depends_on_clearance" in body:
        row.depends_on_clearance = bool(body.get("depends_on_clearance"))
    if "notes" in body:
        row.notes = str(body.get("notes") or "")[:5000]
    if "production_cycle_id" in body:
        raw = body.get("production_cycle_id")
        if raw in (None, ""):
            row.production_cycle = None
        else:
            try:
                cy_id = int(raw)
            except (TypeError, ValueError):
                return "production_cycle_id must be an integer"
            cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
            if not cy:
                return "Production cycle not found"
            if cy.pond_id != row.pond_id:
                return "production_cycle_id does not belong to the selected pond"
            row.production_cycle = cy
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
@require_aquaculture_module("app.aquaculture.plan", methods=("POST", "PUT", "PATCH", "DELETE"))
def aquaculture_harvest_lot_plans_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureHarvestLotPlan.objects.filter(company_id=cid).select_related(
            "pond", "production_cycle"
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        st = (request.GET.get("status") or "").strip()
        if st:
            qs = qs.filter(status=st)
        include_clearance = request.GET.get("include_clearance") == "1"
        rows = list(qs.order_by("priority", "planned_start", "id")[:500])
        out = []
        for r in rows:
            clearance = None
            if include_clearance and r.depends_on_clearance:
                clearance = pond_sale_clearance(cid, r.pond_id, r.planned_start)
            out.append(_lot_to_json(r, clearance=clearance))
        return JsonResponse(out, safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    ps = _parse_date(body.get("planned_start"))
    pe = _parse_date(body.get("planned_end")) or ps
    if not ps:
        return JsonResponse({"detail": "planned_start is required (YYYY-MM-DD)"}, status=400)
    row = AquacultureHarvestLotPlan(
        company_id=cid,
        pond=pond,
        planned_start=ps,
        planned_end=pe or ps,
    )
    ferr = _apply_lot_fields(row, body, cid)
    if ferr:
        return JsonResponse({"detail": ferr}, status=400)
    row.save()
    row = (
        AquacultureHarvestLotPlan.objects.filter(pk=row.pk)
        .select_related("pond", "production_cycle")
        .first()
    )
    return JsonResponse(_lot_to_json(row), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
@require_aquaculture_module("app.aquaculture.plan", methods=("POST", "PUT", "PATCH", "DELETE"))
def aquaculture_harvest_lot_plan_detail(request, plan_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    row = (
        AquacultureHarvestLotPlan.objects.filter(pk=plan_id, company_id=cid)
        .select_related("pond", "production_cycle")
        .first()
    )
    if not row:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        clearance = None
        if row.depends_on_clearance:
            clearance = pond_sale_clearance(cid, row.pond_id, row.planned_start)
        return JsonResponse(_lot_to_json(row, clearance=clearance))
    if request.method == "DELETE":
        row.delete()
        return JsonResponse({"ok": True})
    body, e = parse_json_body(request)
    if e:
        return e
    if "pond_id" in body:
        try:
            pond_id = int(body.get("pond_id"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        pond = _pond(cid, pond_id)
        if not pond:
            return JsonResponse({"detail": "Pond not found"}, status=404)
        row.pond = pond
    ferr = _apply_lot_fields(row, body, cid)
    if ferr:
        return JsonResponse({"detail": ferr}, status=400)
    if row.depends_on_clearance and row.status in (
        AquacultureHarvestLotPlan.STATUS_READY,
        AquacultureHarvestLotPlan.STATUS_SOLD,
        AquacultureHarvestLotPlan.STATUS_CLEARED,
    ):
        block = assert_pond_cleared_for_sale(cid, row.pond_id, row.planned_start)
        if block and row.status in (
            AquacultureHarvestLotPlan.STATUS_READY,
            AquacultureHarvestLotPlan.STATUS_SOLD,
        ):
            return JsonResponse(
                {
                    "detail": block,
                    "code": "sale_clearance_required",
                },
                status=400,
            )
    row.save()
    row = (
        AquacultureHarvestLotPlan.objects.filter(pk=row.pk)
        .select_related("pond", "production_cycle")
        .first()
    )
    return JsonResponse(_lot_to_json(row))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_sale_clearance(request):
    """GET ?pond_id=&sale_date=YYYY-MM-DD — food-fish withdrawal clearance for a pond."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pid = request.GET.get("pond_id")
    if not pid or not str(pid).strip().isdigit():
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    pond_id = int(pid)
    if not _pond(cid, pond_id):
        return JsonResponse({"detail": "Pond not found"}, status=404)
    sd = _parse_date(request.GET.get("sale_date"))
    if not sd:
        return JsonResponse({"detail": "sale_date is required (YYYY-MM-DD)"}, status=400)
    return JsonResponse(pond_sale_clearance(cid, pond_id, sd))
