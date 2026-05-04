"""Journal entries API: list, create, get, update, delete, post, unpost (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from django.utils import timezone as django_timezone

from api.models import JournalEntry, JournalEntryLine, ChartOfAccount
from api.services.gl_posting import _gl_station_id


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
    lst = getattr(line, "station", None)
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
        "station_name": (lst.station_name or "") if lst else "",
    }


def _coerce_optional_station_id(company_id: int, raw) -> int | None:
    if raw is None or raw == "" or raw == 0 or raw == "0":
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return _gl_station_id(company_id, v)


def _manual_line_station_id(company_id: int, row: dict, entry_station_id: int | None) -> int | None:
    if "station_id" in row:
        return _coerce_optional_station_id(company_id, row.get("station_id"))
    return entry_station_id


def _entry_to_json(e):
    st = getattr(e, "station", None)
    lines = list(e.lines.all().select_related("account").order_by("id"))
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
        "station_name": (st.station_name or "") if st else "",
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


@csrf_exempt
@auth_required
@require_company_id
def journal_entries_list_or_create(request):
    if request.method == "GET":
        return _journal_entries_list(request)
    if request.method == "POST":
        return journal_entry_create(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _journal_entries_list(request):
    qs = (
        JournalEntry.objects.filter(company_id=request.company_id)
        .select_related("station")
        .prefetch_related("lines", "lines__account", "lines__station")
        .order_by("-entry_date", "-id")
    )
    start = request.GET.get("start_date")
    end = request.GET.get("end_date")
    if start:
        qs = qs.filter(entry_date__gte=_parse_date(start))
    if end:
        qs = qs.filter(entry_date__lte=_parse_date(end))
    try:
        limit = int(request.GET.get("limit", 100))
    except (ValueError, TypeError):
        limit = 100
    limit = max(1, min(limit, 500))
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
    count = JournalEntry.objects.filter(company_id=request.company_id).count()
    st_id = _coerce_optional_station_id(request.company_id, body.get("station_id"))
    e = JournalEntry(
        company_id=request.company_id,
        entry_number=f"JE-{count + 1}",
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
        if debit_acc and ChartOfAccount.objects.filter(id=debit_acc, company_id=request.company_id).exists():
            JournalEntryLine.objects.create(
                journal_entry=e,
                account_id=debit_acc,
                debit=amount,
                credit=0,
                description=row.get("description") or "",
                station_id=lsid,
            )
        if credit_acc and ChartOfAccount.objects.filter(id=credit_acc, company_id=request.company_id).exists():
            JournalEntryLine.objects.create(
                journal_entry=e,
                account_id=credit_acc,
                debit=0,
                credit=amount,
                description=row.get("description") or "",
                station_id=lsid,
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
        .prefetch_related("lines", "lines__account", "lines__station")
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
        if not e.is_posted:
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
                    if amount and debit_acc and ChartOfAccount.objects.filter(id=debit_acc, company_id=request.company_id).exists():
                        JournalEntryLine.objects.create(
                            journal_entry=e,
                            account_id=debit_acc,
                            debit=amount,
                            credit=0,
                            description=row.get("description") or "",
                            station_id=lsid,
                        )
                    if amount and credit_acc and ChartOfAccount.objects.filter(id=credit_acc, company_id=request.company_id).exists():
                        JournalEntryLine.objects.create(
                            journal_entry=e,
                            account_id=credit_acc,
                            debit=0,
                            credit=amount,
                            description=row.get("description") or "",
                            station_id=lsid,
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
            .prefetch_related("lines", "lines__account", "lines__station")
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

    e.is_posted = True
    e.posted_at = django_timezone.now()
    e.save()
    e_out = (
        JournalEntry.objects.filter(id=entry_id, company_id=request.company_id)
        .select_related("station")
        .prefetch_related("lines", "lines__account", "lines__station")
        .first()
    )
    if not e_out:
        return JsonResponse({"detail": "Journal entry not found after post"}, status=500)
    return JsonResponse(_entry_to_json(e_out))


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
        .prefetch_related("lines", "lines__account", "lines__station")
        .first()
    )
    if not e:
        return JsonResponse({"detail": "Unposted", "removed": False})
    return JsonResponse(_entry_to_json(e))
