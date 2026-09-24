"""Credit notes, year-end close, and bank reconciliation."""
from datetime import date
from decimal import Decimal

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.exceptions import GlPostingError, StockBusinessError
from api.models import BankStatement, CreditNote
from api.services.bank_reconciliation import create_bank_statement, reconciliation_report
from api.services.credit_note import post_credit_note, refund_credit_note
from api.services.fiscal_year_close import close_fiscal_year
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, require_permission


def _date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _money(value):
    if value in (None, ""):
        return None
    return Decimal(str(value))


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
@require_permission("app.page.invoices", methods=("POST",))
def credit_notes_create(request):
    body, err = parse_json_body(request)
    if err:
        return err
    try:
        invoice_id = int(body.get("invoice_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "invoice_id is required"}, status=400)
    try:
        note = post_credit_note(
            request.company_id,
            invoice_id,
            amount=_money(body.get("amount")),
            credit_date=_date(body.get("credit_date")),
            reason=(body.get("reason") or "")[:300],
            credit_note_number=(body.get("credit_note_number") or "")[:64],
        )
    except (GlPostingError, StockBusinessError) as exc:
        return JsonResponse({"detail": exc.detail}, status=400)
    return JsonResponse(_credit_note_json(note), status=201)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
@require_permission("app.page.invoices", methods=("POST",))
def credit_note_refund(request, credit_note_id: int):
    body, err = parse_json_body(request)
    if err:
        return err
    try:
        note = refund_credit_note(
            request.company_id,
            credit_note_id,
            amount=_money(body.get("amount")),
            refund_date=_date(body.get("refund_date")),
        )
    except GlPostingError as exc:
        return JsonResponse({"detail": exc.detail}, status=400)
    return JsonResponse(_credit_note_json(note))


def _credit_note_json(note: CreditNote) -> dict:
    return {
        "id": note.id,
        "credit_note_number": note.credit_note_number,
        "invoice_id": note.invoice_id,
        "credit_date": note.credit_date.isoformat(),
        "amount": str(note.amount),
        "refunded_amount": str(note.refunded_amount or 0),
        "stock_restored": note.stock_restored,
        "journal_entry_id": note.journal_entry_id,
        "status": note.status,
    }


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
@require_permission("app.page.reports", methods=("POST",))
def fiscal_year_close_view(request):
    body, err = parse_json_body(request)
    if err:
        return err
    try:
        year = int(body.get("fiscal_year"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "fiscal_year is required"}, status=400)
    try:
        row = close_fiscal_year(request.company_id, year)
    except GlPostingError as exc:
        return JsonResponse({"detail": exc.detail}, status=400)
    return JsonResponse(
        {
            "id": row.id,
            "fiscal_year": row.fiscal_year,
            "close_date": row.close_date.isoformat(),
            "net_income": str(row.net_income),
            "opening_absorbed": str(row.opening_absorbed),
            "journal_entry_id": row.journal_entry_id,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
@require_permission("app.page.reports", methods=("POST",))
def bank_reconciliations_create(request):
    body, err = parse_json_body(request)
    if err:
        return err
    try:
        account_id = int(body.get("account_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "account_id is required"}, status=400)
    statement_date = _date(body.get("statement_date"))
    if statement_date is None:
        return JsonResponse({"detail": "statement_date is required"}, status=400)
    parsed = []
    for raw in body.get("lines") or []:
        line_date = _date(raw.get("line_date"))
        if line_date is None:
            return JsonResponse({"detail": "Each statement line needs line_date"}, status=400)
        parsed.append(
            {
                "line_date": line_date,
                "description": raw.get("description") or "",
                "amount": raw.get("amount") or "0",
            }
        )
    try:
        stmt = create_bank_statement(
            request.company_id,
            account_id,
            statement_date,
            body.get("ending_balance") or "0",
            parsed,
        )
    except GlPostingError as exc:
        return JsonResponse({"detail": exc.detail}, status=400)
    stmt = BankStatement.objects.select_related("account").get(pk=stmt.id)
    return JsonResponse(reconciliation_report(stmt), status=201)
