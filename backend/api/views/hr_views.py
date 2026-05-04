"""HR: employees, employee subledger, payroll run (totals + optional salary GL post)."""
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import (
    AquaculturePond,
    Company,
    Employee,
    EmployeeLedgerEntry,
    JournalEntry,
    PayrollRun,
    PayrollRunPondAllocation,
)
from api.services.permission_service import user_may_access_aquaculture_api
from api.services.reference_code import (
    assign_string_code_if_empty,
    first_free_suffix,
    collect_used_suffixes,
    format_code,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.services.contact_ledgers import build_employee_ledger, ledger_query_dates
from api.services.gl_posting import post_payroll_salary
from api.services.station_defaults import parse_optional_station_fk


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _decimal(val, default=None):
    if val is None:
        return default if default is not None else Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return default if default is not None else Decimal("0")


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


EARNING_KEYS = (
    "base_salary_total",
    "overtime_amount",
    "bonus_amount",
    "other_earnings_amount",
)


def _q_money(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(Decimal("0.01"))


def _gross_from_earning_parts(
    base: Decimal, ot: Decimal, bonus: Decimal, other: Decimal
) -> Decimal:
    return _q_money(base + ot + bonus + other)


def _earning_tuple_from_body(body: dict, p: PayrollRun | None) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Resolve four earning amounts; missing keys use existing payroll row when `p` is set."""

    def pick(attr: str) -> Decimal:
        if attr in body:
            return _decimal(body.get(attr), Decimal("0"))
        if p is not None:
            return _q_money(getattr(p, attr, None) or Decimal("0"))
        return Decimal("0")

    return (
        pick("base_salary_total"),
        pick("overtime_amount"),
        pick("bonus_amount"),
        pick("other_earnings_amount"),
    )


def _validate_earning_parts_non_negative(
    base: Decimal, ot: Decimal, bonus: Decimal, other: Decimal
) -> str | None:
    if base < 0:
        return "Base salary cannot be negative"
    if ot < 0:
        return "Overtime cannot be negative"
    if bonus < 0:
        return "Bonus cannot be negative"
    if other < 0:
        return "Other earnings cannot be negative"
    return None


def _employee_to_json(e: Employee) -> dict:
    return {
        "id": e.id,
        "employee_number": e.employee_number or "",
        "employee_code": e.employee_code or e.employee_number or "",
        "first_name": e.first_name or "",
        "last_name": e.last_name or "",
        "email": e.email or "",
        "phone": e.phone or "",
        "position": e.job_title or "",
        "job_title": e.job_title or "",
        "department": e.department or "",
        "hire_date": _serialize_date(e.hire_date),
        "salary": float(e.salary) if e.salary is not None else None,
        "opening_balance": str(e.opening_balance),
        "opening_balance_date": _serialize_date(e.opening_balance_date),
        "current_balance": str(e.current_balance),
        "is_active": e.is_active,
        "home_station_id": e.home_station_id,
        "home_station_name": (
            (e.home_station.station_name or "").strip()
            if getattr(e, "home_station_id", None) and getattr(e, "home_station", None)
            else ""
        ),
    }


def _next_employee_code_from_id(employee_id: int) -> str:
    """Legacy helper; new auto-codes use gap-based EMP-##### assignment."""
    return f"EMP-{employee_id:05d}"


def _suggested_next_employee_code(company_id: int) -> str:
    """Next suggested EMP-#####: lowest free integer suffix, zero-padded to 5 digits."""
    used = collect_used_suffixes(company_id, Employee, "employee_code", "EMP")
    n = first_free_suffix(used)
    return format_code("EMP", n, 5)


def _refresh_employee_balance(employee_id: int) -> None:
    emp = Employee.objects.filter(pk=employee_id).first()
    if not emp:
        return
    ob = emp.opening_balance or Decimal("0")
    agg = EmployeeLedgerEntry.objects.filter(employee_id=employee_id).aggregate(
        d=Sum("debit"), c=Sum("credit")
    )
    d = agg.get("d") or Decimal("0")
    c = agg.get("c") or Decimal("0")
    nb = ob + d - c
    Employee.objects.filter(pk=employee_id).update(current_balance=nb)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def employee_next_code_suggested(request):
    """Returns the code the next created employee will receive if no custom code is sent."""
    return JsonResponse({"suggested_code": _suggested_next_employee_code(request.company_id)})


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def employees_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = Employee.objects.filter(company_id=cid).select_related("home_station").order_by("id")
        return JsonResponse([_employee_to_json(e) for e in qs], safe=False)

    body, err = parse_json_body(request)
    if err:
        return err
    code = (body.get("employee_code") or body.get("employee_number") or "").strip()
    fn = (body.get("first_name") or "").strip()
    ln = (body.get("last_name") or "").strip()
    if not fn:
        return JsonResponse({"detail": "first_name is required"}, status=400)
    hs_id = None
    if "home_station_id" in body:
        hs_id, hs_err = parse_optional_station_fk(cid, body.get("home_station_id"))
        if hs_err:
            return JsonResponse({"detail": hs_err}, status=400)
    ob = _decimal(body.get("opening_balance"), Decimal("0"))
    if code:
        if Employee.objects.filter(company_id=cid, employee_code__iexact=code[:64]).exists():
            return JsonResponse(
                {"detail": f"Employee code '{code}' is already used in this company."},
                status=409,
            )
        e = Employee(
            company_id=cid,
            employee_code=code[:64],
            employee_number=code[:64],
            home_station_id=hs_id,
            first_name=fn[:100],
            last_name=(ln or "")[:100],
            email=(body.get("email") or "")[:150],
            phone=(body.get("phone") or "")[:30],
            job_title=(body.get("job_title") or body.get("position") or "")[:200],
            department=(body.get("department") or "")[:200],
            hire_date=_parse_date(body.get("hire_date")),
            salary=_decimal(body.get("salary"), None),
            opening_balance=ob,
            opening_balance_date=_parse_date(body.get("opening_balance_date")),
            current_balance=ob,
            is_active=bool(body.get("is_active", True)),
        )
        e.save()
    else:
        e = Employee(
            company_id=cid,
            employee_code="",
            employee_number="",
            home_station_id=hs_id,
            first_name=fn[:100],
            last_name=(ln or "")[:100],
            email=(body.get("email") or "")[:150],
            phone=(body.get("phone") or "")[:30],
            job_title=(body.get("job_title") or body.get("position") or "")[:200],
            department=(body.get("department") or "")[:200],
            hire_date=_parse_date(body.get("hire_date")),
            salary=_decimal(body.get("salary"), None),
            opening_balance=ob,
            opening_balance_date=_parse_date(body.get("opening_balance_date")),
            current_balance=ob,
            is_active=bool(body.get("is_active", True)),
        )
        e.save()
        gen, gen_err = assign_string_code_if_empty(
            cid, Employee, "employee_code", "EMP", e.id, None, 5
        )
        if gen_err:
            e.delete()
            return JsonResponse({"detail": gen_err}, status=400)
        Employee.objects.filter(pk=e.pk).update(employee_code=gen, employee_number=gen)
        e.refresh_from_db()
    e = (
        Employee.objects.filter(pk=e.pk, company_id=cid)
        .select_related("home_station")
        .first()
    )
    return JsonResponse(_employee_to_json(e), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def employee_detail(request, employee_id: int):
    cid = request.company_id
    e = (
        Employee.objects.filter(pk=employee_id, company_id=cid)
        .select_related("home_station")
        .first()
    )
    if not e:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_employee_to_json(e))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if "first_name" in body:
            e.first_name = (body.get("first_name") or "")[:100] or e.first_name
        if "last_name" in body:
            e.last_name = (body.get("last_name") or "")[:100]
        if "email" in body:
            e.email = (body.get("email") or "")[:150]
        if "phone" in body:
            e.phone = (body.get("phone") or "")[:30]
        if "job_title" in body or "position" in body:
            e.job_title = (body.get("job_title") or body.get("position") or "")[:200]
        if "department" in body:
            e.department = (body.get("department") or "")[:200]
        if "hire_date" in body:
            e.hire_date = _parse_date(body.get("hire_date"))
        if "salary" in body:
            e.salary = _decimal(body.get("salary"), None)
        if "employee_code" in body or "employee_number" in body:
            code = (body.get("employee_code") or body.get("employee_number") or "").strip()
            if code:
                cslice = code[:64]
                if (
                    Employee.objects.filter(company_id=cid, employee_code__iexact=cslice)
                    .exclude(pk=e.pk)
                    .exists()
                ):
                    return JsonResponse(
                        {"detail": f"Employee code '{code}' is already used in this company."},
                        status=409,
                    )
                e.employee_code = cslice
                e.employee_number = cslice
        if "opening_balance" in body:
            e.opening_balance = _decimal(body.get("opening_balance"), e.opening_balance)
        if "opening_balance_date" in body:
            e.opening_balance_date = _parse_date(body.get("opening_balance_date"))
        if "is_active" in body:
            e.is_active = bool(body["is_active"])
        if "home_station_id" in body:
            hs_id, hs_err = parse_optional_station_fk(cid, body.get("home_station_id"))
            if hs_err:
                return JsonResponse({"detail": hs_err}, status=400)
            e.home_station_id = hs_id
        e.save()
        _refresh_employee_balance(e.id)
        e = (
            Employee.objects.filter(pk=e.pk, company_id=cid)
            .select_related("home_station")
            .first()
        )
        return JsonResponse(_employee_to_json(e))

    e.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def employee_ledger(request, employee_id: int):
    start_d, end_d = ledger_query_dates(request)
    data = build_employee_ledger(
        request.company_id, employee_id, start_date=start_d, end_date=end_d
    )
    if data.get("detail") == "Employee not found":
        return JsonResponse(data, status=404)
    return JsonResponse(data)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def employee_ledger_entries(request, employee_id: int):
    e = Employee.objects.filter(pk=employee_id, company_id=request.company_id).first()
    if not e:
        return JsonResponse({"detail": "Employee not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    ed = _parse_date(body.get("entry_date")) or date.today()
    debit = _decimal(body.get("debit"), Decimal("0"))
    credit = _decimal(body.get("credit"), Decimal("0"))
    if debit <= 0 and credit <= 0:
        return JsonResponse(
            {"detail": "debit or credit must be greater than zero"}, status=400
        )
    et = (body.get("entry_type") or "adjustment").strip().lower()[:32]
    ref = (body.get("reference") or "")[:200]
    memo = (body.get("memo") or "")[:5000]
    with transaction.atomic():
        entry = EmployeeLedgerEntry.objects.create(
            employee=e,
            entry_date=ed,
            entry_type=et,
            reference=ref,
            memo=memo,
            debit=debit,
            credit=credit,
        )
        _refresh_employee_balance(e.id)
    return JsonResponse(
        {
            "id": entry.id,
            "employee_id": e.id,
            "entry_date": entry.entry_date.isoformat(),
            "entry_type": entry.entry_type,
            "reference": entry.reference,
            "memo": entry.memo,
            "debit": str(entry.debit),
            "credit": str(entry.credit),
        },
        status=201,
    )


def _pond_allocations_for_payroll(payroll_id: int) -> list[dict]:
    rows = (
        PayrollRunPondAllocation.objects.filter(payroll_run_id=payroll_id)
        .select_related("pond")
        .order_by("pond_id")
    )
    return [
        {
            "pond_id": r.pond_id,
            "pond_name": (r.pond.name or "").strip() if r.pond_id else "",
            "amount": str((r.amount or Decimal("0")).quantize(Decimal("0.01"))),
        }
        for r in rows
    ]


def _payroll_run_to_json(p: PayrollRun, *, include_allocations: bool = True) -> dict:
    jn = ""
    if p.salary_journal_id:
        sj = getattr(p, "salary_journal", None)
        if sj is None:
            sj = JournalEntry.objects.filter(pk=p.salary_journal_id).only("entry_number").first()
        if sj is not None:
            jn = (sj.entry_number or "").strip()
    base = float(getattr(p, "base_salary_total", None) or Decimal("0"))
    ot = float(getattr(p, "overtime_amount", None) or Decimal("0"))
    bon = float(getattr(p, "bonus_amount", None) or Decimal("0"))
    oth = float(getattr(p, "other_earnings_amount", None) or Decimal("0"))
    out = {
        "id": p.id,
        "payroll_number": p.payroll_number or "",
        "pay_period_start": _serialize_date(p.pay_period_start),
        "pay_period_end": _serialize_date(p.pay_period_end),
        "payment_date": _serialize_date(p.payment_date),
        "base_salary_total": base,
        "overtime_amount": ot,
        "bonus_amount": bon,
        "other_earnings_amount": oth,
        "total_gross": float(p.total_gross or Decimal("0")),
        "total_deductions": float(p.total_deductions or Decimal("0")),
        "total_net": float(p.total_net or Decimal("0")),
        "status": (p.status or "draft").strip().lower(),
        "notes": p.notes or "",
        "salary_journal_entry_id": p.salary_journal_id,
        "salary_journal_entry_number": jn,
        "is_salary_posted": bool(p.salary_journal_id),
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
        "station_id": p.station_id,
        "station_name": (
            (p.station.station_name or "").strip()
            if getattr(p, "station_id", None) and getattr(p, "station", None)
            else ""
        ),
    }
    out["pond_allocations"] = _pond_allocations_for_payroll(p.id) if include_allocations else []
    return out


def _validate_payroll_period(start: date | None, end: date | None, pay: date | None):
    if not start or not end or not pay:
        return "pay_period_start, pay_period_end, and payment_date are required"
    if start > end:
        return "pay_period_start must be on or before pay_period_end"
    if pay < end:
        return "payment_date must be on or after pay_period_end"
    return None


def _sync_payroll_pond_allocations(company_id: int, p: PayrollRun, body: dict) -> JsonResponse | None:
    """
    Replace pond allocations for this payroll run. Sum of amounts must equal total_net (within 0.02).
    """
    if "pond_allocations" not in body:
        return None
    alloc = body.get("pond_allocations")
    if not isinstance(alloc, list):
        return JsonResponse({"detail": "pond_allocations must be a list"}, status=400)
    entries: list[tuple[int, Decimal]] = []
    seen: set[int] = set()
    total = Decimal("0")
    for row in alloc:
        if not isinstance(row, dict):
            return JsonResponse({"detail": "Each pond_allocation must be an object"}, status=400)
        pid = row.get("pond_id")
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer in each pond_allocation"}, status=400)
        if pid in seen:
            return JsonResponse({"detail": f"Duplicate pond_id {pid} in pond_allocations"}, status=400)
        seen.add(pid)
        if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
            return JsonResponse({"detail": f"Pond {pid} not found for this company"}, status=404)
        amt = _decimal(row.get("amount"), Decimal("0"))
        if amt < 0:
            return JsonResponse({"detail": "Allocation amount cannot be negative"}, status=400)
        entries.append((pid, _q_money(amt)))
        total += _q_money(amt)
    net = _q_money(p.total_net or Decimal("0"))
    if abs(total - net) > Decimal("0.02"):
        return JsonResponse(
            {
                "detail": (
                    f"pond_allocations must sum to total_net ({net}); "
                    f"sum of submitted amounts is {total}."
                )
            },
            status=400,
        )
    PayrollRunPondAllocation.objects.filter(payroll_run_id=p.id).delete()
    for pid, amt in entries:
        if amt == 0:
            continue
        PayrollRunPondAllocation.objects.create(payroll_run=p, pond_id=pid, amount=amt)
    return None


def _validate_payroll_amounts(gross: Decimal, ded: Decimal, net: Decimal) -> str | None:
    g = (gross or Decimal("0")).quantize(Decimal("0.01"))
    d = (ded or Decimal("0")).quantize(Decimal("0.01"))
    n = (net or Decimal("0")).quantize(Decimal("0.01"))
    if d < 0 or n < 0 or g < 0:
        return "Gross, deductions, and net must be non-negative"
    if abs(g - d - n) > Decimal("0.02"):
        return "Gross must equal deductions + net pay"
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def payroll_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = PayrollRun.objects.filter(company_id=cid).select_related("salary_journal", "station")
        return JsonResponse(
            [_payroll_run_to_json(p, include_allocations=False) for p in qs],
            safe=False,
        )

    body, err = parse_json_body(request)
    if err:
        return err
    ps = _parse_date(body.get("pay_period_start"))
    pe = _parse_date(body.get("pay_period_end"))
    pd = _parse_date(body.get("payment_date"))
    verr = _validate_payroll_period(ps, pe, pd)
    if verr:
        return JsonResponse({"detail": verr}, status=400)

    notes = body.get("notes")
    if notes is None:
        notes_str = ""
    else:
        notes_str = str(notes)[:5000]

    base = ot = bonus = other = Decimal("0")
    g = Decimal("0")
    has_earn = any(k in body for k in EARNING_KEYS)
    has_legacy_totals = any(
        k in body for k in ("total_gross", "total_deductions", "total_net")
    )

    if has_earn:
        base, ot, bonus, other = _earning_tuple_from_body(body, None)
        ev = _validate_earning_parts_non_negative(base, ot, bonus, other)
        if ev:
            return JsonResponse({"detail": ev}, status=400)
        g = _gross_from_earning_parts(base, ot, bonus, other)
    elif has_legacy_totals:
        g = _decimal(body.get("total_gross"), Decimal("0"))
        base = _q_money(g)
        ot = bonus = other = Decimal("0")

    d, n = Decimal("0"), Decimal("0")
    if has_earn or has_legacy_totals:
        d = _decimal(body.get("total_deductions"), Decimal("0"))
        if "total_net" in body and body.get("total_net") is not None and str(body.get("total_net")).strip() != "":
            n = _decimal(body.get("total_net"), Decimal("0"))
        else:
            n = _q_money(g - d)
        aerr = _validate_payroll_amounts(g, d, n)
        if aerr:
            return JsonResponse({"detail": aerr}, status=400)

    pr_station_id = None
    if "station_id" in body:
        pr_station_id, pr_err = parse_optional_station_fk(cid, body.get("station_id"))
        if pr_err:
            return JsonResponse({"detail": pr_err}, status=400)

    p = PayrollRun(
        company_id=cid,
        station_id=pr_station_id,
        pay_period_start=ps,
        pay_period_end=pe,
        payment_date=pd,
        notes=notes_str,
        base_salary_total=base,
        overtime_amount=ot,
        bonus_amount=bonus,
        other_earnings_amount=other,
        total_gross=g,
        total_deductions=d,
        total_net=n,
    )
    p.save()
    if not p.payroll_number:
        PayrollRun.objects.filter(pk=p.pk).update(payroll_number=f"PR-{p.id:05d}")
        p.refresh_from_db()
    p = (
        PayrollRun.objects.filter(pk=p.pk, company_id=cid)
        .select_related("salary_journal", "station")
        .first()
    )
    return JsonResponse(_payroll_run_to_json(p), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def payroll_detail(request, payroll_id: int):
    cid = request.company_id
    p = (
        PayrollRun.objects.filter(pk=payroll_id, company_id=cid)
        .select_related("salary_journal", "station")
        .first()
    )
    if not p:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_payroll_run_to_json(p))

    if request.method == "PUT":
        if p.salary_journal_id:
            return JsonResponse(
                {
                    "detail": "This payroll is posted to the general ledger. Amounts and dates are locked; "
                    "reverse the linked journal in accounting if you must correct it."
                },
                status=400,
            )
        body, err = parse_json_body(request)
        if err:
            return err
        ps = _parse_date(body.get("pay_period_start")) or p.pay_period_start
        pe = _parse_date(body.get("pay_period_end")) or p.pay_period_end
        pd = _parse_date(body.get("payment_date")) or p.payment_date
        verr = _validate_payroll_period(ps, pe, pd)
        if verr:
            return JsonResponse({"detail": verr}, status=400)
        p.pay_period_start = ps
        p.pay_period_end = pe
        p.payment_date = pd
        if "notes" in body:
            n = body.get("notes")
            p.notes = "" if n is None else str(n)[:5000]

        amount_touched = False
        if any(k in body for k in EARNING_KEYS):
            base, ot, bonus, other_amt = _earning_tuple_from_body(body, p)
            ev = _validate_earning_parts_non_negative(base, ot, bonus, other_amt)
            if ev:
                return JsonResponse({"detail": ev}, status=400)
            g_new = _gross_from_earning_parts(base, ot, bonus, other_amt)
            p.base_salary_total = _q_money(base)
            p.overtime_amount = _q_money(ot)
            p.bonus_amount = _q_money(bonus)
            p.other_earnings_amount = _q_money(other_amt)
            p.total_gross = g_new
            amount_touched = True
        elif "total_gross" in body:
            g = _decimal(body.get("total_gross"), p.total_gross)
            p.base_salary_total = _q_money(g)
            p.overtime_amount = Decimal("0")
            p.bonus_amount = Decimal("0")
            p.other_earnings_amount = Decimal("0")
            p.total_gross = _q_money(g)
            amount_touched = True

        if amount_touched or "total_deductions" in body or "total_net" in body:
            g = _q_money(p.total_gross)
            d = _decimal(
                body.get("total_deductions") if "total_deductions" in body else p.total_deductions,
                p.total_deductions,
            )
            if "total_net" in body and body.get("total_net") is not None and str(body.get("total_net")).strip() != "":
                n = _decimal(body.get("total_net"), p.total_net)
            else:
                n = _q_money(g - d)
            aerr = _validate_payroll_amounts(g, d, n)
            if aerr:
                return JsonResponse({"detail": aerr}, status=400)
            p.total_deductions = d
            p.total_net = n
        if "status" in body and body.get("status") is not None:
            p.status = str(body.get("status") or "draft")[:32].lower()
        if "station_id" in body:
            pr_sid, pr_err = parse_optional_station_fk(cid, body.get("station_id"))
            if pr_err:
                return JsonResponse({"detail": pr_err}, status=400)
            p.station_id = pr_sid
        p.save()
        if "pond_allocations" in body:
            if p.salary_journal_id:
                return JsonResponse(
                    {
                        "detail": "Cannot change pond allocations after salary is posted to the general ledger.",
                    },
                    status=400,
                )
            co_aq = Company.objects.filter(pk=cid).only("aquaculture_enabled").first()
            if not co_aq or not getattr(co_aq, "aquaculture_enabled", False):
                return JsonResponse(
                    {
                        "detail": "Aquaculture is not enabled for this company; pond_allocations cannot be set.",
                    },
                    status=400,
                )
            user_aq = getattr(request, "api_user", None)
            if not user_may_access_aquaculture_api(user_aq):
                return JsonResponse(
                    {
                        "detail": "Pond payroll splits are only available to the company Admin when Aquaculture is enabled.",
                    },
                    status=403,
                )
            sync_err = _sync_payroll_pond_allocations(cid, p, body)
            if sync_err:
                return sync_err
        p2 = (
            PayrollRun.objects.filter(pk=p.pk, company_id=cid)
            .select_related("salary_journal", "station")
            .first()
        )
        return JsonResponse(_payroll_run_to_json(p2))

    if p.salary_journal_id:
        return JsonResponse(
            {
                "detail": "Cannot delete a payroll that is posted. Remove or unpost the salary journal first."
            },
            status=400,
        )
    p.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def payroll_from_employees(request, payroll_id: int):
    """
    Set total_gross = sum of active employees' salary; deductions=0; net=gross.
    Re-run if you change headcount. Not allowed after GL post.
    """
    cid = request.company_id
    p = PayrollRun.objects.filter(pk=payroll_id, company_id=cid).first()
    if not p:
        return JsonResponse({"detail": "Not found"}, status=404)
    if p.salary_journal_id:
        return JsonResponse(
            {"detail": "Already posted. Totals are locked."},
            status=400,
        )
    s = (
        Employee.objects.filter(
            company_id=cid, is_active=True, salary__isnull=False, salary__gt=0
        ).aggregate(t=Sum("salary"))["t"]
    ) or Decimal("0")
    s = s.quantize(Decimal("0.01"))
    p.base_salary_total = s
    p.overtime_amount = Decimal("0")
    p.bonus_amount = Decimal("0")
    p.other_earnings_amount = Decimal("0")
    p.total_gross = s
    p.total_deductions = Decimal("0")
    p.total_net = s
    p.save()
    p.refresh_from_db()
    p = (
        PayrollRun.objects.filter(pk=p.id, company_id=cid)
        .select_related("salary_journal")
        .first()
    )
    return JsonResponse(_payroll_run_to_json(p), status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def payroll_from_one_employee(request, payroll_id: int):
    """
    Set total_gross = one active employee's salary; deductions=0; net=gross.
    Use after you paid that person (cash/bank/MFS) to align books without summing the whole team.
    """
    cid = request.company_id
    p = PayrollRun.objects.filter(pk=payroll_id, company_id=cid).first()
    if not p:
        return JsonResponse({"detail": "Not found"}, status=404)
    if p.salary_journal_id:
        return JsonResponse(
            {"detail": "Already posted. Totals are locked."},
            status=400,
        )
    body, err = parse_json_body(request)
    if err:
        return err
    eid = body.get("employee_id")
    try:
        eid = int(eid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "employee_id is required (integer)."}, status=400)

    emp = (
        Employee.objects.filter(pk=eid, company_id=cid)
        .only(
            "id",
            "is_active",
            "salary",
            "first_name",
            "last_name",
            "employee_number",
            "employee_code",
        )
        .first()
    )
    if not emp:
        return JsonResponse({"detail": "Employee not found."}, status=404)
    if not emp.is_active:
        return JsonResponse({"detail": "Employee is not active."}, status=400)
    s = (emp.salary or Decimal("0")).quantize(Decimal("0.01"))
    if s <= 0:
        return JsonResponse(
            {
                "detail": "This employee has no positive salary in HR. Open Employees and set salary, then try again.",
            },
            status=400,
        )
    p.base_salary_total = s
    p.overtime_amount = Decimal("0")
    p.bonus_amount = Decimal("0")
    p.other_earnings_amount = Decimal("0")
    p.total_gross = s
    p.total_deductions = Decimal("0")
    p.total_net = s
    p.save()
    p.refresh_from_db()
    p = (
        PayrollRun.objects.filter(pk=p.id, company_id=cid)
        .select_related("salary_journal")
        .first()
    )
    return JsonResponse(_payroll_run_to_json(p), status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def payroll_post_to_books(request, payroll_id: int):
    """
    After you have paid staff from the bank, post one journal: Dr 6400, Cr 2210/2200? Cr bank.
    Body: { "bank_account_id": <optional>, "pay_from_chart_account_id": <optional GL id for net pay> }
    If a bank register is given, it takes priority over pay_from_chart_account_id.
    """
    cid = request.company_id
    p = PayrollRun.objects.filter(pk=payroll_id, company_id=cid).first()
    if not p:
        return JsonResponse({"detail": "Not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    bank_id = body.get("bank_account_id")
    baid = None
    if bank_id is not None and str(bank_id).strip() != "":
        try:
            baid = int(bank_id)
        except (TypeError, ValueError):
            baid = None
    pcoa = body.get("pay_from_chart_account_id")
    pcaid = None
    if pcoa is not None and str(pcoa).strip() != "":
        try:
            pcaid = int(pcoa)
        except (TypeError, ValueError):
            pcaid = None

    with transaction.atomic():
        p = (
            PayrollRun.objects.select_for_update()
            .filter(pk=payroll_id, company_id=cid)
            .first()
        )
        if not p:
            return JsonResponse({"detail": "Not found"}, status=404)
        je, em = post_payroll_salary(cid, p, baid, pcaid)
        if em:
            return JsonResponse({"detail": em}, status=400)
    p2 = (
        PayrollRun.objects.filter(pk=payroll_id, company_id=cid)
        .select_related("salary_journal")
        .first()
    )
    out = _payroll_run_to_json(p2)
    out["message"] = (
        f"General ledger entry {out.get('salary_journal_entry_number') or ''} created. "
        f"Run date = payment date. Record actual bank payment outside the app; this updates your books only."
    )
    return JsonResponse(out, status=200)
