"""Journal entries API: list, create, get, update, delete, post, unpost (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.utils.pagination import json_paged, parse_skip_limit, wants_paged_response
from api.utils.transaction_filters import (
    apply_transaction_amount_range,
    apply_transaction_date_range,
)
from api.services.reference_code import next_available_code
from api.views.common import parse_json_body, require_company_id
from django.utils import timezone as django_timezone

from api.models import AquaculturePond, JournalEntry, JournalEntryLine, ChartOfAccount, Station
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.journal_entity_display import journal_entry_site_label, journal_line_site_label
from api.services.entity_gl_scoping import (
    manual_je_entity_scoping_warnings,
    validate_manual_je_entity_scoping_for_post,
)
from api.services.gl_posting import _gl_station_id
from api.services.tenant_reporting_categories import fuel_station_reporting_category_for_journal


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _serialize_datetime(dt):
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def _line_to_json(line):
    acc = getattr(line, "account", None)
    pond = getattr(line, "aquaculture_pond", None)
    trc = getattr(line, "tenant_reporting_category", None)
    return {
        "id": line.id,
        "line_number": getattr(line, "line_number", 0),
        "account_id": line.account_id,
        "debit_account_id": line.account_id if line.debit and line.debit != 0 else None,
        "credit_account_id": line.account_id if line.credit and line.credit != 0 else None,
        "debit_account_name": acc.account_name if acc else "",
        "credit_account_name": "",
        "debit_account_code": acc.account_code if acc else "",
        "credit_account_code": "",
        "amount": str(line.debit or line.credit or 0),
        "debit": str(line.debit or 0),
        "credit": str(line.credit or 0),
        "description": line.description or "",
        "station_id": getattr(line, "station_id", None),
        "station_name": journal_line_site_label(line),
        "aquaculture_pond_id": getattr(line, "aquaculture_pond_id", None),
        "pond_name": (pond.name or "").strip() if pond else "",
        "tenant_reporting_category_id": getattr(line, "tenant_reporting_category_id", None),
        "tenant_reporting_category_label": (
            f"{trc.label} ({trc.code})" if trc else ""
        ),
    }


def _coerce_optional_tenant_reporting_category_id(company_id: int, raw) -> tuple[int | None, str | None]:
    if raw in (None, "", 0, "0"):
        return None, None
    try:
        i = int(raw)
    except (TypeError, ValueError):
        return None, "tenant_reporting_category_id must be an integer"
    cat = fuel_station_reporting_category_for_journal(company_id, i)
    if not cat:
        return None, "tenant_reporting_category_id not found or not a fuel-station reporting category for this company"
    return cat.id, None


def _coerce_optional_station_id(company_id: int, raw) -> int | None:
    if raw is None or raw == "" or raw == 0 or raw == "0":
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return _gl_station_id(company_id, v)


def _manual_line_station_id(company_id: int, row: dict, entry_station_id: int | None) -> int | None:
    """Line ``station_id`` in payload wins (including explicit null); else entry default."""
    if "station_id" in row:
        return _coerce_optional_station_id(company_id, row["station_id"])
    return entry_station_id


def _coerce_optional_pond_id(company_id: int, raw) -> tuple[int | None, str | None]:
    if raw in (None, "", 0, "0"):
        return None, None
    try:
        pid = int(raw)
    except (TypeError, ValueError):
        return None, "aquaculture_pond_id must be an integer"
    if pid <= 0:
        return None, "aquaculture_pond_id must be a positive integer"
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id, is_active=True).exists():
        return None, "Unknown or inactive aquaculture_pond_id for this company"
    return pid, None


def _manual_line_pond_id(company_id: int, row: dict) -> tuple[int | None, str | None]:
    """Line ``aquaculture_pond_id`` in payload only (no entry-level pond default)."""
    if "aquaculture_pond_id" in row or "pond_id" in row:
        raw = row.get("aquaculture_pond_id", row.get("pond_id"))
        return _coerce_optional_pond_id(company_id, raw)
    return None, None


def _entry_to_json(e):
    lines = list(
        e.lines.all()
        .select_related("account", "station", "aquaculture_pond", "tenant_reporting_category")
        .order_by("id")
    )
    total_debit = sum(l.debit or 0 for l in lines)
    total_credit = sum(l.credit or 0 for l in lines)
    line_list = []
    for i, l in enumerate(lines):
        j = _line_to_json(l)
        j["line_number"] = i + 1
        line_list.append(j)
    return {
        "id": e.id,
        "entry_number": e.entry_number or "",
        "entry_date": _serialize_date(e.entry_date),
        "reference": "",
        "description": e.description or "",
        "station_id": getattr(e, "station_id", None),
        "station_name": journal_entry_site_label(e, lines),
        "total_debit": str(total_debit),
        "total_credit": str(total_credit),
        "is_posted": e.is_posted,
        "posted_at": _serialize_datetime(e.posted_at),
        "created_at": _serialize_datetime(e.created_at),
        "updated_at": _serialize_datetime(e.updated_at),
        "lines": line_list,
    }


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def _manual_journal_eligible_for_post(entry: JournalEntry) -> tuple[bool, str]:
    """
    User-created journals must be balanced double-entry before posting (hits GL reports).
    System AUTO-* journals are expected to already satisfy this when created by gl_posting.
    """
    lines = list(entry.lines.all())
    if not lines:
        return False, "Add at least one journal line before posting."

    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for line in lines:
        d = line.debit or Decimal("0")
        c = line.credit or Decimal("0")
        if d < 0 or c < 0:
            return False, "Line amounts cannot be negative."
        if d > 0 and c > 0:
            return False, "Each line must be either a debit or a credit, not both."
        total_debit += d
        total_credit += c

    total_debit = total_debit.quantize(Decimal("0.01"))
    total_credit = total_credit.quantize(Decimal("0.01"))

    if total_debit <= 0:
        return False, "Total debits must be greater than zero."

    if total_debit != total_credit:
        return (
            False,
            f"Total debits ({total_debit}) must equal total credits ({total_credit}) before posting.",
        )

    return True, ""


def _entity_directory_station_json(st: Station) -> dict:
    return {
        "id": st.id,
        "station_name": st.station_name or "",
        "station_number": st.station_number or "",
        "operates_fuel_retail": bool(getattr(st, "operates_fuel_retail", True)),
        "is_active": st.is_active,
    }


def _entity_directory_pond_json(p: AquaculturePond) -> dict:
    return {
        "id": p.id,
        "name": p.name or "",
        "pond_role": getattr(p, "pond_role", None) or "grow_out",
        "operational_display_name": pond_operational_display_name(p),
        "is_active": p.is_active,
    }


@csrf_exempt
@auth_required
@require_company_id
def journal_entries_entity_directory(request):
    """
    Stations + ponds for manual journal entity tagging (GL).
    Same scope as journal entry access — no aquaculture-module API gate.
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    stations = [
        _entity_directory_station_json(s)
        for s in Station.objects.filter(company_id=cid).order_by("id")
    ]
    ponds = [
        _entity_directory_pond_json(p)
        for p in AquaculturePond.objects.filter(company_id=cid).order_by("sort_order", "id")
    ]
    return JsonResponse({"stations": stations, "ponds": ponds})


@csrf_exempt
@auth_required
@require_company_id
def journal_entries_list_or_create(request):
    if request.method == "GET":
        return _journal_entries_list(request)
    if request.method == "POST":
        return journal_entry_create(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _journal_entries_base_qs(company_id: int):
    return (
        JournalEntry.objects.filter(company_id=company_id)
        .select_related("station")
        .prefetch_related(
            "lines",
            "lines__account",
            "lines__station",
            "lines__aquaculture_pond",
            "lines__tenant_reporting_category",
        )
    )


def _journal_entries_apply_filters(qs, request):
    qs = apply_transaction_date_range(qs, request, "entry_date")

    min_amount = request.GET.get("min_amount")
    max_amount = request.GET.get("max_amount")
    filter_column = (request.GET.get("filter_column") or "").strip().lower()
    filter_value = (request.GET.get("filter_value") or "").strip()
    q = (request.GET.get("q") or "").strip()

    need_amount_annotate = bool(
        min_amount or max_amount or (filter_column == "amount" and filter_value)
    )
    if need_amount_annotate:
        qs = qs.annotate(
            _total_debit=Coalesce(Sum("lines__debit"), Decimal("0")),
            _total_credit=Coalesce(Sum("lines__credit"), Decimal("0")),
        )

    if min_amount:
        d_min = _decimal(min_amount)
        if d_min > 0:
            qs = qs.filter(_total_debit__gte=d_min)
    if max_amount:
        d_max = _decimal(max_amount)
        if d_max > 0:
            qs = qs.filter(_total_debit__lte=d_max)

    if filter_column and filter_column != "all" and filter_value:
        search_value = filter_value.lower()
        if filter_column == "entry_number":
            qs = qs.filter(entry_number__icontains=filter_value)
        elif filter_column == "reference":
            qs = qs.filter(description__icontains=filter_value)
        elif filter_column == "description":
            qs = qs.filter(description__icontains=filter_value)
        elif filter_column == "account":
            qs = qs.filter(
                Q(lines__account__account_name__icontains=filter_value)
                | Q(lines__account__account_code__icontains=filter_value)
            ).distinct()
        elif filter_column == "amount":
            try:
                if "-" in filter_value:
                    parts = filter_value.split("-", 1)
                    lo = _decimal(parts[0].strip())
                    hi = _decimal(parts[1].strip())
                    if lo > 0 and hi > 0:
                        qs = qs.filter(_total_debit__gte=lo, _total_debit__lte=hi)
                else:
                    amount_value = _decimal(filter_value)
                    if amount_value > 0:
                        qs = qs.filter(
                            _total_debit__gte=amount_value - Decimal("0.01"),
                            _total_debit__lte=amount_value + Decimal("0.01"),
                        )
            except Exception:
                pass
        elif filter_column == "is_posted":
            if search_value in ("true", "1", "yes", "posted"):
                qs = qs.filter(is_posted=True)
            elif search_value in ("false", "0", "no", "draft"):
                qs = qs.filter(is_posted=False)

    if q:
        qs = qs.filter(
            Q(entry_number__icontains=q)
            | Q(description__icontains=q)
            | Q(lines__account__account_name__icontains=q)
            | Q(lines__account__account_code__icontains=q)
            | Q(station__station_name__icontains=q)
            | Q(lines__station__station_name__icontains=q)
            | Q(lines__aquaculture_pond__name__icontains=q)
        ).distinct()

    return qs


def _journal_entries_list(request):
    qs = _journal_entries_base_qs(request.company_id)
    qs = _journal_entries_apply_filters(qs, request)
    qs = qs.order_by("-entry_date", "-id")

    if wants_paged_response(request):
        skip, limit = parse_skip_limit(request, default_limit=50, max_limit=500)
        total = qs.count()
        page = qs[skip : skip + limit]
        return json_paged(
            [_entry_to_json(e) for e in page],
            total=total,
            skip=skip,
            limit=limit,
        )

    try:
        limit = int(request.GET.get("limit", 100))
    except (ValueError, TypeError):
        limit = 100
    limit = max(1, min(limit, 2000))
    qs = qs[:limit]
    return JsonResponse([_entry_to_json(e) for e in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def journal_entry_create(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    entry_date = _parse_date(body.get("entry_date")) or date.today()
    desc = (body.get("description") or "").strip()
    st_id = _coerce_optional_station_id(request.company_id, body.get("station_id"))
    e = JournalEntry(
        company_id=request.company_id,
        entry_number=next_available_code(
            request.company_id, JournalEntry, "entry_number", "JE"
        ),
        entry_date=entry_date,
        description=desc,
        station_id=st_id,
        is_posted=False,
    )
    e.save()
    lines = body.get("lines") or []
    for i, row in enumerate(lines):
        debit_acc = row.get("debit_account_id")
        credit_acc = row.get("credit_account_id")
        amount = _decimal(row.get("amount"))
        if not amount:
            continue
        lsid = _manual_line_station_id(request.company_id, row, st_id)
        pond_id, pond_err = _manual_line_pond_id(request.company_id, row)
        if pond_err:
            return JsonResponse({"detail": pond_err}, status=400)
        trc_id, trc_err = _coerce_optional_tenant_reporting_category_id(
            request.company_id, row.get("tenant_reporting_category_id")
        )
        if trc_err:
            return JsonResponse({"detail": trc_err}, status=400)
        if debit_acc and ChartOfAccount.objects.filter(id=debit_acc, company_id=request.company_id).exists():
            JournalEntryLine.objects.create(
                journal_entry=e,
                account_id=debit_acc,
                debit=amount,
                credit=0,
                description=row.get("description") or "",
                station_id=lsid,
                aquaculture_pond_id=pond_id,
                tenant_reporting_category_id=trc_id,
            )
        if credit_acc and ChartOfAccount.objects.filter(id=credit_acc, company_id=request.company_id).exists():
            JournalEntryLine.objects.create(
                journal_entry=e,
                account_id=credit_acc,
                debit=0,
                credit=amount,
                description=row.get("description") or "",
                station_id=lsid,
                aquaculture_pond_id=pond_id,
                tenant_reporting_category_id=trc_id,
            )
    e.refresh_from_db()
    return JsonResponse(_entry_to_json(e), status=201)


@csrf_exempt
@auth_required
@require_company_id
def journal_entry_detail(request, entry_id: int):
    e = (
        JournalEntry.objects.filter(id=entry_id, company_id=request.company_id)
        .select_related("station")
        .prefetch_related(
            "lines",
            "lines__account",
            "lines__station",
            "lines__aquaculture_pond",
            "lines__tenant_reporting_category",
        )
        .first()
    )
    if not e:
        return JsonResponse({"detail": "Journal entry not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_entry_to_json(e))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if e.is_posted:
            return JsonResponse(
                {"detail": "Cannot edit a posted journal entry. Unpost it first."},
                status=400,
            )
        e.entry_date = _parse_date(body.get("entry_date")) or e.entry_date
        e.description = (body.get("description") or "").strip() or e.description
        if "station_id" in body:
            e.station_id = _coerce_optional_station_id(
                request.company_id, body.get("station_id")
            )
        e.save()
        lines = body.get("lines")
        if lines is not None:
            e.lines.all().delete()
            for row in lines:
                debit_acc = row.get("debit_account_id")
                credit_acc = row.get("credit_account_id")
                amount = _decimal(row.get("amount"))
                lsid = _manual_line_station_id(request.company_id, row, e.station_id)
                pond_id, pond_err = _manual_line_pond_id(request.company_id, row)
                if pond_err:
                    return JsonResponse({"detail": pond_err}, status=400)
                trc_id, trc_err = _coerce_optional_tenant_reporting_category_id(
                    request.company_id, row.get("tenant_reporting_category_id")
                )
                if trc_err:
                    return JsonResponse({"detail": trc_err}, status=400)
                if amount and debit_acc and ChartOfAccount.objects.filter(id=debit_acc, company_id=request.company_id).exists():
                    JournalEntryLine.objects.create(
                        journal_entry=e,
                        account_id=debit_acc,
                        debit=amount,
                        credit=0,
                        description=row.get("description") or "",
                        station_id=lsid,
                        aquaculture_pond_id=pond_id,
                        tenant_reporting_category_id=trc_id,
                    )
                if amount and credit_acc and ChartOfAccount.objects.filter(id=credit_acc, company_id=request.company_id).exists():
                    JournalEntryLine.objects.create(
                        journal_entry=e,
                        account_id=credit_acc,
                        debit=0,
                        credit=amount,
                        description=row.get("description") or "",
                        station_id=lsid,
                        aquaculture_pond_id=pond_id,
                        tenant_reporting_category_id=trc_id,
                    )
        e.refresh_from_db()
        return JsonResponse(_entry_to_json(e))
    if request.method == "DELETE":
        if e.is_posted:
            return JsonResponse({"detail": "Cannot delete posted entry"}, status=400)
        e.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def journal_entry_post(request, entry_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    e = JournalEntry.objects.filter(id=entry_id, company_id=request.company_id).first()
    if not e:
        return JsonResponse({"detail": "Journal entry not found"}, status=404)
    if e.is_posted:
        e_out = (
            JournalEntry.objects.filter(id=entry_id, company_id=request.company_id)
            .select_related("station")
            .prefetch_related(
            "lines",
            "lines__account",
            "lines__station",
            "lines__aquaculture_pond",
            "lines__tenant_reporting_category",
        )
            .first()
        )
        if not e_out:
            return JsonResponse({"detail": "Journal entry not found"}, status=404)
        return JsonResponse(_entry_to_json(e_out))

    ok, err = _manual_journal_eligible_for_post(e)
    if not ok:
        return JsonResponse(
            {"detail": err, "code": "journal_not_balanced"},
            status=400,
        )

    scope_ok, scope_err = validate_manual_je_entity_scoping_for_post(e)
    if not scope_ok:
        return JsonResponse(
            {"detail": scope_err, "code": "entity_scoping_required"},
            status=400,
        )

    e.is_posted = True
    e.posted_at = django_timezone.now()
    e.save()
    e_out = (
        JournalEntry.objects.filter(id=entry_id, company_id=request.company_id)
        .select_related("station")
        .prefetch_related(
            "lines",
            "lines__account",
            "lines__station",
            "lines__aquaculture_pond",
            "lines__tenant_reporting_category",
        )
        .first()
    )
    if not e_out:
        return JsonResponse({"detail": "Journal entry not found after post"}, status=500)
    payload = _entry_to_json(e_out)
    warnings = manual_je_entity_scoping_warnings(e_out)
    if warnings:
        payload["entity_scoping_warnings"] = warnings
    return JsonResponse(payload)


@csrf_exempt
@auth_required
@require_company_id
def journal_entry_unpost(request, entry_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    e = JournalEntry.objects.filter(id=entry_id, company_id=request.company_id).first()
    if not e:
        return JsonResponse({"detail": "Journal entry not found"}, status=404)
    parsed, err = parse_json_body(request)
    if err:
        return err
    body = parsed or {}
    remove = bool(body.get("remove_system_entry") or body.get("purge_auto_entry"))
    en = (e.entry_number or "").strip()
    if remove and en.startswith("AUTO-"):
        e.delete()
        return JsonResponse({"detail": "System journal entry removed", "removed": True})
    e.is_posted = False
    e.posted_at = None
    e.save()
    e = (
        JournalEntry.objects.filter(id=entry_id, company_id=request.company_id)
        .select_related("station")
        .prefetch_related(
            "lines",
            "lines__account",
            "lines__station",
            "lines__aquaculture_pond",
            "lines__tenant_reporting_category",
        )
        .first()
    )
    if not e:
        return JsonResponse({"detail": "Unposted", "removed": False})
    return JsonResponse(_entry_to_json(e))
