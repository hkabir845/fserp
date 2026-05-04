"""Fund transfers API: list, create, get, update, delete, post, unpost (company-scoped).

Posting writes the fund transfer to the general ledger when both registers link to chart
accounts (same idea as QuickBooks: bank/cash balance follows the GL). Register-only rows
without a chart link still update BankAccount.current_balance on post/unpost.
"""
from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import FundTransfer, BankAccount
from api.services.gl_posting import delete_auto_fund_transfer_journal, post_fund_transfer_journal


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _serialize_datetime(dt):
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)


def _transfer_to_json(t):
    return {
        "id": t.id,
        "transfer_number": getattr(t, "transfer_number", "") or f"FT-{t.id}",
        "transfer_date": _serialize_date(t.transfer_date),
        "from_account_id": t.from_bank_id,
        "to_account_id": t.to_bank_id,
        "from_account_name": t.from_bank.account_name if t.from_bank_id else "",
        "to_account_name": t.to_bank.account_name if t.to_bank_id else "",
        "from_account_number": t.from_bank.account_number if t.from_bank_id else "",
        "to_account_number": t.to_bank.account_number if t.to_bank_id else "",
        "amount": str(t.amount),
        "memo": t.reference or "",
        "reference": t.reference or "",
        "is_posted": t.is_posted,
        "posted_at": _serialize_datetime(t.posted_at),
        "created_at": _serialize_datetime(t.created_at),
        "updated_at": _serialize_datetime(t.updated_at),
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


def _bump_register_balances_on_post(t: FundTransfer) -> None:
    """Adjust stored register balances only for accounts not driven by the GL."""
    amt = t.amount
    fb, tb = t.from_bank, t.to_bank
    if not fb.chart_account_id:
        fb.current_balance = (fb.current_balance or Decimal("0")) - amt
        fb.save(update_fields=["current_balance", "updated_at"])
    if not tb.chart_account_id:
        tb.current_balance = (tb.current_balance or Decimal("0")) + amt
        tb.save(update_fields=["current_balance", "updated_at"])


def _bump_register_balances_on_unpost(t: FundTransfer) -> None:
    amt = t.amount
    fb, tb = t.from_bank, t.to_bank
    if not fb.chart_account_id:
        fb.current_balance = (fb.current_balance or Decimal("0")) + amt
        fb.save(update_fields=["current_balance", "updated_at"])
    if not tb.chart_account_id:
        tb.current_balance = (tb.current_balance or Decimal("0")) - amt
        tb.save(update_fields=["current_balance", "updated_at"])


@csrf_exempt
@auth_required
@require_company_id
def fund_transfers_list_or_create(request):
    if request.method == "GET":
        qs = FundTransfer.objects.filter(company_id=request.company_id).select_related("from_bank", "to_bank").order_by("-transfer_date", "-id")
        return JsonResponse([_transfer_to_json(t) for t in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        from_id = body.get("from_account_id")
        to_id = body.get("to_account_id")
        amount = _decimal(body.get("amount"))
        if not from_id or not to_id or not amount or from_id == to_id:
            return JsonResponse({"detail": "from_account_id, to_account_id and amount are required; accounts must differ"}, status=400)
        if not BankAccount.objects.filter(id=from_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "From account not found"}, status=400)
        if not BankAccount.objects.filter(id=to_id, company_id=request.company_id).exists():
            return JsonResponse({"detail": "To account not found"}, status=400)
        t = FundTransfer(
            company_id=request.company_id,
            from_bank_id=from_id,
            to_bank_id=to_id,
            amount=amount,
            transfer_date=_parse_date(body.get("transfer_date")) or date.today(),
            reference=(body.get("memo") or body.get("reference") or "").strip(),
            is_posted=False,
        )
        t.save()
        t.refresh_from_db()
        return JsonResponse(_transfer_to_json(t), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def fund_transfer_detail(request, transfer_id: int):
    t = FundTransfer.objects.filter(id=transfer_id, company_id=request.company_id).select_related("from_bank", "to_bank").first()
    if not t:
        return JsonResponse({"detail": "Fund transfer not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_transfer_to_json(t))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if not t.is_posted:
            if body.get("transfer_date"):
                t.transfer_date = _parse_date(body["transfer_date"]) or t.transfer_date
            if "from_account_id" in body and BankAccount.objects.filter(id=body["from_account_id"], company_id=request.company_id).exists():
                t.from_bank_id = body["from_account_id"]
            if "to_account_id" in body and BankAccount.objects.filter(id=body["to_account_id"], company_id=request.company_id).exists():
                t.to_bank_id = body["to_account_id"]
            if "amount" in body:
                t.amount = _decimal(body.get("amount"), t.amount)
            if "memo" in body or "reference" in body:
                t.reference = (body.get("memo") or body.get("reference") or "").strip()
            t.save()
        t.refresh_from_db()
        return JsonResponse(_transfer_to_json(t))
    if request.method == "DELETE":
        if t.is_posted:
            return JsonResponse({"detail": "Cannot delete posted transfer"}, status=400)
        t.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def fund_transfer_post(request, transfer_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    t = FundTransfer.objects.filter(id=transfer_id, company_id=request.company_id).select_related("from_bank", "to_bank").first()
    if not t:
        return JsonResponse({"detail": "Fund transfer not found"}, status=404)
    if not t.is_posted:
        t.is_posted = True
        t.posted_at = timezone.now()
        _bump_register_balances_on_post(t)
        t.save()
        t_gl = FundTransfer.objects.filter(id=t.id).select_related(
            "from_bank__chart_account", "to_bank__chart_account"
        ).first()
        if t_gl:
            post_fund_transfer_journal(request.company_id, t_gl)
    return JsonResponse(_transfer_to_json(t))


@csrf_exempt
@auth_required
@require_company_id
def fund_transfer_unpost(request, transfer_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    t = FundTransfer.objects.filter(id=transfer_id, company_id=request.company_id).select_related("from_bank", "to_bank").first()
    if not t:
        return JsonResponse({"detail": "Fund transfer not found"}, status=404)
    if t.is_posted:
        _bump_register_balances_on_unpost(t)
        t.is_posted = False
        t.posted_at = None
        t.save()
        delete_auto_fund_transfer_journal(request.company_id, t.id)
    return JsonResponse(_transfer_to_json(t))
