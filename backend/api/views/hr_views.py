"""HR: employees + manual employee subledger; payroll run headers (CRUD, no GL yet)."""
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import Employee, EmployeeLedgerEntry, PayrollRun
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.services.contact_ledgers import build_employee_ledger, ledger_query_dates


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
    }


def _next_employee_code_from_id(employee_id: int) -> str:
    """Stable code after insert; matches suggested next code when ids are sequential."""
    return f"EMP-{employee_id:05d}"


def _suggested_next_employee_code(company_id: int) -> str:
    """Preview of the code the next employee row will get if created without a custom code."""
    max_id = (
        Employee.objects.filter(company_id=company_id).aggregate(m=Max("id")).get("m") or 0
    )
    return _next_employee_code_from_id(max_id + 1)


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
        qs = Employee.objects.filter(company_id=cid).order_by("id")
        return JsonResponse([_employee_to_json(e) for e in qs], safe=False)

    body, err = parse_json_body(request)
    if err:
        return err
    code = (body.get("employee_code") or body.get("employee_number") or "").strip()
    fn = (body.get("first_name") or "").strip()
    ln = (body.get("last_name") or "").strip()
    if not fn:
        return JsonResponse({"detail": "first_name is required"}, status=400)
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
        gen = _next_employee_code_from_id(e.id)
        Employee.objects.filter(pk=e.pk).update(employee_code=gen, employee_number=gen)
        e.refresh_from_db()
    return JsonResponse(_employee_to_json(e), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def employee_detail(request, employee_id: int):
    cid = request.company_id
    e = Employee.objects.filter(pk=employee_id, company_id=cid).first()
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
        e.save()
        _refresh_employee_balance(e.id)
        e.refresh_from_db()
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


def _payroll_run_to_json(p: PayrollRun) -> dict:
    return {
        "id": p.id,
        "payroll_number": p.payroll_number or "",
        "pay_period_start": _serialize_date(p.pay_period_start),
        "pay_period_end": _serialize_date(p.pay_period_end),
        "payment_date": _serialize_date(p.payment_date),
        "total_gross": float(p.total_gross or Decimal("0")),
        "total_deductions": float(p.total_deductions or Decimal("0")),
        "total_net": float(p.total_net or Decimal("0")),
        "status": (p.status or "draft").strip().lower(),
        "notes": p.notes or "",
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
    }


def _validate_payroll_period(start: date | None, end: date | None, pay: date | None):
    if not start or not end or not pay:
        return "pay_period_start, pay_period_end, and payment_date are required"
    if start > end:
        return "pay_period_start must be on or before pay_period_end"
    if pay < end:
        return "payment_date must be on or after pay_period_end"
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def payroll_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = PayrollRun.objects.filter(company_id=cid)
        return JsonResponse([_payroll_run_to_json(p) for p in qs], safe=False)

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

    p = PayrollRun(
        company_id=cid,
        pay_period_start=ps,
        pay_period_end=pe,
        payment_date=pd,
        notes=notes_str,
    )
    p.save()
    if not p.payroll_number:
        PayrollRun.objects.filter(pk=p.pk).update(payroll_number=f"PR-{p.id:05d}")
        p.refresh_from_db()
    return JsonResponse(_payroll_run_to_json(p), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def payroll_detail(request, payroll_id: int):
    cid = request.company_id
    p = PayrollRun.objects.filter(pk=payroll_id, company_id=cid).first()
    if not p:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_payroll_run_to_json(p))

    if request.method == "PUT":
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
        p.save()
        return JsonResponse(_payroll_run_to_json(p))

    p.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)
