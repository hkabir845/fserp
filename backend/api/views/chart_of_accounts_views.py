"""Chart of accounts API: list, create, get, update, delete, statement (company-scoped)."""
from datetime import date, datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum, Q, Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.services.coa_constants import CHART_ACCOUNT_TYPES, normalize_chart_account_type
from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import parse_json_body, require_company_id
from api.models import BankAccount, ChartOfAccount, FundTransfer, JournalEntryLine, Payment
from api.services.journal_statement import (
    build_statement_transactions,
    journal_net_movement,
    journal_net_movement_map,
)


class _CoaBankRegisterRejected(Exception):
    """Rollback chart create/update when bank_register payload is invalid."""

    def __init__(self, response: JsonResponse):
        self.response = response
        super().__init__()


def _coa_usage_annotate(qs):
    """Annotate journal / sub-account / bank link counts for delete rules and UI."""
    return qs.annotate(
        journal_line_count=Count("journal_lines", distinct=True),
        child_account_count=Count("children", distinct=True),
        bank_link_count=Count("bank_accounts", distinct=True),
    )


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _linked_banks_payload(a: ChartOfAccount) -> list:
    """Bank registers that post to this GL account (reverse FK)."""
    return [
        {
            "id": b.id,
            "account_name": b.account_name,
            "bank_name": b.bank_name,
            "account_number": b.account_number or "",
        }
        for b in a.bank_accounts.all().order_by("id")
    ]


def _bank_register_json(b: BankAccount, *, current_balance_display=None):
    """current_balance_display: GL-aligned balance when register links to this chart line (optional)."""
    bal = current_balance_display if current_balance_display is not None else b.current_balance
    return {
        "id": b.id,
        "bank_name": b.bank_name,
        "account_number": b.account_number or "",
        "register_type": b.account_type or "CHECKING",
        "current_balance": str(bal),
    }


def _primary_bank_register_json(a: ChartOfAccount, *, chart_current_balance=None):
    b = a.bank_accounts.order_by("id").first()
    if not b:
        return None
    return _bank_register_json(
        b, current_balance_display=chart_current_balance
    )


BANK_REGISTER_SUBTYPES = frozenset(
    {
        "checking",
        "savings",
        "cash_on_hand",
        "money_market",
        "cash_management",
        "other_bank_account",
    }
)


def coa_eligible_for_bank_register(account_type: str, account_sub_type: str) -> bool:
    t = (account_type or "").lower()
    st = (account_sub_type or "").lower()
    if t == "bank_account":
        return True
    if t == "asset" and st in BANK_REGISTER_SUBTYPES:
        return True
    return False


def _bank_registers_clear_blocked_reason(chart_account_id: int) -> str | None:
    for b in BankAccount.objects.filter(chart_account_id=chart_account_id):
        if Payment.objects.filter(bank_account_id=b.id).exists():
            return "A payment references this bank register."
        if FundTransfer.objects.filter(Q(from_bank_id=b.id) | Q(to_bank_id=b.id)).exists():
            return "A fund transfer references this bank register."
    return None


def _clear_bank_registers_if_allowed(chart_account_id: int) -> tuple[bool, str | None]:
    qs = BankAccount.objects.filter(chart_account_id=chart_account_id)
    if not qs.exists():
        return True, None
    reason = _bank_registers_clear_blocked_reason(chart_account_id)
    if reason:
        return False, reason
    qs.delete()
    return True, None


def _upsert_bank_register_for_coa(company_id: int, coa: ChartOfAccount, payload: dict) -> tuple[bool, str | None]:
    bank_name = (payload.get("bank_name") or "").strip()
    account_number = (payload.get("account_number") or "").strip()
    register_type = (
        (payload.get("register_type") or payload.get("account_type") or "CHECKING") or "CHECKING"
    ).strip().upper() or "CHECKING"
    if not bank_name or not account_number:
        return False, "bank_register requires bank_name and account_number"

    ob = coa.opening_balance if coa.opening_balance is not None else Decimal("0")
    obd = coa.opening_balance_date

    existing = BankAccount.objects.filter(chart_account_id=coa.id).order_by("id").first()
    if existing:
        existing.account_name = coa.account_name
        existing.bank_name = bank_name
        existing.account_number = account_number
        existing.account_type = register_type
        existing.opening_balance = ob
        existing.opening_balance_date = obd
        existing.is_active = coa.is_active
        existing.save(
            update_fields=[
                "account_name",
                "bank_name",
                "account_number",
                "account_type",
                "opening_balance",
                "opening_balance_date",
                "is_active",
                "updated_at",
            ]
        )
    else:
        BankAccount.objects.create(
            company_id=company_id,
            chart_account_id=coa.id,
            account_name=coa.account_name,
            bank_name=bank_name,
            account_number=account_number,
            account_type=register_type,
            opening_balance=ob,
            opening_balance_date=obd,
            current_balance=ob,
            is_active=coa.is_active,
        )
    return True, None


def _apply_bank_register_on_coa_save(request, coa: ChartOfAccount, body: dict) -> JsonResponse | None:
    """
    Handle body['bank_register']: null clears; dict upserts. Omitted = no change.
    Chart line must already be saved and reflect final account_type / account_sub_type.
    """
    if "bank_register" not in body:
        return None
    eligible = coa_eligible_for_bank_register(coa.account_type, coa.account_sub_type)
    br = body.get("bank_register")
    if br is None:
        if not eligible:
            return None
        ok, err = _clear_bank_registers_if_allowed(coa.id)
        if not ok:
            return JsonResponse({"detail": err or "Cannot clear bank register"}, status=400)
        return None
    if isinstance(br, dict):
        if not eligible:
            return JsonResponse(
                {"detail": "This account type does not support bank / cash register details."},
                status=400,
            )
        ok, err = _upsert_bank_register_for_coa(request.company_id, coa, br)
        if not ok:
            return JsonResponse({"detail": err or "Invalid bank_register"}, status=400)
        return None
    return JsonResponse({"detail": "bank_register must be an object or null"}, status=400)


def _account_to_json(a, *, journal_net=None, linked_banks=None):
    """journal_net: Sum(debit-credit) for this account; if None, runs one aggregate query."""
    jl = getattr(a, "journal_line_count", None)
    ch = getattr(a, "child_account_count", None)
    bk = getattr(a, "bank_link_count", None)
    usage = None
    can_delete = None
    if jl is not None and ch is not None and bk is not None:
        usage = {
            "journal_lines": jl,
            "sub_accounts": ch,
            "bank_links": bk,
        }
        can_delete = jl == 0 and ch == 0 and bk == 0
    ob = a.opening_balance if a.opening_balance is not None else Decimal("0")
    jn = journal_net_movement(a.id) if journal_net is None else journal_net
    current = (ob + jn).quantize(Decimal("0.01"))
    out = {
        "id": a.id,
        "account_code": a.account_code,
        "account_name": a.account_name,
        "account_type": a.account_type,
        "account_sub_type": a.account_sub_type or "",
        "description": a.description or "",
        "parent_account_id": a.parent_id,
        "opening_balance": str(ob),
        "opening_balance_date": _serialize_date(a.opening_balance_date),
        "current_balance": str(current),
        "is_active": a.is_active,
        **({"usage": usage, "can_delete": can_delete} if usage is not None else {}),
    }
    if linked_banks is not None:
        out["linked_banks"] = linked_banks
    out["bank_register"] = _primary_bank_register_json(a, chart_current_balance=current)
    return out


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


def _validated_account_type(body: dict, *, fallback: str) -> tuple[str | None, JsonResponse | None]:
    """Return normalized account_type or (None, 400 response)."""
    raw = body.get("account_type")
    if raw is None:
        s = fallback
    else:
        s = str(raw).strip()
        if not s:
            s = fallback
    at = normalize_chart_account_type(s, default=fallback)
    if at not in CHART_ACCOUNT_TYPES:
        return None, JsonResponse(
            {
                "detail": (
                    f"Invalid account_type '{raw}'. "
                    f"Use one of: {', '.join(sorted(CHART_ACCOUNT_TYPES))}."
                )
            },
            status=400,
        )
    return at, None


@csrf_exempt
@auth_required
@require_company_id
def chart_of_accounts_list_or_create(request):
    if request.method == "GET":
        qs = _coa_usage_annotate(
            ChartOfAccount.objects.filter(company_id=request.company_id)
        ).prefetch_related("bank_accounts").order_by("account_code")
        accounts = list(qs)
        nets = journal_net_movement_map(a.id for a in accounts)
        return JsonResponse(
            [
                _account_to_json(
                    a,
                    journal_net=nets.get(a.id, Decimal("0")),
                    linked_banks=_linked_banks_payload(a),
                )
                for a in accounts
            ],
            safe=False,
        )

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        code = (body.get("account_code") or "").strip()
        name = (body.get("account_name") or "").strip()
        if not code or not name:
            return JsonResponse({"detail": "account_code and account_name are required"}, status=400)
        if ChartOfAccount.objects.filter(company_id=request.company_id, account_code=code).exists():
            return JsonResponse({"detail": "Account code already exists"}, status=400)
        parent_id = body.get("parent_account_id")
        if parent_id and not ChartOfAccount.objects.filter(id=parent_id, company_id=request.company_id).exists():
            parent_id = None
        at, verr = _validated_account_type(body, fallback="asset")
        if verr:
            return verr
        try:
            with transaction.atomic():
                a = ChartOfAccount(
                    company_id=request.company_id,
                    account_code=code,
                    account_name=name,
                    account_type=at,
                    account_sub_type=body.get("account_sub_type") or "",
                    description=body.get("description") or "",
                    parent_id=parent_id,
                    opening_balance=_decimal(body.get("opening_balance")),
                    opening_balance_date=_parse_date(body.get("opening_balance_date")),
                    is_active=body.get("is_active", True),
                )
                a.save()
                bank_err = _apply_bank_register_on_coa_save(request, a, body)
                if bank_err:
                    raise _CoaBankRegisterRejected(bank_err)
        except _CoaBankRegisterRejected as e:
            return e.response

        a = _coa_usage_annotate(
            ChartOfAccount.objects.filter(id=a.id, company_id=request.company_id)
        ).prefetch_related("bank_accounts").first()
        return JsonResponse(
            _account_to_json(a, journal_net=Decimal("0"), linked_banks=_linked_banks_payload(a)),
            status=201,
        )

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def chart_of_account_detail(request, account_id: int):
    a = (
        _coa_usage_annotate(
            ChartOfAccount.objects.filter(id=account_id, company_id=request.company_id)
        )
        .prefetch_related("bank_accounts")
        .first()
    )
    if not a:
        return JsonResponse({"detail": "Account not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_account_to_json(a, linked_banks=_linked_banks_payload(a)))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err

        nt = a.account_type
        ns = a.account_sub_type or ""
        if "account_type" in body:
            ntn, verr = _validated_account_type(
                {**body, "account_type": body.get("account_type")},
                fallback=nt or "asset",
            )
            if verr:
                return verr
            nt = ntn or nt
        if "account_sub_type" in body:
            ns = body.get("account_sub_type") or ""

        if not coa_eligible_for_bank_register(nt, ns) and BankAccount.objects.filter(
            chart_account_id=a.id
        ).exists():
            blocked = _bank_registers_clear_blocked_reason(a.id)
            if blocked:
                return JsonResponse(
                    {
                        "detail": f"Cannot change this account to the selected type: {blocked} "
                        "Remove or reassign those transactions first."
                    },
                    status=400,
                )

        try:
            with transaction.atomic():
                if body.get("account_code"):
                    a.account_code = (body["account_code"] or "").strip() or a.account_code
                if body.get("account_name"):
                    a.account_name = (body["account_name"] or "").strip() or a.account_name
                if "account_type" in body:
                    a.account_type = nt
                if "account_sub_type" in body:
                    a.account_sub_type = body.get("account_sub_type") or ""
                if "description" in body:
                    a.description = body.get("description") or ""
                if "parent_account_id" in body:
                    pid = body.get("parent_account_id")
                    a.parent_id = (
                        pid
                        if pid
                        and ChartOfAccount.objects.filter(
                            id=pid, company_id=request.company_id
                        ).exists()
                        else None
                    )
                if "opening_balance" in body:
                    a.opening_balance = _decimal(body.get("opening_balance"), a.opening_balance)
                if "opening_balance_date" in body:
                    a.opening_balance_date = _parse_date(body.get("opening_balance_date"))
                if "is_active" in body:
                    a.is_active = bool(body["is_active"])
                a.save()

                if not coa_eligible_for_bank_register(a.account_type, a.account_sub_type):
                    _clear_bank_registers_if_allowed(a.id)

                bank_err = _apply_bank_register_on_coa_save(request, a, body)
                if bank_err:
                    raise _CoaBankRegisterRejected(bank_err)
        except _CoaBankRegisterRejected as e:
            return e.response

        a = _coa_usage_annotate(
            ChartOfAccount.objects.filter(id=a.id, company_id=request.company_id)
        ).prefetch_related("bank_accounts").first()
        return JsonResponse(_account_to_json(a, linked_banks=_linked_banks_payload(a)))

    if request.method == "DELETE":
        jl = JournalEntryLine.objects.filter(account_id=a.id).count()
        ch = ChartOfAccount.objects.filter(parent_id=a.id, company_id=request.company_id).count()
        bk = BankAccount.objects.filter(chart_account_id=a.id, company_id=request.company_id).count()
        if jl or ch or bk:
            reasons = []
            if jl:
                reasons.append(f"{jl} journal line(s) reference this account")
            if ch:
                reasons.append(f"{ch} sub-account(s) are under this account")
            if bk:
                reasons.append(f"{bk} bank register(s) link to this account")
            return JsonResponse(
                {
                    "detail": "Cannot delete: " + "; ".join(reasons) + ". "
                    "Remove or reclassify those records first, or deactivate the account instead.",
                    "blocks": {"journal_lines": jl, "sub_accounts": ch, "bank_links": bk},
                },
                status=409,
            )
        a.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def chart_of_account_statement(request, account_id: int):
    a = ChartOfAccount.objects.filter(id=account_id, company_id=request.company_id).first()
    if not a:
        return JsonResponse({"detail": "Account not found"}, status=404)
    start_date = _parse_date(request.GET.get("start_date"))
    end_date = _parse_date(request.GET.get("end_date"))
    transactions, running = build_statement_transactions(
        a, start_date=start_date, end_date=end_date
    )
    return JsonResponse({
        "account": _account_to_json(a, linked_banks=_linked_banks_payload(a)),
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "transactions": transactions,
        "ending_balance": str(running),
    })


@csrf_exempt
@auth_required
@require_company_id
def chart_of_accounts_template_fuel_station(request):
    """GET metadata for the built-in fuel retail COA template (no DB writes).

    Query params:
      - include_rows: if 1/true/yes, include full account list with definitions for one profile.
      - profile: full | retail (default full) — used with include_rows.
    Always includes erp_automation_guide: account codes the posting engine expects.
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    from api.chart_templates.fuel_station import (
        ERP_AUTOMATION_ACCOUNT_GUIDE,
        FUEL_STATION_TEMPLATE_ID,
        FUEL_STATION_TEMPLATE_META,
        get_fuel_station_rows,
        profile_account_counts,
    )

    payload = dict(FUEL_STATION_TEMPLATE_META)
    payload["id"] = FUEL_STATION_TEMPLATE_ID
    payload["account_counts"] = profile_account_counts()
    payload["erp_automation_guide"] = list(ERP_AUTOMATION_ACCOUNT_GUIDE)

    flag = (request.GET.get("include_rows") or "").strip().lower()
    if flag in ("1", "true", "yes", "all"):
        profile = (request.GET.get("profile") or "full").strip().lower()
        if profile not in ("full", "retail"):
            return JsonResponse({"detail": "profile must be full or retail"}, status=400)
        rows = get_fuel_station_rows(profile)
        payload["profile"] = profile
        payload["rows"] = [
            {
                "account_code": r["account_code"],
                "account_name": r["account_name"],
                "account_type": r["account_type"],
                "account_sub_type": r.get("account_sub_type") or "",
                "description": r.get("description") or "",
                "profiles": list(r.get("profiles") or ()),
            }
            for r in rows
        ]
    return JsonResponse(payload)


@csrf_exempt
@auth_required
@require_company_id
def chart_of_accounts_seed_template(request):
    """POST { template_id, profile?, replace? } — import built-in COA for current company."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    template_id = (body.get("template_id") or "").strip()
    profile = (body.get("profile") or "full").strip().lower()
    replace = bool(body.get("replace", False))
    if template_id != "fuel_station_v1":
        return JsonResponse({"detail": "Unknown template_id. Use fuel_station_v1."}, status=400)
    if profile not in ("full", "retail"):
        return JsonResponse({"detail": "profile must be full or retail"}, status=400)
    from api.chart_templates.fuel_station import seed_fuel_station_chart

    result = seed_fuel_station_chart(request.company_id, profile=profile, replace=replace)
    return JsonResponse(result, status=200)


@csrf_exempt
@auth_required
@require_company_id
def chart_of_accounts_backfill_descriptions(request):
    """POST { only_blank?: bool } — copy built-in template descriptions onto existing accounts (same codes).

    Only updates rows whose description is empty unless only_blank is false (overwrite from template).
    """
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    api_user = getattr(request, "api_user", None) or get_user_from_request(request)
    raw = body.get("only_blank", True)
    if isinstance(raw, str):
        only_blank = raw.strip().lower() in ("1", "true", "yes", "")
    else:
        only_blank = bool(raw)
    if not only_blank and not (api_user and user_is_super_admin(api_user)):
        only_blank = True
    force_template = bool(body.get("force_template", False))
    if force_template and not (api_user and user_is_super_admin(api_user)):
        return JsonResponse({"detail": "force_template requires super admin"}, status=403)
    from api.chart_templates.fuel_station import backfill_company_coa_descriptions

    result = backfill_company_coa_descriptions(
        request.company_id,
        only_blank=only_blank,
        force_template=force_template,
    )
    return JsonResponse(result, status=200)
