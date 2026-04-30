"""Bank accounts API: list, create, get, update, delete, statement (company-scoped)."""
from datetime import date
from decimal import Decimal
from typing import Dict, Optional

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, parse_optional_company_station_id, require_company_id
from api.models import BankAccount, ChartOfAccount
from api.services.journal_statement import (
    build_statement_transactions,
    journal_net_movement,
    journal_net_movement_map,
)


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _display_balance_for_bank(
    b: BankAccount, journal_net_by_chart: Optional[Dict[int, Decimal]] = None
) -> Decimal:
    """
    QuickBooks-style rule: when a register is linked to a chart line, the balance
    shown in lists (including Fund Transfer) is the same as Chart of Accounts —
    opening balance on that GL account plus lifetime journal activity. The
    BankAccount.current_balance field is only used for registers without a chart
    link (legacy / register-only mode).
    """
    if not b.chart_account_id:
        ob = b.current_balance if b.current_balance is not None else Decimal("0")
        return ob.quantize(Decimal("0.01"))
    ca = getattr(b, "chart_account", None)
    if ca is None:
        ca = (
            ChartOfAccount.objects.filter(id=b.chart_account_id, company_id=b.company_id)
            .only("opening_balance")
            .first()
        )
    if ca is None:
        ob = b.current_balance if b.current_balance is not None else Decimal("0")
        return ob.quantize(Decimal("0.01"))
    ob = ca.opening_balance if ca.opening_balance is not None else Decimal("0")
    if journal_net_by_chart is not None:
        jn = journal_net_by_chart.get(b.chart_account_id, Decimal("0"))
    else:
        jn = journal_net_movement(b.chart_account_id)
    return (ob + jn).quantize(Decimal("0.01"))


def _bank_to_json(b, journal_net_by_chart: Optional[Dict[int, Decimal]] = None):
    bal = _display_balance_for_bank(b, journal_net_by_chart)
    return {
        "id": b.id,
        "account_name": b.account_name,
        "account_number": b.account_number,
        "bank_name": b.bank_name,
        "account_type": b.account_type or "CHECKING",
        "opening_balance": str(b.opening_balance),
        "opening_balance_date": _serialize_date(b.opening_balance_date),
        "current_balance": str(bal),
        "is_active": b.is_active,
        "chart_account_id": b.chart_account_id,
        "is_equity_register": bool(getattr(b, "is_equity_register", False)),
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


_BANK_CHART_SUBTYPES = frozenset(
    {
        "checking",
        "savings",
        "cash_on_hand",
        "money_market",
        "cash_management",
        "other_bank_account",
    }
)


def _chart_line_eligible_for_bank_register(account_type: str, account_sub_type: str) -> bool:
    """Matches chart-of-accounts rules: bank/cash lines that should have a transfer picklist row."""
    t = (account_type or "").lower()
    st = (account_sub_type or "").lower()
    if t == "bank_account":
        return True
    if t == "asset" and st in _BANK_CHART_SUBTYPES:
        return True
    return False


def _register_type_from_chart_line(coa: ChartOfAccount) -> str:
    st = (coa.account_sub_type or "").lower()
    if st == "cash_on_hand":
        return "CASH"
    if st == "savings":
        return "SAVINGS"
    if st == "money_market":
        return "MONEY_MARKET"
    return "CHECKING"


@transaction.atomic
def ensure_bank_registers_from_chart(company_id: int) -> int:
    """
    For each active chart line that is a bank/cash type but has no BankAccount, create one.
    Fund Transfer (and similar UIs) list BankAccount ids — chart-only rows were invisible before.
    """
    linked = set(
        BankAccount.objects.filter(
            company_id=company_id, chart_account_id__isnull=False
        ).values_list("chart_account_id", flat=True)
    )
    created = 0
    for coa in (
        ChartOfAccount.objects.filter(company_id=company_id, is_active=True)
        .order_by("account_code", "id")
    ):
        if not _chart_line_eligible_for_bank_register(
            coa.account_type, coa.account_sub_type
        ):
            continue
        if coa.id in linked:
            continue
        ob = coa.opening_balance if coa.opening_balance is not None else Decimal("0")
        code = (str(coa.account_code).strip() or "—")[:64]
        BankAccount.objects.create(
            company_id=company_id,
            chart_account_id=coa.id,
            account_name=coa.account_name,
            bank_name=(coa.account_name or "Bank account")[:200],
            account_number=code,
            account_type=_register_type_from_chart_line(coa),
            opening_balance=ob,
            opening_balance_date=coa.opening_balance_date,
            current_balance=ob,
            is_active=True,
            is_equity_register=False,
        )
        linked.add(coa.id)
        created += 1
    return created


@transaction.atomic
def ensure_equity_registers_for_transfer(company_id: int) -> int:
    """
    Fund Transfer uses BankAccount FKs; mirror QuickBooks-style owner moves by exposing
    every active equity chart line as a transfer-only register (hidden from payment pickers).
    """
    linked = set(
        BankAccount.objects.filter(
            company_id=company_id, chart_account_id__isnull=False
        ).values_list("chart_account_id", flat=True)
    )
    created = 0
    for coa in (
        ChartOfAccount.objects.filter(company_id=company_id, is_active=True)
        .order_by("account_code", "id")
    ):
        if (coa.account_type or "").lower() != "equity":
            continue
        if coa.id in linked:
            continue
        ob = coa.opening_balance if coa.opening_balance is not None else Decimal("0")
        code = (str(coa.account_code).strip() or "—")[:64]
        label = (coa.account_name or "Equity")[:200]
        BankAccount.objects.create(
            company_id=company_id,
            chart_account_id=coa.id,
            account_name=coa.account_name,
            bank_name=f"Equity — {label}"[:200],
            account_number=code,
            account_type="EQUITY",
            opening_balance=ob,
            opening_balance_date=coa.opening_balance_date,
            current_balance=ob,
            is_active=True,
            is_equity_register=True,
        )
        linked.add(coa.id)
        created += 1
    return created


def _normalize_optional_chart_id(body, company_id: int):
    """Return a valid chart id for this company, or None if absent/invalid."""
    raw = body.get("chart_account_id")
    if raw is None and "chart_of_account_id" in body:
        raw = body.get("chart_of_account_id")
    if raw in (None, "", 0, "0"):
        return None
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        return None
    if not ChartOfAccount.objects.filter(id=cid, company_id=company_id).exists():
        return None
    return cid


def _next_numeric_chart_account_code(company_id: int) -> str:
    """Next unused numeric code (max existing digit-only code + 1), or 1040 if none."""
    codes = ChartOfAccount.objects.filter(company_id=company_id).values_list(
        "account_code", flat=True
    )
    best = 0
    for raw in codes:
        s = str(raw).strip()
        if s.isdigit():
            best = max(best, int(s))
    return str(best + 1) if best > 0 else "1040"


def _coa_sub_type_for_bank_register(account_type: str) -> str:
    t = (account_type or "CHECKING").upper()
    if t == "CHECKING":
        return "checking"
    if t == "SAVINGS":
        return "savings"
    if t == "CASH":
        return "cash_on_hand"
    if t == "MONEY_MARKET":
        return "money_market"
    return "checking"


@transaction.atomic
def create_and_link_chart_line_for_bank(company_id: int, bank: BankAccount) -> ChartOfAccount:
    """Create an asset GL line for this bank register and link it (idempotent if already linked)."""
    bank.refresh_from_db()
    if bank.chart_account_id:
        return ChartOfAccount.objects.get(id=bank.chart_account_id)

    code = _next_numeric_chart_account_code(company_id)
    while ChartOfAccount.objects.filter(company_id=company_id, account_code=code).exists():
        code = str(int(code) + 1)

    name = (bank.account_name or "").strip() or f"Bank {bank.account_number}"
    desc = f"Auto: {bank.bank_name} · {bank.account_number}"
    opening = bank.opening_balance or Decimal("0")

    coa = ChartOfAccount(
        company_id=company_id,
        account_code=code,
        account_name=name,
        account_type="asset",
        account_sub_type=_coa_sub_type_for_bank_register(bank.account_type),
        description=desc,
        opening_balance=opening,
        opening_balance_date=bank.opening_balance_date,
        is_active=bank.is_active,
    )
    coa.save()
    bank.chart_account_id = coa.id
    bank.save(update_fields=["chart_account_id", "updated_at"])
    return coa


def _wants_fund_transfer_list(request) -> bool:
    v = (request.GET.get("for_fund_transfer") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


@csrf_exempt
@auth_required
@require_company_id
def bank_accounts_list_or_create(request):
    if request.method == "GET":
        ensure_bank_registers_from_chart(request.company_id)
        if _wants_fund_transfer_list(request):
            ensure_equity_registers_for_transfer(request.company_id)
        qs = BankAccount.objects.filter(company_id=request.company_id)
        if not _wants_fund_transfer_list(request):
            qs = qs.filter(is_equity_register=False)
        else:
            qs = qs.filter(is_active=True)
        qs = qs.select_related("chart_account").order_by("is_equity_register", "account_name", "id")
        banks = list(qs)
        chart_ids = [x.chart_account_id for x in banks if x.chart_account_id]
        nets = journal_net_movement_map(chart_ids) if chart_ids else {}
        return JsonResponse([_bank_to_json(b, journal_net_by_chart=nets) for b in banks], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = (body.get("account_name") or "").strip()
        number = (body.get("account_number") or "").strip()
        bank = (body.get("bank_name") or "").strip()
        if not name or not number or not bank:
            return JsonResponse({"detail": "account_name, account_number and bank_name are required"}, status=400)
        if BankAccount.objects.filter(
            company_id=request.company_id, account_number__iexact=number
        ).exists():
            return JsonResponse(
                {"detail": "A bank account with this account number already exists for this company."},
                status=409,
            )
        chart_id = _normalize_optional_chart_id(body, request.company_id)
        auto_chart = body.get("auto_chart_account", True)
        if isinstance(auto_chart, str):
            auto_chart = auto_chart.lower() not in ("0", "false", "no")

        b = BankAccount(
            company_id=request.company_id,
            chart_account_id=chart_id,
            account_name=name,
            account_number=number,
            bank_name=bank,
            account_type=body.get("account_type") or "CHECKING",
            opening_balance=_decimal(body.get("opening_balance")),
            opening_balance_date=_parse_date(body.get("opening_balance_date")),
            current_balance=_decimal(body.get("opening_balance")),
            is_active=body.get("is_active", True),
        )
        b.save()
        if b.chart_account_id is None and auto_chart:
            create_and_link_chart_line_for_bank(request.company_id, b)
            b.refresh_from_db()
        b = BankAccount.objects.filter(id=b.id).select_related("chart_account").first()
        nets = journal_net_movement_map([b.chart_account_id]) if b and b.chart_account_id else {}
        return JsonResponse(_bank_to_json(b, journal_net_by_chart=nets or None), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def bank_account_detail(request, account_id: int):
    b = (
        BankAccount.objects.filter(id=account_id, company_id=request.company_id)
        .select_related("chart_account")
        .first()
    )
    if not b:
        return JsonResponse({"detail": "Bank account not found"}, status=404)

    if request.method == "GET":
        nets = journal_net_movement_map([b.chart_account_id]) if b.chart_account_id else {}
        return JsonResponse(_bank_to_json(b, journal_net_by_chart=nets or None))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("account_name"):
            b.account_name = (body.get("account_name") or "").strip() or b.account_name
        if body.get("account_number"):
            new_num = (body.get("account_number") or "").strip() or b.account_number
            if (
                new_num
                and BankAccount.objects.filter(
                    company_id=request.company_id, account_number__iexact=new_num
                )
                .exclude(id=b.id)
                .exists()
            ):
                return JsonResponse(
                    {"detail": "A bank account with this account number already exists for this company."},
                    status=409,
                )
            b.account_number = new_num
        if body.get("bank_name"):
            b.bank_name = (body.get("bank_name") or "").strip() or b.bank_name
        if "account_type" in body:
            b.account_type = body.get("account_type") or "CHECKING"
        if "opening_balance" in body:
            b.opening_balance = _decimal(body.get("opening_balance"), b.opening_balance)
        if "opening_balance_date" in body:
            b.opening_balance_date = _parse_date(body.get("opening_balance_date"))
        if "current_balance" in body:
            b.current_balance = _decimal(body.get("current_balance"), b.current_balance)
        if "is_active" in body:
            b.is_active = bool(body["is_active"])
        if "chart_account_id" in body:
            cid = body.get("chart_account_id")
            if cid in (None, "", 0, "0"):
                b.chart_account_id = None
            else:
                try:
                    cid_int = int(cid)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "Invalid chart_account_id"}, status=400)
                if not ChartOfAccount.objects.filter(id=cid_int, company_id=request.company_id).exists():
                    return JsonResponse({"detail": "chart_account_id is not a valid chart account"}, status=400)
                b.chart_account_id = cid_int
        b.save()
        b.refresh_from_db()
        b = (
            BankAccount.objects.filter(id=b.id, company_id=request.company_id)
            .select_related("chart_account")
            .first()
        )
        nets = journal_net_movement_map([b.chart_account_id]) if b and b.chart_account_id else {}
        return JsonResponse(_bank_to_json(b, journal_net_by_chart=nets or None))

    if request.method == "DELETE":
        b.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def bank_accounts_link_unlinked_to_chart(request):
    """POST: create GL lines with auto codes for every bank register missing chart_account_id."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    qs = BankAccount.objects.filter(
        company_id=request.company_id
    ).filter(chart_account_id__isnull=True)

    linked = []
    for b in qs:
        coa = create_and_link_chart_line_for_bank(request.company_id, b)
        linked.append(
            {
                "bank_account_id": b.id,
                "chart_account_id": coa.id,
                "account_code": coa.account_code,
                "account_name": coa.account_name,
            }
        )

    return JsonResponse({"linked": linked, "count": len(linked)})


@csrf_exempt
@auth_required
@require_company_id
def bank_account_statement(request, account_id: int):
    b = (
        BankAccount.objects.filter(id=account_id, company_id=request.company_id)
        .select_related("chart_account")
        .first()
    )
    if not b:
        return JsonResponse({"detail": "Bank account not found"}, status=404)
    start_date = _parse_date(request.GET.get("start_date"))
    end_date = _parse_date(request.GET.get("end_date"))
    st_sid, st_err = parse_optional_company_station_id(request.GET, request.company_id)
    if st_err:
        return st_err
    if st_sid is not None and not b.chart_account_id:
        return JsonResponse(
            {
                "detail": "station_id applies only when the bank account is linked to a GL chart account.",
            },
            status=400,
        )
    transactions: list = []
    running = b.current_balance or Decimal("0")
    opening = b.current_balance or Decimal("0")
    if b.chart_account_id:
        coa = ChartOfAccount.objects.filter(
            id=b.chart_account_id, company_id=request.company_id
        ).first()
        if coa:
            transactions, running, opening = build_statement_transactions(
                coa, start_date=start_date, end_date=end_date, station_id=st_sid
            )
    nets = journal_net_movement_map([b.chart_account_id]) if b.chart_account_id else {}
    payload = {
        "account": _bank_to_json(b, journal_net_by_chart=nets or None),
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "opening_balance": str(opening),
        "transactions": transactions,
        "ending_balance": str(running),
        "source": "chart_journal_lines" if b.chart_account_id else "register_only",
    }
    if st_sid is not None:
        payload["filter_station_id"] = st_sid
    return JsonResponse(payload)
