"""Aquaculture → Financing API (working-capital loans, allocations, repayment worksheet)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.services.aquaculture_financing_service import (
    METHOD_EQUAL,
    METHOD_PROFIT_SHARE,
    METHOD_REVENUE_SHARE,
    apply_repayment_worksheet,
    build_financing_overview,
    compute_repayment_worksheet,
    record_financing_allocations,
)
from api.utils.auth import auth_required
from api.views.aquaculture_views import _aquaculture_access, _parse_date
from api.views.common import parse_json_body, require_company_id


def _parse_positive_decimal(val, field: str = "amount") -> Decimal | None:
    if val is None or val == "":
        return None
    try:
        d = Decimal(str(val))
    except Exception:
        return None
    if d <= 0:
        return None
    return d.quantize(Decimal("0.01"))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_financing_overview(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(build_financing_overview(request.company_id))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_financing_repayment_worksheet(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    try:
        loan_id = int(request.GET.get("loan_id", ""))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "loan_id is required"}, status=400)
    start = _parse_date(request.GET.get("start_date") or request.GET.get("start"))
    end = _parse_date(request.GET.get("end_date") or request.GET.get("end"))
    if not start or not end:
        return JsonResponse({"detail": "start_date and end_date required (YYYY-MM-DD)"}, status=400)
    if end < start:
        return JsonResponse({"detail": "end_date must be on or after start_date"}, status=400)
    method = (request.GET.get("method") or METHOD_PROFIT_SHARE).strip().lower()
    total = _parse_positive_decimal(request.GET.get("total_amount"))
    if total is None:
        return JsonResponse({"detail": "positive total_amount required"}, status=400)
    try:
        payload = compute_repayment_worksheet(
            cid,
            loan_id=loan_id,
            start=start,
            end=end,
            method=method,
            total_amount=total,
        )
    except LookupError as e:
        return JsonResponse({"detail": str(e)}, status=404)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_financing_repayment_apply(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    body, e = parse_json_body(request)
    if e:
        return e
    try:
        loan_id = int(body.get("loan_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "loan_id is required"}, status=400)
    td = _parse_date(body.get("transfer_date"))
    if not td:
        return JsonResponse({"detail": "transfer_date required"}, status=400)
    rows = body.get("ponds") or body.get("rows") or []
    if not isinstance(rows, list):
        return JsonResponse({"detail": "ponds must be a list"}, status=400)
    try:
        debit_id = int(body.get("debit_account_id"))
        credit_id = int(body.get("credit_account_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "debit_account_id and credit_account_id required"}, status=400)
    loan_repay = body.get("loan_repay")
    if loan_repay is not None and not isinstance(loan_repay, dict):
        return JsonResponse({"detail": "loan_repay must be an object"}, status=400)
    try:
        result = apply_repayment_worksheet(
            cid,
            loan_id=loan_id,
            transfer_date=td,
            rows=rows,
            debit_account_id=debit_id,
            credit_account_id=credit_id,
            post_transfers=bool(body.get("post_transfers", True)),
            loan_repay=loan_repay,
        )
    except LookupError as ex:
        return JsonResponse({"detail": str(ex)}, status=404)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    return JsonResponse(result, status=201)


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_financing_allocations(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        from api.models import AquacultureFinancingAllocation

        loan_id = request.GET.get("loan_id")
        qs = AquacultureFinancingAllocation.objects.filter(company_id=cid).select_related(
            "loan", "pond"
        )
        if loan_id:
            try:
                qs = qs.filter(loan_id=int(loan_id))
            except (TypeError, ValueError):
                return JsonResponse({"detail": "Invalid loan_id"}, status=400)
        qs = qs.order_by("-allocation_date", "-id")[:200]
        from api.services.aquaculture_financing_service import _allocation_json

        return JsonResponse([_allocation_json(a) for a in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        loan_id = int(body.get("loan_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "loan_id is required"}, status=400)
    ad = _parse_date(body.get("allocation_date"))
    if not ad:
        return JsonResponse({"detail": "allocation_date required"}, status=400)
    kind = (body.get("allocation_kind") or "use").strip().lower()
    rows = body.get("rows") or body.get("allocations") or []
    if not isinstance(rows, list) or not rows:
        return JsonResponse({"detail": "rows list required"}, status=400)
    disbursement_id = body.get("disbursement_id")
    try:
        did = int(disbursement_id) if disbursement_id not in (None, "") else None
    except (TypeError, ValueError):
        return JsonResponse({"detail": "Invalid disbursement_id"}, status=400)
    try:
        out = record_financing_allocations(
            cid,
            loan_id=loan_id,
            allocation_date=ad,
            allocation_kind=kind,
            rows=rows,
            disbursement_id=did,
        )
    except LookupError as ex:
        return JsonResponse({"detail": str(ex)}, status=404)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    return JsonResponse(out, safe=False, status=201)
