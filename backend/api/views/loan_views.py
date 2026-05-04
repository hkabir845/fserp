"""Loans API: counterparties, loans, disbursements, repayments, schedule preview (company-scoped).

Islamic financing: when banking_model=islamic or product is islamic_facility / islamic_deal, APIs expose
is_islamic_financing and profit-oriented labels; GL postings use the same accounts with Islamic wording
in journal descriptions. Map COA lines to Shariah-compliant names in Chart of accounts.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import (
    ChartOfAccount,
    Loan,
    LoanCounterparty,
    LoanDisbursement,
    LoanInterestAccrual,
    LoanRepayment,
)
from api.services.loan_posting import (
    post_loan_disbursement,
    post_loan_interest_accrual,
    post_loan_repayment,
    reverse_loan_interest_accrual,
    reverse_loan_repayment,
)
from api.services.loan_interest_basis import (
    interest_basis_label,
    loan_interest_basis_key,
    simple_interest_for_days,
)
from api.services.loan_business_line import quarterly_interest_schedule_rows
from api.services.loan_islamic import loan_uses_islamic_terminology
from api.services.loan_schedule import amortized_schedule
from api.services.loan_counterparty_opening import (
    post_loan_counterparty_opening,
    resolve_default_loan_principal,
    resolve_opening_balance_equity,
)
from api.services.loan_counterparty_ledger import build_counterparty_ledger
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.services.invoice_station import parse_valid_station_id


def _ser_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _dec(v, default=Decimal("0")) -> Decimal:
    if v is None:
        return default
    try:
        return Decimal(str(v))
    except Exception:
        return default


_MAX_APR = Decimal("9999.9999")


def _parse_required_annual_interest_rate(ar_raw):
    """
    Annual interest % is required on create/update (use 0 for zero-interest).
    Returns Decimal quantized to 4 decimal places; raises ValueError for 400 responses.
    """
    if ar_raw is None:
        raise ValueError("annual_interest_rate is required (use 0 for zero-interest loans)")
    s = str(ar_raw).strip()
    if s == "":
        raise ValueError("annual_interest_rate is required (use 0 for zero-interest loans)")
    try:
        v = Decimal(s)
    except Exception:
        raise ValueError("annual_interest_rate must be a valid number")
    if v < Decimal("0"):
        raise ValueError("annual_interest_rate cannot be negative")
    if v > _MAX_APR:
        raise ValueError("annual_interest_rate exceeds maximum")
    return v.quantize(Decimal("0.0001"))


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


ALLOWED_BANKING = frozenset({Loan.BANKING_CONVENTIONAL, Loan.BANKING_ISLAMIC})
ALLOWED_PRODUCTS = frozenset(
    {
        Loan.PRODUCT_GENERAL,
        Loan.PRODUCT_TERM_LOAN,
        Loan.PRODUCT_BUSINESS_LINE,
        Loan.PRODUCT_ISLAMIC_FACILITY,
        Loan.PRODUCT_ISLAMIC_DEAL,
    }
)

ALLOWED_ISLAMIC_VARIANTS = frozenset(
    {
        Loan.ISLAMIC_VARIANT_MURABAHA,
        Loan.ISLAMIC_VARIANT_IJARA,
        Loan.ISLAMIC_VARIANT_MUDARABAH,
        Loan.ISLAMIC_VARIANT_MUSHARAKAH,
        Loan.ISLAMIC_VARIANT_ISTISNA,
        Loan.ISLAMIC_VARIANT_SALAM,
        Loan.ISLAMIC_VARIANT_OTHER,
    }
)


def _norm_islamic_variant(val) -> str:
    """Normalize islamic_contract_variant to an allowed value or empty string."""
    s = (val or "").strip().lower()[:24]
    return s if s in ALLOWED_ISLAMIC_VARIANTS else ""


def _norm_banking(val) -> str:
    s = (val or Loan.BANKING_CONVENTIONAL).strip().lower()
    return s if s in ALLOWED_BANKING else Loan.BANKING_CONVENTIONAL


def _norm_product(val) -> str:
    s = (val or Loan.PRODUCT_GENERAL).strip().lower()
    return s if s in ALLOWED_PRODUCTS else Loan.PRODUCT_GENERAL


ALLOWED_PARTY_KINDS = frozenset(
    {
        LoanCounterparty.PARTY_CUSTOMER,
        LoanCounterparty.PARTY_SUPPLIER,
        LoanCounterparty.PARTY_LENDER,
        LoanCounterparty.PARTY_BORROWER,
        LoanCounterparty.PARTY_BOTH,
        LoanCounterparty.PARTY_OTHER,
    }
)
ALLOWED_OPENING_TYPES = frozenset(
    {
        LoanCounterparty.OPENING_ZERO,
        LoanCounterparty.OPENING_RECEIVABLE,
        LoanCounterparty.OPENING_PAYABLE,
    }
)


def _norm_party_kind(val) -> str:
    s = (val or LoanCounterparty.PARTY_OTHER).strip().lower()[:20]
    return s if s in ALLOWED_PARTY_KINDS else LoanCounterparty.PARTY_OTHER


def _norm_opening_type(val) -> str:
    s = (val or LoanCounterparty.OPENING_ZERO).strip().lower()[:20]
    return s if s in ALLOWED_OPENING_TYPES else LoanCounterparty.OPENING_ZERO


def _parse_optional_annual_interest_rate(ar_raw):
    """None if absent; else Decimal 0.0000–_MAX_APR for opening metadata."""
    if ar_raw is None or str(ar_raw).strip() == "":
        return None
    v = _parse_required_annual_interest_rate(ar_raw)
    return v


def _facility_child_metrics(facility: Loan) -> tuple[Decimal, Decimal, int]:
    """(sum outstanding on deals, sum sanction on deals, deal count). Uses prefetch if present."""
    if facility.product_type != Loan.PRODUCT_ISLAMIC_FACILITY:
        return Decimal("0"), Decimal("0"), 0
    children = list(facility.child_loans.all())
    used = sum((c.outstanding_principal or Decimal("0")) for c in children)
    committed = sum((c.sanction_amount or Decimal("0")) for c in children)
    return used, committed, len(children)


def _facility_committed_sum(facility: Loan) -> Decimal:
    agg = facility.child_loans.aggregate(t=Sum("sanction_amount"))
    return agg["t"] or Decimal("0")


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _statement_kind_label(kind: str, islamic: bool) -> str:
    if islamic:
        return {
            "disbursement": "Financing disbursement",
            "repayment": "Payment (principal & profit)",
            "repayment_reversal": "Payment reversal",
            "interest_accrual": "Profit accrual",
            "interest_accrual_reversal": "Profit accrual reversal",
        }.get(kind, kind.replace("_", " ").title())
    return {
        "disbursement": "Disbursement",
        "repayment": "Repayment",
        "repayment_reversal": "Repayment reversal",
        "interest_accrual": "Interest accrual",
        "interest_accrual_reversal": "Accrual reversal",
    }.get(kind, kind.replace("_", " ").title())


def _counterparty_name_taken(cid: int, name: str, exclude_id: int | None = None) -> bool:
    """Case-insensitive duplicate name check within company."""
    n = (name or "").strip()
    if not n:
        return False
    q = LoanCounterparty.objects.filter(company_id=cid, name__iexact=n)
    if exclude_id is not None:
        q = q.exclude(pk=exclude_id)
    return q.exists()


def _counterparty_opening_principal_meta(c: LoanCounterparty) -> dict:
    """Code/name/type of the principal GL (1160/2410 by default) for opening; list views should select_related the FK."""
    if not c.opening_principal_account_id:
        return {
            "opening_principal_account_code": None,
            "opening_principal_account_name": None,
            "opening_principal_account_type": None,
        }
    acc = getattr(c, "opening_principal_account", None)
    if acc is None:
        acc = (
            ChartOfAccount.objects.filter(
                id=c.opening_principal_account_id, company_id=c.company_id
            )
            .only("account_code", "account_name", "account_type")
            .first()
        )
    if acc is None:
        return {
            "opening_principal_account_code": None,
            "opening_principal_account_name": None,
            "opening_principal_account_type": None,
        }
    return {
        "opening_principal_account_code": acc.account_code,
        "opening_principal_account_name": acc.account_name,
        "opening_principal_account_type": acc.account_type,
    }


def _counterparty_json(c: LoanCounterparty):
    oar = c.opening_annual_interest_rate
    ob_t = c.opening_balance_type or LoanCounterparty.OPENING_ZERO
    base = {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "role_type": c.role_type,
        "party_kind": c.party_kind or LoanCounterparty.PARTY_OTHER,
        "employee_id": c.employee_id,
        "customer_id": c.customer_id,
        "vendor_id": c.vendor_id,
        "phone": c.phone or "",
        "email": c.email or "",
        "address": c.address or "",
        "tax_id": c.tax_id or "",
        "notes": c.notes or "",
        "is_active": c.is_active,
        "opening_balance_type": ob_t,
        "opening_balance": str(c.opening_balance or Decimal("0")),
        "opening_balance_as_of": _ser_date(c.opening_balance_as_of),
        "opening_interest_applicable": bool(c.opening_interest_applicable),
        "opening_annual_interest_rate": (str(oar) if oar is not None else None),
        "opening_principal_account_id": c.opening_principal_account_id,
        "opening_equity_account_id": c.opening_equity_account_id,
        "opening_balance_journal_id": c.opening_balance_journal_id,
        "default_lent_principal_account_id": c.opening_principal_account_id
        if ob_t == LoanCounterparty.OPENING_RECEIVABLE
        else None,
        "default_borrowed_principal_account_id": c.opening_principal_account_id
        if ob_t == LoanCounterparty.OPENING_PAYABLE
        else None,
    }
    return {**base, **_counterparty_opening_principal_meta(c)}


def _loan_json(lo: Loan):
    parent_id = lo.parent_loan_id
    parent_no = ""
    if parent_id:
        pl = getattr(lo, "parent_loan", None)
        if pl is not None:
            parent_no = pl.loan_no or ""
    out = {
        "id": lo.id,
        "loan_no": lo.loan_no,
        "direction": lo.direction,
        "status": lo.status,
        "counterparty_id": lo.counterparty_id,
        "title": lo.title or "",
        "agreement_no": lo.agreement_no or "",
        "principal_account_id": lo.principal_account_id,
        "settlement_account_id": lo.settlement_account_id,
        "interest_account_id": lo.interest_account_id,
        "interest_accrual_account_id": lo.interest_accrual_account_id,
        "islamic_contract_variant": lo.islamic_contract_variant or "",
        "sanction_amount": str(lo.sanction_amount),
        "outstanding_principal": str(lo.outstanding_principal),
        "total_disbursed": str(lo.total_disbursed),
        "total_repaid_principal": str(lo.total_repaid_principal),
        "start_date": _ser_date(lo.start_date),
        "maturity_date": _ser_date(lo.maturity_date),
        "annual_interest_rate": str(lo.annual_interest_rate),
        "term_months": lo.term_months,
        "notes": lo.notes or "",
        "created_at": _ser_date(lo.created_at),
        "banking_model": lo.banking_model or Loan.BANKING_CONVENTIONAL,
        "product_type": lo.product_type or Loan.PRODUCT_GENERAL,
        "parent_loan_id": parent_id,
        "parent_loan_no": parent_no,
        "deal_reference": lo.deal_reference or "",
        "is_islamic_financing": loan_uses_islamic_terminology(lo),
        "station_id": lo.station_id,
        "station_name": (getattr(getattr(lo, "station", None), "station_name", None) or "") or "",
    }
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        used, committed, n_deals = _facility_child_metrics(lo)
        lim = lo.sanction_amount or Decimal("0")
        avail = lim - committed
        if avail < Decimal("0"):
            avail = Decimal("0")
        out["facility_outstanding_on_deals"] = str(used)
        out["facility_committed_by_deals"] = str(committed)
        out["facility_available_limit"] = str(avail)
        out["facility_deal_count"] = n_deals
    cp = getattr(lo, "counterparty", None)
    out["counterparty_role_type"] = (cp.role_type if cp else "") or ""
    ib = loan_interest_basis_key(lo)
    out["interest_basis"] = ib
    out["interest_basis_label"] = interest_basis_label(ib)
    return out


def _coa_belongs(cid: int, aid) -> bool:
    if aid is None or aid == "":
        return False
    if isinstance(aid, bool):
        return False
    try:
        i = int(aid)
    except (TypeError, ValueError):
        return False
    if i <= 0:
        return False
    return ChartOfAccount.objects.filter(
        id=i, company_id=cid, is_active=True
    ).exists()


def _parse_required_positive_int(val, field: str) -> int:
    """Parse a required FK id from JSON; raises ValueError with a safe client message."""
    if val is None or val == "":
        raise ValueError(f"{field} is required")
    if isinstance(val, bool):
        raise ValueError(f"Invalid {field}")
    try:
        n = int(val)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {field}")
    if n <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return n


def _parse_optional_positive_int(val, field: str) -> int | None:
    """Parse optional FK id; None if absent; raises ValueError if present but invalid."""
    if val is None or val == "":
        return None
    if isinstance(val, bool):
        raise ValueError(f"Invalid {field}")
    try:
        n = int(val)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {field}")
    if n <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return n


def _opening_fields_snapshot(c: LoanCounterparty) -> dict:
    oar = c.opening_annual_interest_rate
    return {
        "opening_balance_type": c.opening_balance_type,
        "opening_balance": str(c.opening_balance or 0),
        "opening_balance_as_of": _ser_date(c.opening_balance_as_of),
        "opening_interest_applicable": c.opening_interest_applicable,
        "opening_annual_interest_rate": str(oar) if oar is not None else None,
        "opening_principal_account_id": c.opening_principal_account_id,
        "opening_equity_account_id": c.opening_equity_account_id,
        "post_opening_to_gl": True,
    }


def _counterparty_opening_from_body(cid, body) -> tuple[dict, bool, JsonResponse | None]:
    """Return (field dict for create/update, post_to_gl, error)."""
    ob_type = _norm_opening_type(body.get("opening_balance_type"))
    ob_amt = _dec(body.get("opening_balance"))
    as_of = _parse_date(body.get("opening_balance_as_of"))
    int_app = bool(body.get("opening_interest_applicable", False))
    post_gl = bool(body.get("post_opening_to_gl", True))

    oar = None
    ar_raw = body.get("opening_annual_interest_rate")
    if int_app:
        try:
            oar = _parse_required_annual_interest_rate(ar_raw)
        except ValueError as e:
            return {}, True, JsonResponse({"detail": str(e)}, status=400)
    elif ar_raw is not None and str(ar_raw).strip() != "":
        oar = _parse_optional_annual_interest_rate(ar_raw)

    out: dict = {
        "opening_balance_type": ob_type,
        "opening_balance": ob_amt,
        "opening_balance_as_of": as_of,
        "opening_interest_applicable": int_app,
        "opening_annual_interest_rate": oar,
    }

    if ob_type == LoanCounterparty.OPENING_ZERO or ob_amt <= Decimal("0.005"):
        out["opening_balance_type"] = LoanCounterparty.OPENING_ZERO
        out["opening_balance"] = Decimal("0")
        out["opening_balance_as_of"] = None
        out["opening_interest_applicable"] = False
        out["opening_annual_interest_rate"] = None
        out["opening_principal_account_id"] = None
        out["opening_equity_account_id"] = None
        return out, post_gl, None

    if not as_of:
        return {}, True, JsonResponse(
            {"detail": "opening_balance_as_of is required for a non-zero opening balance"}, status=400
        )

    if ob_type not in (LoanCounterparty.OPENING_RECEIVABLE, LoanCounterparty.OPENING_PAYABLE):
        return {}, True, JsonResponse(
            {"detail": "opening_balance_type must be receivable, payable, or zero"},
            status=400,
        )

    need_recv = ob_type == LoanCounterparty.OPENING_RECEIVABLE
    pa = body.get("opening_principal_account_id")
    if pa in (None, "", 0, "0"):
        dflt = resolve_default_loan_principal(cid, need_recv)
        if not dflt:
            return {}, True, JsonResponse(
                {
                    "detail": (
                        "Set opening_principal_account_id or add built-in lines 1160 (lent) / 2410 (borrowed) "
                        "in Chart of accounts."
                    )
                },
                status=400,
            )
        out["opening_principal_account_id"] = dflt.id
    else:
        try:
            p_id = int(pa)
        except (TypeError, ValueError):
            return {}, True, JsonResponse({"detail": "Invalid opening_principal_account_id"}, status=400)
        if not _coa_belongs(cid, p_id):
            return {}, True, JsonResponse({"detail": "Invalid opening_principal_account_id"}, status=400)
        out["opening_principal_account_id"] = p_id

    oeq = body.get("opening_equity_account_id")
    if oeq in (None, "", 0, "0"):
        out["opening_equity_account_id"] = None
        if post_gl and not resolve_opening_balance_equity(cid):
            return {}, True, JsonResponse(
                {
                    "detail": (
                        "Add account 3200 Opening Balance Equity, pass opening_equity_account_id, "
                        "or set post_opening_to_gl to false to save without posting."
                    )
                },
                status=400,
            )
    else:
        try:
            oeq_id = int(oeq)
        except (TypeError, ValueError):
            return {}, True, JsonResponse({"detail": "Invalid opening_equity_account_id"}, status=400)
        if not _coa_belongs(cid, oeq_id):
            return {}, True, JsonResponse({"detail": "Invalid opening_equity_account_id"}, status=400)
        out["opening_equity_account_id"] = oeq_id

    return out, post_gl, None


@csrf_exempt
@auth_required
@require_company_id
def loan_counterparties_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = (
            LoanCounterparty.objects.filter(company_id=cid)
            .select_related("opening_principal_account", "opening_equity_account")
            .order_by("code", "id")
        )
        return JsonResponse([_counterparty_json(c) for c in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = (body.get("name") or "").strip()[:200]
        if not name:
            return JsonResponse({"detail": "name required"}, status=400)
        if _counterparty_name_taken(cid, name):
            return JsonResponse(
                {"detail": "A counterparty with this name already exists for this company"},
                status=400,
            )
        ob_fields, post_gl, ob_err = _counterparty_opening_from_body(cid, body)
        if ob_err is not None:
            return ob_err
        code_in = (body.get("code") or "").strip()[:32]
        if code_in and LoanCounterparty.objects.filter(company_id=cid, code=code_in).exists():
            return JsonResponse({"detail": "code already exists"}, status=400)
        try:
            with transaction.atomic():
                if code_in:
                    c = LoanCounterparty.objects.create(
                        company_id=cid,
                        code=code_in,
                        name=name,
                        role_type=(body.get("role_type") or "other").strip()[:32] or "other",
                        party_kind=_norm_party_kind(body.get("party_kind")),
                        employee_id=body.get("employee_id") or None,
                        customer_id=body.get("customer_id") or None,
                        vendor_id=body.get("vendor_id") or None,
                        phone=(body.get("phone") or "")[:40],
                        email=(body.get("email") or "")[:150],
                        address=body.get("address") or "",
                        tax_id=(body.get("tax_id") or "")[:80],
                        notes=body.get("notes") or "",
                        is_active=bool(body.get("is_active", True)),
                        **ob_fields,
                    )
                else:
                    temp_code = f"TMP-{uuid.uuid4().hex}"[:32]
                    c = LoanCounterparty.objects.create(
                        company_id=cid,
                        code=temp_code,
                        name=name,
                        role_type=(body.get("role_type") or "other").strip()[:32] or "other",
                        party_kind=_norm_party_kind(body.get("party_kind")),
                        employee_id=body.get("employee_id") or None,
                        customer_id=body.get("customer_id") or None,
                        vendor_id=body.get("vendor_id") or None,
                        phone=(body.get("phone") or "")[:40],
                        email=(body.get("email") or "")[:150],
                        address=body.get("address") or "",
                        tax_id=(body.get("tax_id") or "")[:80],
                        notes=body.get("notes") or "",
                        is_active=bool(body.get("is_active", True)),
                        **ob_fields,
                    )
                    base = f"CP-{c.id:05d}"
                    candidate = base
                    suffix = 0
                    while LoanCounterparty.objects.filter(company_id=cid, code=candidate).exclude(
                        pk=c.pk
                    ).exists():
                        suffix += 1
                        candidate = f"{base}-{suffix}"[:32]
                    c.code = candidate
                    c.save(update_fields=["code"])
                c.refresh_from_db()
                if not post_loan_counterparty_opening(cid, c, post_to_gl=post_gl):
                    raise ValidationError(
                        "Could not post opening balance to the general ledger. "
                        "Check principal and equity lines, or save with post_opening_to_gl false."
                    )
        except ValidationError as e:
            return JsonResponse(
                {"detail": e.messages[0] if getattr(e, "messages", None) else str(e)},
                status=400,
            )
        c = LoanCounterparty.objects.select_related(
            "opening_principal_account", "opening_equity_account"
        ).get(pk=c.pk)
        return JsonResponse(_counterparty_json(c), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def loan_counterparty_detail(request, counterparty_id: int):
    cid = request.company_id
    c = (
        LoanCounterparty.objects.filter(id=counterparty_id, company_id=cid)
        .select_related("opening_principal_account", "opening_equity_account")
        .first()
    )
    if not c:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_counterparty_json(c))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        opening_lock_keys = frozenset(
            {
                "opening_balance_type",
                "opening_balance",
                "opening_balance_as_of",
                "opening_interest_applicable",
                "opening_annual_interest_rate",
                "opening_principal_account_id",
                "opening_equity_account_id",
                "post_opening_to_gl",
            }
        )
        if c.opening_balance_journal_id and any(k in body for k in opening_lock_keys):
            return JsonResponse(
                {
                    "detail": "Opening balance is posted to the general ledger; it cannot be changed in this form.",
                },
                status=400,
            )
        if "name" in body:
            new_name = (body.get("name") or c.name).strip()[:200]
            if not new_name:
                return JsonResponse({"detail": "name cannot be empty"}, status=400)
            if _counterparty_name_taken(cid, new_name, exclude_id=c.id):
                return JsonResponse(
                    {"detail": "A counterparty with this name already exists for this company"},
                    status=400,
                )
            c.name = new_name
        if "role_type" in body:
            c.role_type = (body.get("role_type") or c.role_type).strip()[:32]
        if "party_kind" in body:
            c.party_kind = _norm_party_kind(body.get("party_kind"))
        for fld in ("phone", "email", "address", "notes", "tax_id"):
            if fld in body:
                setattr(c, fld, body.get(fld) or "")
        for fk in ("employee_id", "customer_id", "vendor_id"):
            if fk in body:
                setattr(c, fk, body.get(fk) or None)
        if "is_active" in body:
            c.is_active = bool(body.get("is_active"))
        if not c.opening_balance_journal_id and any(k in body for k in opening_lock_keys):
            sub = {k: body[k] for k in body if k in opening_lock_keys}
            merged = {**_opening_fields_snapshot(c), **sub}
            ob_fields, post_gl, ob_err = _counterparty_opening_from_body(cid, merged)
            if ob_err is not None:
                return ob_err
            for k, v in ob_fields.items():
                setattr(c, k, v)
            try:
                with transaction.atomic():
                    c.save()
                    c.refresh_from_db()
                    if not post_loan_counterparty_opening(cid, c, post_to_gl=post_gl):
                        raise ValidationError(
                            "Could not post opening to the general ledger. "
                            "Check accounts or set post_opening_to_gl to false."
                        )
            except ValidationError as e:
                return JsonResponse(
                    {
                        "detail": e.messages[0]
                        if getattr(e, "messages", None)
                        else str(e)
                    },
                    status=400,
                )
        else:
            c.save()
        c.refresh_from_db()
        c = (
            LoanCounterparty.objects.filter(pk=c.pk, company_id=cid)
            .select_related("opening_principal_account", "opening_equity_account")
            .first()
        )
        if not c:
            return JsonResponse({"detail": "Not found"}, status=404)
        return JsonResponse(_counterparty_json(c))
    if request.method == "DELETE":
        if c.opening_balance_journal_id:
            return JsonResponse(
                {
                    "detail": "This counterparty has a posted opening balance. Remove or reverse the journal in GL first.",
                },
                status=400,
            )
        if Loan.objects.filter(counterparty=c).exists():
            return JsonResponse({"detail": "Counterparty has loans"}, status=400)
        c.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def loan_counterparty_ledger(request, counterparty_id: int):
    """Chronological opening + all loan activity for this party (receivable / payable running totals)."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    c = (
        LoanCounterparty.objects.filter(id=counterparty_id, company_id=cid)
        .select_related("opening_balance_journal", "opening_principal_account", "opening_equity_account")
        .first()
    )
    if not c:
        return JsonResponse({"detail": "Not found"}, status=404)
    return JsonResponse(build_counterparty_ledger(c))


@csrf_exempt
@auth_required
@require_company_id
def loans_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = (
            Loan.objects.filter(company_id=cid)
            .select_related("counterparty", "parent_loan", "station")
            .prefetch_related("child_loans")
            .order_by("-created_at", "-id")
        )
        return JsonResponse([_loan_json(x) for x in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        direction = (body.get("direction") or "").strip().lower()
        if direction not in (Loan.DIRECTION_BORROWED, Loan.DIRECTION_LENT):
            return JsonResponse({"detail": "direction must be borrowed or lent"}, status=400)
        try:
            cp_id = _parse_required_positive_int(body.get("counterparty_id"), "counterparty_id")
            pa = _parse_required_positive_int(body.get("principal_account_id"), "principal_account_id")
            sa = _parse_required_positive_int(body.get("settlement_account_id"), "settlement_account_id")
            ia = _parse_optional_positive_int(body.get("interest_account_id"), "interest_account_id")
            iaa = _parse_optional_positive_int(
                body.get("interest_accrual_account_id"), "interest_accrual_account_id"
            )
        except ValueError as e:
            return JsonResponse({"detail": str(e)}, status=400)
        if not LoanCounterparty.objects.filter(id=cp_id, company_id=cid, is_active=True).exists():
            return JsonResponse({"detail": "Valid counterparty_id required"}, status=400)
        if not _coa_belongs(cid, pa) or not _coa_belongs(cid, sa):
            return JsonResponse(
                {"detail": "principal_account_id and settlement_account_id must be active COA in company"},
                status=400,
            )
        if ia is not None and not _coa_belongs(cid, ia):
            return JsonResponse({"detail": "Invalid interest_account_id"}, status=400)
        if iaa is not None and not _coa_belongs(cid, iaa):
            return JsonResponse({"detail": "Invalid interest_accrual_account_id"}, status=400)
        icv = _norm_islamic_variant(body.get("islamic_contract_variant"))
        try:
            ar_val = _parse_required_annual_interest_rate(body.get("annual_interest_rate"))
        except ValueError as e:
            return JsonResponse({"detail": str(e)}, status=400)
        tm = body.get("term_months")
        try:
            tm = max(0, min(600, int(tm))) if tm is not None and tm != "" else None
        except (TypeError, ValueError):
            tm = None
        pt = _norm_product(body.get("product_type"))
        bm_raw = body.get("banking_model")
        if pt in (Loan.PRODUCT_ISLAMIC_FACILITY, Loan.PRODUCT_ISLAMIC_DEAL) and bm_raw in (
            None,
            "",
        ):
            bm = Loan.BANKING_ISLAMIC
        else:
            bm = _norm_banking(bm_raw)
        deal_ref = (body.get("deal_reference") or "").strip()[:64]
        parent_obj = None
        if pt == Loan.PRODUCT_ISLAMIC_DEAL:
            try:
                pid = _parse_required_positive_int(body.get("parent_loan_id"), "parent_loan_id")
            except ValueError as e:
                return JsonResponse({"detail": str(e)}, status=400)
            parent_obj = Loan.objects.filter(id=pid, company_id=cid).first()
            if not parent_obj or parent_obj.product_type != Loan.PRODUCT_ISLAMIC_FACILITY:
                return JsonResponse({"detail": "Islamic deal requires parent facility loan"}, status=400)
            if parent_obj.direction != direction:
                return JsonResponse({"detail": "Deal direction must match facility"}, status=400)
            committed = (
                parent_obj.child_loans.aggregate(t=Sum("sanction_amount"))["t"] or Decimal("0")
            )
            new_sanction = _dec(body.get("sanction_amount"))
            lim_p = parent_obj.sanction_amount or Decimal("0")
            if committed + new_sanction > lim_p + Decimal("0.01"):
                return JsonResponse(
                    {"detail": "Total deal sanctions would exceed Islamic facility limit"},
                    status=400,
                )
        elif body.get("parent_loan_id"):
            return JsonResponse({"detail": "parent_loan_id only allowed for Islamic deal"}, status=400)

        stn_id = None
        if "station_id" in body or "station" in body:
            raw_s = body.get("station_id", body.get("station"))
            if raw_s not in (None, "", 0, "0"):
                pv = parse_valid_station_id(cid, raw_s)
                if pv is None:
                    return JsonResponse(
                        {"detail": "Unknown, inactive, or invalid station_id for this company."},
                        status=400,
                    )
                stn_id = pv

        # Stable unique placeholder, then permanent code from DB id (avoids count-based races/gaps).
        temp_no = f"TMP-{uuid.uuid4().hex}"[:64]
        with transaction.atomic():
            lo = Loan.objects.create(
                company_id=cid,
                loan_no=temp_no,
                direction=direction,
                status=(body.get("status") or "draft").strip()[:24] or "draft",
                counterparty_id=cp_id,
                station_id=stn_id,
                title=(body.get("title") or "")[:200],
                agreement_no=(body.get("agreement_no") or "")[:120],
                principal_account_id=pa,
                settlement_account_id=sa,
                interest_account_id=ia,
                interest_accrual_account_id=iaa,
                islamic_contract_variant=icv,
                sanction_amount=_dec(body.get("sanction_amount")),
                outstanding_principal=Decimal("0"),
                start_date=_parse_date(body.get("start_date")),
                maturity_date=_parse_date(body.get("maturity_date")),
                annual_interest_rate=ar_val,
                term_months=tm,
                notes=body.get("notes") or "",
                banking_model=bm,
                product_type=pt,
                parent_loan=parent_obj,
                deal_reference=deal_ref,
            )
            base = f"LN-{lo.id:05d}"
            candidate = base
            suffix = 0
            while Loan.objects.filter(company_id=cid, loan_no=candidate).exclude(pk=lo.pk).exists():
                suffix += 1
                candidate = f"{base}-{suffix}"[:64]
            lo.loan_no = candidate
            extra_save = ["loan_no"]
            if pt == Loan.PRODUCT_ISLAMIC_DEAL and not (lo.deal_reference or "").strip():
                lo.deal_reference = f"DEAL-{lo.id:06d}"[:64]
                extra_save.append("deal_reference")
            lo.save(update_fields=extra_save)
        return JsonResponse(_loan_json(lo), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def loan_detail(request, loan_id: int):
    cid = request.company_id
    lo = (
        Loan.objects.filter(id=loan_id, company_id=cid)
        .select_related("parent_loan", "station")
        .prefetch_related("child_loans")
        .first()
    )
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        out = _loan_json(lo)
        out["disbursements"] = [
            {
                "id": d.id,
                "disbursement_date": _ser_date(d.disbursement_date),
                "amount": str(d.amount),
                "reference": d.reference,
                "journal_entry_id": d.journal_entry_id,
            }
            for d in lo.disbursements.all().order_by("disbursement_date", "id")
        ]
        out["repayments"] = [
            {
                "id": r.id,
                "repayment_date": _ser_date(r.repayment_date),
                "amount": str(r.amount),
                "principal_amount": str(r.principal_amount),
                "interest_amount": str(r.interest_amount),
                "journal_entry_id": r.journal_entry_id,
                "reversed_at": r.reversed_at.isoformat() if r.reversed_at else None,
                "reversal_journal_entry_id": r.reversal_journal_entry_id,
            }
            for r in lo.repayments.all().order_by("repayment_date", "id")
        ]
        out["interest_accruals"] = [
            {
                "id": a.id,
                "accrual_date": _ser_date(a.accrual_date),
                "amount": str(a.amount),
                "days_basis": a.days_basis,
                "memo": (a.memo or "")[:500],
                "journal_entry_id": a.journal_entry_id,
                "reversed_at": a.reversed_at.isoformat() if a.reversed_at else None,
                "reversal_journal_entry_id": a.reversal_journal_entry_id,
            }
            for a in lo.interest_accruals.all().order_by("-accrual_date", "-id")
        ]
        return JsonResponse(out)
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if lo.status == "closed":
            # Closing a loan is only a status flag — no GL is posted. Allow reopening and
            # cosmetic updates without touching principal/interest structure.
            allowed_keys = {"status", "title", "notes", "maturity_date", "station_id", "station"}
            if not set(body.keys()) <= allowed_keys:
                return JsonResponse(
                    {
                        "detail": (
                            "This loan is closed. You may only update: status (set active or draft to reopen), "
                            "title, notes, maturity_date. Save that first; then edit other fields if needed."
                        )
                    },
                    status=400,
                )
            if "title" in body:
                lo.title = (body.get("title") or "")[:200]
            if "notes" in body:
                lo.notes = body.get("notes") or ""
            if "maturity_date" in body:
                lo.maturity_date = _parse_date(body.get("maturity_date"))
            if "status" in body:
                new_st = (body.get("status") or lo.status).strip()[:24]
                if new_st not in ("draft", "active", "closed"):
                    return JsonResponse({"detail": "status must be draft, active, or closed"}, status=400)
                lo.status = new_st
            if "station_id" in body or "station" in body:
                raw_s = body.get("station_id", body.get("station"))
                if raw_s in (None, "", 0, "0"):
                    lo.station_id = None
                else:
                    pv = parse_valid_station_id(cid, raw_s)
                    if pv is None:
                        return JsonResponse(
                            {"detail": "Unknown, inactive, or invalid station_id for this company."},
                            status=400,
                        )
                    lo.station_id = pv
            lo.save()
            return JsonResponse(_loan_json(lo))
        has_activity = (
            lo.disbursements.exists()
            or lo.repayments.exists()
            or lo.interest_accruals.filter(journal_entry_id__isnull=False).exists()
        )
        if has_activity:
            structural = {
                "direction",
                "counterparty_id",
                "principal_account_id",
                "settlement_account_id",
                "interest_account_id",
                "interest_accrual_account_id",
                "islamic_contract_variant",
                "sanction_amount",
                "agreement_no",
                "start_date",
                "annual_interest_rate",
                "term_months",
                "banking_model",
                "product_type",
                "parent_loan_id",
                "deal_reference",
            }
            bad = structural & body.keys()
            if bad:
                return JsonResponse(
                    {
                        "detail": (
                            "Cannot change direction, accounts, sanction, or schedule after disbursements "
                            "or repayments exist: "
                            + ", ".join(sorted(bad))
                        )
                    },
                    status=400,
                )
        else:
            if "direction" in body:
                d = (body.get("direction") or "").strip().lower()
                if d not in (Loan.DIRECTION_BORROWED, Loan.DIRECTION_LENT):
                    return JsonResponse({"detail": "direction must be borrowed or lent"}, status=400)
                lo.direction = d
            if "counterparty_id" in body:
                try:
                    cp_id = _parse_required_positive_int(body.get("counterparty_id"), "counterparty_id")
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
                if not LoanCounterparty.objects.filter(id=cp_id, company_id=cid, is_active=True).exists():
                    return JsonResponse({"detail": "Valid counterparty_id required"}, status=400)
                lo.counterparty_id = cp_id
            if "principal_account_id" in body:
                try:
                    pa = _parse_required_positive_int(body.get("principal_account_id"), "principal_account_id")
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
                if not _coa_belongs(cid, pa):
                    return JsonResponse({"detail": "Invalid principal_account_id"}, status=400)
                lo.principal_account_id = pa
            if "settlement_account_id" in body:
                try:
                    sa = _parse_required_positive_int(body.get("settlement_account_id"), "settlement_account_id")
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
                if not _coa_belongs(cid, sa):
                    return JsonResponse({"detail": "Invalid settlement_account_id"}, status=400)
                lo.settlement_account_id = sa
            if "interest_account_id" in body:
                ia = body.get("interest_account_id")
                if ia in (None, "", 0, "0"):
                    lo.interest_account_id = None
                else:
                    try:
                        ia_n = _parse_required_positive_int(ia, "interest_account_id")
                    except ValueError as e:
                        return JsonResponse({"detail": str(e)}, status=400)
                    if not _coa_belongs(cid, ia_n):
                        return JsonResponse({"detail": "Invalid interest_account_id"}, status=400)
                    lo.interest_account_id = ia_n
            if "interest_accrual_account_id" in body:
                iaa = body.get("interest_accrual_account_id")
                if iaa in (None, "", 0, "0"):
                    lo.interest_accrual_account_id = None
                else:
                    try:
                        iaa_n = _parse_required_positive_int(iaa, "interest_accrual_account_id")
                    except ValueError as e:
                        return JsonResponse({"detail": str(e)}, status=400)
                    if not _coa_belongs(cid, iaa_n):
                        return JsonResponse({"detail": "Invalid interest_accrual_account_id"}, status=400)
                    lo.interest_accrual_account_id = iaa_n
            if "islamic_contract_variant" in body:
                lo.islamic_contract_variant = _norm_islamic_variant(body.get("islamic_contract_variant"))
            if "sanction_amount" in body:
                lo.sanction_amount = _dec(body.get("sanction_amount"))
            if "agreement_no" in body:
                lo.agreement_no = (body.get("agreement_no") or "")[:120]
            if "start_date" in body:
                lo.start_date = _parse_date(body.get("start_date"))
            if "annual_interest_rate" in body:
                try:
                    lo.annual_interest_rate = _parse_required_annual_interest_rate(
                        body.get("annual_interest_rate")
                    )
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
            if "term_months" in body:
                tm = body.get("term_months")
                try:
                    lo.term_months = max(0, min(600, int(tm))) if tm not in (None, "") else None
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "Invalid term_months"}, status=400)
            if "banking_model" in body:
                lo.banking_model = _norm_banking(body.get("banking_model"))
            if "product_type" in body:
                new_pt = _norm_product(body.get("product_type"))
                if lo.child_loans.exists() and new_pt != Loan.PRODUCT_ISLAMIC_FACILITY:
                    return JsonResponse(
                        {"detail": "Cannot change product_type while deals exist under this facility"},
                        status=400,
                    )
                lo.product_type = new_pt
            if "deal_reference" in body:
                lo.deal_reference = (body.get("deal_reference") or "").strip()[:64]
            if "parent_loan_id" in body:
                pid = body.get("parent_loan_id")
                if pid in (None, "", 0, "0"):
                    if lo.product_type == Loan.PRODUCT_ISLAMIC_DEAL:
                        return JsonResponse(
                            {"detail": "Islamic deal must keep parent_loan_id"}, status=400
                        )
                    lo.parent_loan_id = None
                else:
                    try:
                        pid_int = _parse_required_positive_int(pid, "parent_loan_id")
                    except ValueError as e:
                        return JsonResponse({"detail": str(e)}, status=400)
                    parent_obj = Loan.objects.filter(id=pid_int, company_id=cid).first()
                    if not parent_obj or parent_obj.product_type != Loan.PRODUCT_ISLAMIC_FACILITY:
                        return JsonResponse({"detail": "parent must be Islamic facility"}, status=400)
                    if parent_obj.direction != lo.direction:
                        return JsonResponse({"detail": "Deal direction must match facility"}, status=400)
                    lo.parent_loan = parent_obj
                    lo.product_type = Loan.PRODUCT_ISLAMIC_DEAL
            if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY and "sanction_amount" in body:
                new_san = _dec(body.get("sanction_amount"))
                committed = _facility_committed_sum(lo)
                if new_san + Decimal("0.01") < committed:
                    return JsonResponse(
                        {"detail": "Sanction cannot be less than sum of deal sanctions"},
                        status=400,
                    )
            if lo.product_type == Loan.PRODUCT_ISLAMIC_DEAL and "sanction_amount" in body:
                pl = lo.parent_loan
                if not pl:
                    return JsonResponse({"detail": "Islamic deal has no parent facility"}, status=400)
                new_san = _dec(body.get("sanction_amount"))
                others = (
                    pl.child_loans.exclude(pk=lo.pk).aggregate(t=Sum("sanction_amount"))["t"]
                    or Decimal("0")
                )
                lim_p = pl.sanction_amount or Decimal("0")
                if others + new_san > lim_p + Decimal("0.01"):
                    return JsonResponse(
                        {"detail": "Deal sanctions would exceed facility limit"}, status=400
                    )
        if "title" in body:
            lo.title = (body.get("title") or "")[:200]
        if "status" in body:
            lo.status = (body.get("status") or lo.status).strip()[:24]
        if "notes" in body:
            lo.notes = body.get("notes") or ""
        if "maturity_date" in body:
            lo.maturity_date = _parse_date(body.get("maturity_date"))
        if lo.product_type == Loan.PRODUCT_ISLAMIC_DEAL and not lo.parent_loan_id:
            return JsonResponse(
                {"detail": "Islamic deal requires a parent facility (parent_loan_id)"},
                status=400,
            )
        if lo.product_type != Loan.PRODUCT_ISLAMIC_DEAL and lo.parent_loan_id:
            return JsonResponse(
                {"detail": "parent_loan_id is only valid for Islamic deal rows"},
                status=400,
            )
        if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY and lo.parent_loan_id:
            return JsonResponse(
                {"detail": "Islamic facility cannot have a parent loan"},
                status=400,
            )
        if "station_id" in body or "station" in body:
            raw_s = body.get("station_id", body.get("station"))
            if raw_s in (None, "", 0, "0"):
                lo.station_id = None
            else:
                pv = parse_valid_station_id(cid, raw_s)
                if pv is None:
                    return JsonResponse(
                        {"detail": "Unknown, inactive, or invalid station_id for this company."},
                        status=400,
                    )
                lo.station_id = pv
        lo.save()
        return JsonResponse(_loan_json(lo))
    if request.method == "DELETE":
        if lo.child_loans.exists():
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete an Islamic facility while deal rows exist. "
                        "Remove or reassign deals first."
                    )
                },
                status=400,
            )
        if LoanInterestAccrual.objects.filter(loan=lo, journal_entry_id__isnull=False).exists():
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete a loan that has posted interest accruals "
                        "(reverse accruals in the journal layer or keep the loan for audit)."
                    )
                },
                status=400,
            )
        if lo.disbursements.exists() or lo.repayments.exists():
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete a loan that has disbursements or repayments "
                        "(general ledger history must stay intact). "
                        "You may only delete a loan that was never funded or repaid."
                    )
                },
                status=400,
            )
        lo.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def loan_disburse(request, loan_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = Loan.objects.filter(id=loan_id, company_id=cid).first()
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        return JsonResponse(
            {
                "detail": (
                    "Post disbursements on Islamic deal rows only, not on the facility header."
                )
            },
            status=400,
        )
    if lo.status not in ("draft", "active"):
        return JsonResponse({"detail": "Invalid loan status for disbursement"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    amt = _dec(body.get("amount"))
    if amt <= 0:
        return JsonResponse({"detail": "positive amount required"}, status=400)
    if lo.sanction_amount and lo.total_disbursed + amt > lo.sanction_amount + Decimal("0.01"):
        return JsonResponse({"detail": "Exceeds sanction amount"}, status=400)
    post_gl = bool(body.get("post_to_gl", True))
    d_date = _parse_date(body.get("disbursement_date")) or timezone.localdate()
    try:
        with transaction.atomic():
            d = LoanDisbursement.objects.create(
                loan=lo,
                disbursement_date=d_date,
                amount=amt,
                reference=(body.get("reference") or "")[:200],
                memo=body.get("memo") or "",
            )
            if post_gl and not post_loan_disbursement(cid, d):
                raise ValidationError("GL posting failed; check settlement/principal accounts")
            Loan.objects.filter(pk=lo.pk).update(
                total_disbursed=lo.total_disbursed + amt,
                outstanding_principal=lo.outstanding_principal + amt,
                status="active",
            )
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    d.refresh_from_db()
    lo.refresh_from_db()
    return JsonResponse(
        {
            "loan": _loan_json(lo),
            "disbursement_id": d.id,
            "journal_entry_id": d.journal_entry_id,
        },
        status=201,
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_repay(request, loan_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = Loan.objects.filter(id=loan_id, company_id=cid).first()
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        return JsonResponse(
            {
                "detail": (
                    "Post repayments on Islamic deal rows only, not on the facility header."
                )
            },
            status=400,
        )
    if lo.status != "active":
        return JsonResponse({"detail": "Loan must be active"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    total = _dec(body.get("amount"))
    p = _dec(body.get("principal_amount"))
    i = _dec(body.get("interest_amount"))
    if total <= 0:
        return JsonResponse({"detail": "positive amount required"}, status=400)
    if (p + i - total).copy_abs() > Decimal("0.02"):
        return JsonResponse({"detail": "principal_amount + interest_amount must equal amount"}, status=400)
    if p > lo.outstanding_principal + Decimal("0.01"):
        return JsonResponse({"detail": "principal exceeds outstanding"}, status=400)
    post_gl = bool(body.get("post_to_gl", True))
    r_date = _parse_date(body.get("repayment_date")) or timezone.localdate()
    try:
        with transaction.atomic():
            r = LoanRepayment.objects.create(
                loan=lo,
                repayment_date=r_date,
                amount=total,
                principal_amount=p,
                interest_amount=i,
                reference=(body.get("reference") or "")[:200],
                memo=body.get("memo") or "",
            )
            if post_gl and not post_loan_repayment(cid, r):
                raise ValidationError("GL posting failed; check accounts and amounts")
            new_out = lo.outstanding_principal - p
            new_rp = lo.total_repaid_principal + p
            st = "closed" if new_out <= Decimal("0.005") else "active"
            Loan.objects.filter(pk=lo.pk).update(
                outstanding_principal=max(new_out, Decimal("0")),
                total_repaid_principal=new_rp,
                status=st,
            )
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    r.refresh_from_db()
    lo.refresh_from_db()
    return JsonResponse(
        {
            "loan": _loan_json(lo),
            "repayment_id": r.id,
            "journal_entry_id": r.journal_entry_id,
        },
        status=201,
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_accrue_interest(request, loan_id: int):
    """POST accrual: body amount OR days (+ annual rate on loan); posts Dr exp / Cr accrued (borrowed)."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = (
        Loan.objects.filter(id=loan_id, company_id=cid)
        .select_related("counterparty")
        .first()
    )
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        return JsonResponse({"detail": "Not applicable to facility header"}, status=400)
    if lo.status != "active":
        return JsonResponse({"detail": "Loan must be active"}, status=400)
    if not lo.interest_account_id or not lo.interest_accrual_account_id:
        return JsonResponse(
            {
                "detail": (
                    "Set interest_account_id and interest_accrual_account_id on the loan "
                    "(profit-and-loss interest line plus balance-sheet accrued payable or receivable)."
                )
            },
            status=400,
        )
    body, err = parse_json_body(request)
    if err:
        return err
    post_gl = bool(body.get("post_to_gl", True))
    accrual_date = _parse_date(body.get("accrual_date")) or timezone.localdate()
    out = lo.outstanding_principal or Decimal("0")
    days_basis = None
    if body.get("amount") not in (None, ""):
        amt = _dec(body.get("amount"))
    else:
        if _dec(lo.annual_interest_rate) <= Decimal("0"):
            return JsonResponse(
                {
                    "detail": (
                        "For zero-interest loans, provide an explicit accrual amount, or set a positive "
                        "annual_interest_rate to compute from days."
                    )
                },
                status=400,
            )
        if out <= Decimal("0"):
            return JsonResponse({"detail": "No outstanding principal to accrue on"}, status=400)
        try:
            days = body.get("days")
            days = max(1, min(3660, int(days))) if days not in (None, "") else 30
        except (TypeError, ValueError):
            days = 30
        rate = _dec(lo.annual_interest_rate)
        basis = loan_interest_basis_key(lo)
        amt = simple_interest_for_days(out, rate, days, basis)
        days_basis = days
    if amt <= Decimal("0.005"):
        return JsonResponse({"detail": "Accrual amount must be positive"}, status=400)
    memo = (body.get("memo") or "")[:500]
    try:
        with transaction.atomic():
            accrual = LoanInterestAccrual.objects.create(
                loan=lo,
                accrual_date=accrual_date,
                amount=amt,
                days_basis=days_basis,
                memo=memo,
            )
            if post_gl and not post_loan_interest_accrual(cid, accrual):
                raise ValidationError("GL posting failed; check interest and accrual GL accounts")
        accrual.refresh_from_db()
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse(
        {
            "accrual": {
                "id": accrual.id,
                "accrual_date": _ser_date(accrual.accrual_date),
                "amount": str(accrual.amount),
                "days_basis": accrual.days_basis,
                "journal_entry_id": accrual.journal_entry_id,
            },
            "loan": _loan_json(lo),
        },
        status=201,
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_accrual_reverse(request, loan_id: int, accrual_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = Loan.objects.filter(id=loan_id, company_id=cid).first()
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    accrual = LoanInterestAccrual.objects.filter(id=accrual_id, loan_id=lo.id).first()
    if not accrual:
        return JsonResponse({"detail": "Accrual not found"}, status=404)
    if accrual.reversed_at:
        return JsonResponse({"detail": "Already reversed"}, status=400)
    if not accrual.journal_entry_id:
        return JsonResponse({"detail": "Nothing to reverse (accrual was not posted to GL)"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    post_gl = bool(body.get("post_to_gl", True))
    rev_date = _parse_date(body.get("reversal_date")) or timezone.localdate()
    if post_gl and not reverse_loan_interest_accrual(cid, accrual, rev_date):
        return JsonResponse({"detail": "Reversal GL posting failed"}, status=400)
    accrual.refresh_from_db()
    return JsonResponse(
        {
            "accrual": {
                "id": accrual.id,
                "reversed_at": accrual.reversed_at.isoformat() if accrual.reversed_at else None,
                "reversal_journal_entry_id": accrual.reversal_journal_entry_id,
            },
            "loan": _loan_json(lo),
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_repayment_reverse(request, loan_id: int, repayment_id: int):
    """POST reversing journal + restore outstanding / total_repaid_principal."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = Loan.objects.filter(id=loan_id, company_id=cid).first()
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    r = LoanRepayment.objects.filter(id=repayment_id, loan_id=lo.id).first()
    if not r:
        return JsonResponse({"detail": "Repayment not found"}, status=404)
    if r.reversed_at:
        return JsonResponse({"detail": "Already reversed"}, status=400)
    if not r.journal_entry_id:
        return JsonResponse(
            {"detail": "Nothing to reverse (repayment was not posted to GL)"},
            status=400,
        )
    body, err = parse_json_body(request)
    if err:
        return err
    rev_date = _parse_date(body.get("reversal_date")) or timezone.localdate()
    if not reverse_loan_repayment(cid, r, rev_date):
        return JsonResponse({"detail": "Reversal GL posting failed"}, status=400)
    lo.refresh_from_db()
    r.refresh_from_db()
    return JsonResponse(
        {
            "repayment": {
                "id": r.id,
                "reversed_at": r.reversed_at.isoformat() if r.reversed_at else None,
                "reversal_journal_entry_id": r.reversal_journal_entry_id,
            },
            "loan": _loan_json(lo),
        }
    )


def _schedule_sheet_context(lo: Loan) -> dict:
    """Labels for payment schedule export/UI: company pays (borrowed) vs collects (lent)."""
    lent = (lo.direction or Loan.DIRECTION_BORROWED) == Loan.DIRECTION_LENT
    return {
        "direction": lo.direction or Loan.DIRECTION_BORROWED,
        "role": "receivable" if lent else "payable",
    }


@csrf_exempt
@auth_required
@require_company_id
def loan_schedule_remaining(request, loan_id: int):
    """
    Remaining amortization from current outstanding balance.
    Remaining periods default to (term_months - count of repayments with principal) — user may override via
    ?remaining_months= for re-amortization after extra principal paydowns.
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = (
        Loan.objects.filter(id=loan_id, company_id=cid)
        .select_related("counterparty")
        .first()
    )
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        return JsonResponse({"detail": "Not applicable to Islamic facility headers"}, status=400)
    outstanding = lo.outstanding_principal or Decimal("0")
    sch_islamic = loan_uses_islamic_terminology(lo)
    islamic_sched_note = (
        " Islamic financing: same schedule mathematics as conventional for planning; split principal vs profit/return "
        "per your Shariah contract and COA naming."
        if sch_islamic
        else ""
    )
    if outstanding <= Decimal("0"):
        return JsonResponse(
            {
                "loan_id": lo.id,
                "loan_no": lo.loan_no,
                "outstanding_principal": str(outstanding),
                "remaining_periods": 0,
                "schedule": [],
                "suggested_next": None,
                "note": "No outstanding principal.",
                "financing_terminology": "islamic" if sch_islamic else "conventional",
                "schedule_sheet": _schedule_sheet_context(lo),
            }
        )
    basis_key = loan_interest_basis_key(lo)
    rate_dec = _dec(lo.annual_interest_rate)

    # --- Business line: quarterly interest on utilised balance (no monthly EMI table) ---
    if lo.product_type == Loan.PRODUCT_BUSINESS_LINE:
        rq = request.GET.get("remaining_quarters")
        try:
            num_q = max(1, min(40, int(rq))) if rq is not None and str(rq).strip() != "" else None
        except (TypeError, ValueError):
            num_q = None
        if num_q is None:
            tm = lo.term_months
            if tm is not None and int(tm) >= 3:
                num_q = max(4, min(40, (int(tm) + 2) // 3))
            else:
                num_q = 8
        as_of = timezone.localdate()
        rows = quarterly_interest_schedule_rows(outstanding, rate_dec, basis_key, as_of, num_q)
        schedule_model = "business_line_quarterly_interest"
        suggested = None
        if rows:
            x0 = rows[0]
            suggested = {
                "period": x0["period"],
                "payment": x0["payment"],
                "principal": x0["principal"],
                "interest": x0["interest"],
            }
        basis_note = interest_basis_label(basis_key)
        if basis_key == "zero":
            method_core = (
                "Business line / revolving limit: quarterly interest instalments are zero at this rate. "
                "Principal is repaid separately (draws and repayments on the line)."
            )
            method_extra = ""
        else:
            method_core = (
                "Business line / revolving limit: quarterly interest-only schedule on current utilised balance "
                f"({num_q} calendar quarters from {as_of.isoformat()}). Each row uses actual calendar days in that "
                "quarter with your day-count basis (bank/finance: actual/365; others: 30/360). "
                "Many banks accrue daily on each day's balance and sum to the quarter; if the drawn balance changes "
                "during the quarter, use accruals from actual days or adjust the repayment amount."
            )
            method_extra = " Override preview length with ?remaining_quarters= (1–40)."
        return JsonResponse(
            {
                "loan_id": lo.id,
                "loan_no": lo.loan_no,
                "product_type": lo.product_type or Loan.PRODUCT_GENERAL,
                "outstanding_principal": str(outstanding),
                "annual_rate_percent": str(rate_dec),
                "interest_basis": basis_key,
                "interest_basis_label": basis_note,
                "schedule_model": schedule_model,
                "interest_payment_frequency": "quarterly",
                "financing_terminology": "islamic" if sch_islamic else "conventional",
                "remaining_periods": num_q,
                "remaining_period_unit": "quarters",
                "repayments_with_principal_count": 0,
                "method_note": method_core + method_extra + islamic_sched_note,
                "schedule": rows,
                "suggested_next": suggested,
                "schedule_sheet": _schedule_sheet_context(lo),
            }
        )

    if lo.term_months is None or int(lo.term_months) < 1:
        return JsonResponse(
            {"detail": "Set term_months on the loan to build a remaining amortization schedule."},
            status=400,
        )
    n_paid = (
        lo.repayments.filter(principal_amount__gt=Decimal("0.005"), reversed_at__isnull=True)
        .count()
    )
    term = int(lo.term_months)
    remaining = max(1, min(term - n_paid, 600))
    rem_override = request.GET.get("remaining_months")
    if rem_override is not None and str(rem_override).strip() != "":
        try:
            remaining = max(1, min(600, int(rem_override)))
        except (TypeError, ValueError):
            pass
    rows = amortized_schedule(outstanding, rate_dec, remaining, 12)
    schedule_model = "principal_only" if basis_key == "zero" else "reducing_balance_emi"
    suggested = None
    if rows:
        x0 = rows[0]
        suggested = {
            "period": x0["period"],
            "payment": str(x0["payment"]),
            "principal": str(x0["principal"]),
            "interest": str(x0["interest"]),
        }
    basis_note = interest_basis_label(basis_key)
    if basis_key == "zero":
        method_core = (
            "Equal monthly principal on current balance; remaining months estimated as term minus repayments that "
            "included principal. Override with ?remaining_months= if you prepaid or restructured."
        )
        method_extra = " Zero annual rate: no interest component."
    else:
        method_core = (
            "Reducing-balance EMI (aligned with typical bank term-loan calculators): one fixed monthly instalment; "
            "each month interest = outstanding × (annual% ÷ 12), principal = instalment − interest. "
            "Remaining months default to term minus repayments that included principal; override with ?remaining_months=."
        )
        if basis_key == "annual_act_365":
            method_extra = (
                " Bank/finance counterparty: simple-interest hints and accruals-from-days use actual/365; "
                "the amortization table still uses monthly compounding of the quoted annual rate on the declining balance."
            )
        else:
            method_extra = (
                " Non-bank counterparty: simple-interest hints and accruals-from-days use 30/360; "
                "EMI table uses annual÷12 on the declining balance."
            )
    return JsonResponse(
        {
            "loan_id": lo.id,
            "loan_no": lo.loan_no,
            "product_type": lo.product_type or Loan.PRODUCT_GENERAL,
            "outstanding_principal": str(outstanding),
            "annual_rate_percent": str(rate_dec),
            "interest_basis": basis_key,
            "interest_basis_label": basis_note,
            "interest_payment_frequency": "monthly",
            "financing_terminology": "islamic" if sch_islamic else "conventional",
            "schedule_model": schedule_model,
            "remaining_periods": remaining,
            "remaining_period_unit": "months",
            "repayments_with_principal_count": n_paid,
            "method_note": method_core + method_extra + islamic_sched_note,
            "schedule": [
                {
                    "period": x["period"],
                    "payment": str(x["payment"]),
                    "principal": str(x["principal"]),
                    "interest": str(x["interest"]),
                    "closing_balance": str(x["closing_balance"]),
                }
                for x in rows
            ],
            "suggested_next": suggested,
            "schedule_sheet": _schedule_sheet_context(lo),
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_statement(request, loan_id: int):
    """Chronological disbursements, repayments, accruals (principal balance + interest activity)."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = (
        Loan.objects.filter(id=loan_id, company_id=cid)
        .select_related("counterparty")
        .first()
    )
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    stmt_islamic = loan_uses_islamic_terminology(lo)
    d_events = [
        {
            "kind": "disbursement",
            "sort_key": (d.disbursement_date, 0, d.id, 0),
            "obj": d,
        }
        for d in lo.disbursements.all()
    ]
    r_events = []
    for r in lo.repayments.select_related("reversal_journal_entry").order_by(
        "repayment_date", "id"
    ):
        r_events.append(
            {
                "kind": "repayment",
                "sort_key": (r.repayment_date, 1, r.id, 0),
                "obj": r,
            }
        )
        if r.reversal_journal_entry_id:
            rje = r.reversal_journal_entry
            rdate = rje.entry_date if rje else r.repayment_date
            r_events.append(
                {
                    "kind": "repayment_reversal",
                    "sort_key": (rdate, 1, r.id, 1),
                    "obj": r,
                }
            )
    ac_events = []
    for a in lo.interest_accruals.select_related("reversal_journal_entry").order_by(
        "accrual_date", "id"
    ):
        ac_events.append(
            {
                "kind": "interest_accrual",
                "sort_key": (a.accrual_date, 2, a.id, 0),
                "obj": a,
            }
        )
        if a.reversal_journal_entry_id:
            rje = a.reversal_journal_entry
            rdate = rje.entry_date if rje else a.accrual_date
            ac_events.append(
                {
                    "kind": "interest_accrual_reversal",
                    "sort_key": (rdate, 2, a.id, 1),
                    "obj": a,
                }
            )
    merged = sorted(d_events + r_events + ac_events, key=lambda x: x["sort_key"])
    bal = Decimal("0")
    lines = []
    for e in merged:
        if e["kind"] == "disbursement":
            d = e["obj"]
            amt = d.amount or Decimal("0")
            bal = _q2(bal + amt)
            lines.append(
                {
                    "date": _ser_date(d.disbursement_date),
                    "kind": "disbursement",
                    "kind_label": _statement_kind_label("disbursement", stmt_islamic),
                    "reference": d.reference or "",
                    "memo": (d.memo or "")[:200],
                    "disbursement": str(amt),
                    "repayment_total": "",
                    "principal": "",
                    "interest": "",
                    "outstanding_principal_after": str(bal),
                    "journal_entry_id": d.journal_entry_id,
                }
            )
        elif e["kind"] == "repayment":
            r = e["obj"]
            p = r.principal_amount or Decimal("0")
            iamt = r.interest_amount or Decimal("0")
            tot = r.amount or _q2(p + iamt)
            bal = _q2(bal - p)
            lines.append(
                {
                    "date": _ser_date(r.repayment_date),
                    "kind": "repayment",
                    "kind_label": _statement_kind_label("repayment", stmt_islamic),
                    "reference": r.reference or "",
                    "memo": (r.memo or "")[:200],
                    "disbursement": "",
                    "repayment_total": str(tot),
                    "principal": str(p),
                    "interest": str(iamt),
                    "outstanding_principal_after": str(max(bal, Decimal("0"))),
                    "journal_entry_id": r.journal_entry_id,
                }
            )
        elif e["kind"] == "repayment_reversal":
            r = e["obj"]
            p = r.principal_amount or Decimal("0")
            iamt = r.interest_amount or Decimal("0")
            tot = r.amount or _q2(p + iamt)
            bal = _q2(bal + p)
            rev = r.reversal_journal_entry
            rev_date = rev.entry_date if rev else r.repayment_date
            lines.append(
                {
                    "date": _ser_date(rev_date),
                    "kind": "repayment_reversal",
                    "kind_label": _statement_kind_label("repayment_reversal", stmt_islamic),
                    "reference": r.reference or "",
                    "memo": f"Reversal of repayment #{r.id}"[:200],
                    "disbursement": "",
                    "repayment_total": str(-tot),
                    "principal": str(-p),
                    "interest": str(-iamt),
                    "outstanding_principal_after": str(max(bal, Decimal("0"))),
                    "journal_entry_id": r.reversal_journal_entry_id,
                }
            )
        elif e["kind"] == "interest_accrual":
            a = e["obj"]
            amt = a.amount or Decimal("0")
            lines.append(
                {
                    "date": _ser_date(a.accrual_date),
                    "kind": "interest_accrual",
                    "kind_label": _statement_kind_label("interest_accrual", stmt_islamic),
                    "reference": "",
                    "memo": (a.memo or "")[:200],
                    "disbursement": "",
                    "repayment_total": "",
                    "principal": "",
                    "interest": str(amt),
                    "outstanding_principal_after": str(max(bal, Decimal("0"))),
                    "journal_entry_id": a.journal_entry_id,
                }
            )
        else:
            a = e["obj"]
            amt = a.amount or Decimal("0")
            lines.append(
                {
                    "date": _ser_date(
                        a.reversal_journal_entry.entry_date
                        if a.reversal_journal_entry_id
                        else a.accrual_date
                    ),
                    "kind": "interest_accrual_reversal",
                    "kind_label": _statement_kind_label("interest_accrual_reversal", stmt_islamic),
                    "reference": "",
                    "memo": f"Reversal of accrual #{a.id}"[:200],
                    "disbursement": "",
                    "repayment_total": "",
                    "principal": "",
                    "interest": str(-amt),
                    "outstanding_principal_after": str(max(bal, Decimal("0"))),
                    "journal_entry_id": a.reversal_journal_entry_id,
                }
            )
    stmt_ib = loan_interest_basis_key(lo)
    return JsonResponse(
        {
            "loan": {
                "id": lo.id,
                "loan_no": lo.loan_no,
                "direction": lo.direction,
                "status": lo.status,
                "product_type": lo.product_type or Loan.PRODUCT_GENERAL,
                "banking_model": lo.banking_model or Loan.BANKING_CONVENTIONAL,
                "is_islamic_financing": stmt_islamic,
                "islamic_contract_variant": lo.islamic_contract_variant or "",
                "counterparty_name": lo.counterparty.name if lo.counterparty_id else "",
                "sanction_amount": str(lo.sanction_amount),
                "outstanding_principal": str(lo.outstanding_principal),
                "total_disbursed": str(lo.total_disbursed),
                "total_repaid_principal": str(lo.total_repaid_principal),
                "interest_basis": stmt_ib,
                "interest_basis_label": interest_basis_label(stmt_ib),
            },
            "financing_terminology": "islamic" if stmt_islamic else "conventional",
            "statement_note": (
                "Islamic financing: use Chart of accounts names that match your Shariah policy (e.g. profit expense, "
                "cost of funding). Posting lines mirror conventional loans; wording here is for clarity only."
                if stmt_islamic
                else ""
            ),
            "lines": lines,
            "as_of": _ser_date(timezone.localdate()),
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_interest_hint(request, loan_id: int):
    """
    Simple interest on current outstanding for a period (indicative only — does not post journals).
    GET ?days=30 or ?from=YYYY-MM-DD&to=YYYY-MM-DD
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    lo = (
        Loan.objects.filter(id=loan_id, company_id=cid)
        .select_related("counterparty")
        .first()
    )
    if not lo:
        return JsonResponse({"detail": "Not found"}, status=404)
    if lo.product_type == Loan.PRODUCT_ISLAMIC_FACILITY:
        return JsonResponse({"detail": "Not applicable to Islamic facility headers"}, status=400)
    hint_islamic = loan_uses_islamic_terminology(lo)
    basis_key = loan_interest_basis_key(lo)
    if basis_key == "zero":
        days_param = request.GET.get("days")
        dfrom = _parse_date(request.GET.get("from"))
        dto = _parse_date(request.GET.get("to"))
        if days_param is not None and str(days_param).strip() != "":
            try:
                days = max(1, min(3660, int(days_param)))
            except (TypeError, ValueError):
                days = 30
        elif dfrom and dto:
            if dto < dfrom:
                return JsonResponse({"detail": "to date must be on or after from date"}, status=400)
            days = (dto - dfrom).days + 1
            days = max(1, min(3660, days))
        else:
            days = 30
        out = lo.outstanding_principal or Decimal("0")
        return JsonResponse(
            {
                "loan_id": lo.id,
                "loan_no": lo.loan_no,
                "outstanding_principal": str(out),
                "annual_rate_percent": str(_dec(lo.annual_interest_rate)),
                "days": days,
                "simple_interest_estimate": "0.00",
                "interest_basis": basis_key,
                "interest_basis_label": interest_basis_label(basis_key),
                "financing_terminology": "islamic" if hint_islamic else "conventional",
                "note": (
                    "Quoted rate is 0%; profit/return estimate is 0 — use principal-only settlements."
                    if hint_islamic
                    else "Loan has 0% annual rate (zero-interest). Estimate is 0; use principal-only repayments."
                ),
            }
        )
    days_param = request.GET.get("days")
    dfrom = _parse_date(request.GET.get("from"))
    dto = _parse_date(request.GET.get("to"))
    if days_param is not None and str(days_param).strip() != "":
        try:
            days = max(1, min(3660, int(days_param)))
        except (TypeError, ValueError):
            days = 30
    elif dfrom and dto:
        if dto < dfrom:
            return JsonResponse({"detail": "to date must be on or after from date"}, status=400)
        days = (dto - dfrom).days + 1
        days = max(1, min(3660, days))
    else:
        days = 30
    out = lo.outstanding_principal or Decimal("0")
    rate = _dec(lo.annual_interest_rate)
    est = simple_interest_for_days(out, rate, days, basis_key)
    return JsonResponse(
        {
            "loan_id": lo.id,
            "loan_no": lo.loan_no,
            "outstanding_principal": str(out),
            "annual_rate_percent": str(rate),
            "days": days,
            "simple_interest_estimate": str(est),
            "interest_basis": basis_key,
            "interest_basis_label": interest_basis_label(basis_key),
            "financing_terminology": "islamic" if hint_islamic else "conventional",
            "note": (
                "Indicative profit/return on current utilised balance for the period (same day-count as conventional "
                "hints); not an automatic accrual. Bank/finance: actual/365; others: 30/360. Enter in Repay as the "
                "profit portion (or your institution's figure)."
                if hint_islamic
                else (
                    "Indicative simple interest on current outstanding for the period; "
                    "not an automatic accrual. Bank/finance counterparties use actual/365; others use 30/360. "
                    "Enter this (or your bank figure) in Repay when paying interest."
                )
            ),
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def loan_schedule_preview(request):
    """GET ?principal=&rate=&months= — amortized monthly preview only."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    p = _dec(request.GET.get("principal"))
    if p < 0:
        return JsonResponse({"detail": "principal must be zero or positive"}, status=400)
    rate = _dec(request.GET.get("rate"))
    months = request.GET.get("months") or "12"
    try:
        n = max(1, min(600, int(months)))
    except ValueError:
        n = 12
    rows = amortized_schedule(p, rate, n, 12)
    return JsonResponse(
        {
            "principal": str(p),
            "annual_rate_percent": str(rate),
            "payments": n,
            "schedule": [
                {
                    "period": x["period"],
                    "payment": str(x["payment"]),
                    "principal": str(x["principal"]),
                    "interest": str(x["interest"]),
                    "closing_balance": str(x["closing_balance"]),
                }
                for x in rows
            ],
        }
    )
