"""Aquaculture: ponds, expenses, fish sales, biomass samples, P&L summary (company module)."""
from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone as django_timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.exceptions import GlPostingError, StockBusinessError
from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpensePondShare,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    ChartOfAccount,
    Company,
    Customer,
    JournalEntry,
    JournalEntryLine,
)
from api.views.journal_entries_views import _entry_to_json
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.gl_posting import post_aquaculture_fish_stock_ledger_journal
from api.services.aquaculture_pond_pos_customer import (
    maybe_provision_auto_pos_customer,
    on_pond_deleted,
    on_pond_pos_customer_cleared,
    on_pond_pos_customer_replaced,
    sync_auto_pos_customer_from_pond,
)
from api.services.aquaculture_sale_biomass_sync import sync_biomass_sample_from_fish_sale
from api.services.aquaculture_shop_stock import execute_aquaculture_shop_stock_issue
from api.services.aquaculture_constants import (
    AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
    AQUACULTURE_FISH_SPECIES_CHOICES,
    AQUACULTURE_INCOME_TYPE_CHOICES,
    AQUACULTURE_POND_ROLE_CHOICES,
    EXPENSE_CATEGORY_EXTRA_HELP,
    EXPENSE_CATEGORY_LABELS,
    INCOME_TYPE_LABELS,
    INTER_POND_FISH_TRANSFER_PL_NOTE,
    POND_ROLE_LABELS,
    STOCK_LEDGER_COA_NOTE,
    STOCK_LEDGER_ENTRY_KIND_CHOICES,
    STOCK_LEDGER_ENTRY_KIND_LABELS,
    STOCK_LEDGER_LOSS_REASON_CHOICES,
    STOCK_LEDGER_LOSS_REASON_LABELS,
    fish_species_display_label,
    NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
    normalize_expense_category,
    normalize_fish_species,
    normalize_fish_species_other,
    normalize_income_type,
    normalize_pond_role,
    normalize_stock_ledger_entry_kind,
    normalize_stock_ledger_loss_reason,
)
from api.services.permission_service import user_may_access_aquaculture_api
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id


def _decimal(val, default="0") -> Decimal:
    if val is None:
        return Decimal(default)
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal(default)


def _parse_date(val) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except (TypeError, ValueError):
        return None


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _contract_fractional_years(start: date, end: date) -> Decimal:
    """Year fraction using average year length (365.25 days), before rounding to whole years."""
    if not start or not end or end < start:
        return Decimal(0)
    days = (end - start).days
    if days <= 0:
        return Decimal(0)
    return (Decimal(days) / Decimal("365.25")).quantize(Decimal("0.0001"))


def _contract_years_rounded_int(start: date, end: date) -> int | None:
    """Whole contract length in years (half-up), for display and lease total."""
    if not start or not end or end < start:
        return None
    frac = _contract_fractional_years(start, end)
    if frac <= 0:
        return 0
    return int(frac.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _remaining_years_months(period_start: date, period_end: date) -> tuple[int, int]:
    """Whole years and months from period_start through period_end (end-inclusive style)."""
    if period_start > period_end:
        return 0, 0
    y1, m1, d1 = period_start.year, period_start.month, period_start.day
    y2, m2, d2 = period_end.year, period_end.month, period_end.day
    months = (y2 - y1) * 12 + (m2 - m1)
    if d2 < d1:
        months -= 1
    months = max(0, months)
    return divmod(months, 12)


def _apply_pond_lease_fields(p: AquaculturePond, body: dict) -> str | None:
    """Mutate pond lease-related fields from JSON body. Returns error message or None."""
    if "pond_size_decimal" in body:
        raw = body.get("pond_size_decimal")
        if raw in (None, ""):
            p.pond_size_decimal = None
        else:
            p.pond_size_decimal = _decimal(raw)
            if p.pond_size_decimal < 0:
                return "pond_size_decimal cannot be negative"
    if "lease_contract_start" in body:
        if body.get("lease_contract_start") in (None, ""):
            p.lease_contract_start = None
        else:
            sd = _parse_date(body.get("lease_contract_start"))
            if not sd:
                return "lease_contract_start must be YYYY-MM-DD"
            p.lease_contract_start = sd
    if "lease_contract_end" in body:
        if body.get("lease_contract_end") in (None, ""):
            p.lease_contract_end = None
        else:
            ed = _parse_date(body.get("lease_contract_end"))
            if not ed:
                return "lease_contract_end must be YYYY-MM-DD"
            p.lease_contract_end = ed
    if "lease_price_per_decimal_per_year" in body:
        raw = body.get("lease_price_per_decimal_per_year")
        if raw in (None, ""):
            p.lease_price_per_decimal_per_year = None
        else:
            p.lease_price_per_decimal_per_year = _decimal(raw)
            if p.lease_price_per_decimal_per_year < 0:
                return "lease_price_per_decimal_per_year cannot be negative"
    if "lease_paid_to_landlord" in body:
        p.lease_paid_to_landlord = _money_q(_decimal(body.get("lease_paid_to_landlord"), "0"))
        if p.lease_paid_to_landlord < 0:
            return "lease_paid_to_landlord cannot be negative"
    if p.lease_contract_start and p.lease_contract_end and p.lease_contract_end < p.lease_contract_start:
        return "lease_contract_end must be on or after lease_contract_start"
    return None


def _apply_pond_pos_customer(p: AquaculturePond, body: dict, company_id: int) -> str | None:
    """Mutate pond POS customer link from JSON. Returns error message or None."""
    if "pos_customer_id" not in body:
        return None
    raw = body.get("pos_customer_id")
    if raw in (None, ""):
        p.pos_customer_id = None
        p.auto_pos_customer = False
        return None
    try:
        cust_id = int(raw)
    except (TypeError, ValueError):
        return "pos_customer_id must be an integer or null"
    cust = Customer.objects.filter(pk=cust_id, company_id=company_id).first()
    if not cust:
        return "pos_customer_id must refer to a customer in this company"
    if not cust.is_active and p.pos_customer_id != cust_id:
        return "pos_customer_id must be an active customer"
    p.pos_customer_id = cust_id
    p.auto_pos_customer = False
    return None


def _apply_expense_feed_metrics_from_body(x: AquacultureExpense, body: dict) -> str | None:
    """Mutate optional feed sack / kg fields when present in JSON."""
    for key, field in (("feed_sack_count", "feed_sack_count"), ("feed_weight_kg", "feed_weight_kg")):
        if key not in body:
            continue
        raw = body.get(key)
        if raw in (None, ""):
            setattr(x, field, None)
            continue
        v = _decimal(str(raw))
        if v < 0:
            return f"{key} cannot be negative"
        setattr(x, field, v)
    return None


def _pond_lease_derived(p: AquaculturePond, today: date) -> dict:
    """Computed lease figures for API consumers (not stored)."""
    size = p.pond_size_decimal
    price = p.lease_price_per_decimal_per_year
    start = p.lease_contract_start
    end = p.lease_contract_end
    paid = p.lease_paid_to_landlord if p.lease_paid_to_landlord is not None else Decimal(0)

    annual: Decimal | None = None
    if size is not None and price is not None:
        annual = _money_q(size * price)

    contract_years_rounded: int | None = None
    contract_total: Decimal | None = None
    if start and end and end >= start:
        contract_years_rounded = _contract_years_rounded_int(start, end)
        if annual is not None and contract_years_rounded is not None:
            contract_total = _money_q(annual * Decimal(contract_years_rounded))

    rem_y: int | None = None
    rem_m: int | None = None
    if end:
        ref = max(today, start) if start else today
        rem_y, rem_m = _remaining_years_months(ref, end)

    balance: Decimal | None = None
    if contract_total is not None:
        balance = _money_q(contract_total - paid)

    return {
        "lease_annual_amount": str(annual) if annual is not None else None,
        "lease_contract_years": (
            str(contract_years_rounded) if contract_years_rounded is not None else None
        ),
        "lease_contract_total": str(contract_total) if contract_total is not None else None,
        "lease_remaining_years": rem_y,
        "lease_remaining_months": rem_m,
        "lease_balance_due": str(balance) if balance is not None else None,
    }


def _equal_split_amounts(total: Decimal, pond_ids: list[int]) -> list[tuple[int, Decimal]]:
    """Split total into len(pond_ids) currency amounts that sum exactly to total (cent fairness)."""
    n = len(pond_ids)
    total_cents = int(_money_q(total) * 100)
    base = total_cents // n
    rem = total_cents % n
    out: list[tuple[int, Decimal]] = []
    for i, pid in enumerate(pond_ids):
        cents = base + (1 if i < rem else 0)
        out.append((pid, Decimal(cents) / Decimal(100)))
    return out


def _ponds_valid_for_company(company_id: int, pond_ids: list[int]) -> bool:
    if not pond_ids:
        return False
    return AquaculturePond.objects.filter(company_id=company_id, pk__in=pond_ids).count() == len(set(pond_ids))


def _parse_shared_expense_plan(
    body: dict, company_id: int, total_amount: Decimal
) -> tuple[list[tuple[int, Decimal]] | None, str | None]:
    """
    Parse shared split for an expense with pond=null.
    Returns (list of (pond_id, amount), error_message).
    """
    eq = body.get("shared_equal_pond_ids")
    raw_shares = body.get("pond_shares")
    if eq is not None and raw_shares is not None:
        return None, "Use either shared_equal_pond_ids or pond_shares, not both."
    if eq is not None:
        if not isinstance(eq, list) or len(eq) < 2:
            return None, "shared_equal_pond_ids must be a list of at least two pond ids."
        try:
            pids = [int(x) for x in eq]
        except (TypeError, ValueError):
            return None, "shared_equal_pond_ids must be integers."
        if len(set(pids)) < 2:
            return None, "shared_equal_pond_ids must name at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, pids):
            return None, "One or more pond ids are invalid for this company."
        return _equal_split_amounts(_money_q(total_amount), pids), None
    if raw_shares is not None:
        if not isinstance(raw_shares, list) or len(raw_shares) < 2:
            return None, "pond_shares must be a list with at least two {pond_id, amount} rows."
        pairs: list[tuple[int, Decimal]] = []
        seen: set[int] = set()
        for row in raw_shares:
            if not isinstance(row, dict):
                return None, "Each pond_shares row must be an object."
            try:
                pid = int(row.get("pond_id"))
            except (TypeError, ValueError):
                return None, "pond_id in pond_shares must be an integer."
            if pid in seen:
                return None, "Duplicate pond_id in pond_shares."
            seen.add(pid)
            amt = _decimal(row.get("amount"))
            if amt <= 0:
                return None, "Each pond_shares amount must be greater than zero."
            pairs.append((pid, _money_q(amt)))
        if len(seen) < 2:
            return None, "pond_shares must cover at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, list(seen)):
            return None, "One or more pond ids in pond_shares are invalid for this company."
        sm = sum(a for _, a in pairs)
        if _money_q(sm) != _money_q(total_amount):
            return None, "pond_shares must sum exactly to the expense amount (two decimal places)."
        return pairs, None
    return None, "Shared expense requires shared_equal_pond_ids or pond_shares."


def _cycle_for_company(company_id: int, cycle_id: int) -> AquacultureProductionCycle | None:
    return AquacultureProductionCycle.objects.filter(pk=cycle_id, company_id=company_id).first()


def _cycle_to_json(c: AquacultureProductionCycle) -> dict:
    return {
        "id": c.id,
        "pond_id": c.pond_id,
        "name": c.name or "",
        "code": c.code or "",
        "start_date": c.start_date.isoformat(),
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "sort_order": c.sort_order,
        "is_active": c.is_active,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def _aquaculture_access(request) -> JsonResponse | None:
    """
    Tenant must have the module enabled (superuser). Only the tenant Admin account or a
    platform super-admin may use aquaculture APIs.
    """
    c = Company.objects.filter(pk=request.company_id).only("aquaculture_enabled").first()
    if not c or not getattr(c, "aquaculture_enabled", False):
        return JsonResponse(
            {
                "detail": "Aquaculture is not enabled for this company. Ask a platform administrator to turn it on in Company settings.",
            },
            status=403,
        )
    user = getattr(request, "api_user", None)
    if not user_may_access_aquaculture_api(user):
        return JsonResponse(
            {
                "detail": "Aquaculture is only available to the company Admin account for this tenant. Other roles use core fuel station and retail features.",
            },
            status=403,
        )
    return None


def _pond_for_company(company_id: int, pond_id: int) -> AquaculturePond | None:
    return AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()


_POND_AUTO_CODE = re.compile(r"^[pP](\d+)$")


def _pond_code_serial(code: str) -> int | None:
    m = _POND_AUTO_CODE.match((code or "").strip())
    return int(m.group(1)) if m else None


def _occupied_pond_code_serials(company_id: int, exclude_pond_id: int | None = None) -> set[int]:
    qs = AquaculturePond.objects.filter(company_id=company_id)
    if exclude_pond_id is not None:
        qs = qs.exclude(pk=exclude_pond_id)
    out: set[int] = set()
    for c in qs.values_list("code", flat=True):
        n = _pond_code_serial(c or "")
        if n is not None:
            out.add(n)
    return out


def _format_auto_pond_code(n: int, occupied: set[int]) -> str:
    width = max(2, len(str(n)))
    if occupied:
        width = max(width, max((len(str(x)) for x in occupied), default=0))
    return "P" + str(n).zfill(width)


def _next_automatic_pond_code(company_id: int) -> str:
    """Smallest unused P + serial code (P01, P02, …), filling gaps (e.g. only P02 → next is P01)."""
    occupied = _occupied_pond_code_serials(company_id)
    m = 1
    while m in occupied:
        m += 1
    return _format_auto_pond_code(m, occupied)


def _pond_code_conflict(company_id: int, code: str, exclude_pond_id: int | None) -> bool:
    c = (code or "").strip()
    if not c:
        return False
    qs = AquaculturePond.objects.filter(company_id=company_id, code__iexact=c)
    if exclude_pond_id is not None:
        qs = qs.exclude(pk=exclude_pond_id)
    return qs.exists()


_CYCLE_AUTO_CODE = re.compile(r"^[cC](\d+)$")


def _cycle_code_serial(code: str) -> int | None:
    m = _CYCLE_AUTO_CODE.match((code or "").strip())
    return int(m.group(1)) if m else None


def _occupied_cycle_code_serials(
    company_id: int, pond_id: int, exclude_cycle_id: int | None = None
) -> set[int]:
    qs = AquacultureProductionCycle.objects.filter(company_id=company_id, pond_id=pond_id)
    if exclude_cycle_id is not None:
        qs = qs.exclude(pk=exclude_cycle_id)
    out: set[int] = set()
    for row in qs.values_list("code", flat=True):
        n = _cycle_code_serial(row or "")
        if n is not None:
            out.add(n)
    return out


def _format_auto_cycle_code(n: int, occupied: set[int]) -> str:
    width = max(2, len(str(n)))
    if occupied:
        width = max(width, max((len(str(x)) for x in occupied), default=0))
    return "C" + str(n).zfill(width)


def _next_automatic_cycle_code(company_id: int, pond_id: int) -> str:
    """Per-pond: smallest unused C + serial (C01, C02, …), same gap-fill rules as pond P-codes."""
    occupied = _occupied_cycle_code_serials(company_id, pond_id)
    m = 1
    while m in occupied:
        m += 1
    return _format_auto_cycle_code(m, occupied)


def _cycle_code_conflict(
    company_id: int, pond_id: int, code: str, exclude_cycle_id: int | None
) -> bool:
    c = (code or "").strip()
    if not c:
        return False
    qs = AquacultureProductionCycle.objects.filter(
        company_id=company_id, pond_id=pond_id, code__iexact=c
    )
    if exclude_cycle_id is not None:
        qs = qs.exclude(pk=exclude_cycle_id)
    return qs.exists()


def _pond_to_json(p: AquaculturePond) -> dict:
    today = django_timezone.localdate()
    lease = _pond_lease_derived(p, today)
    pcid = getattr(p, "pos_customer_id", None)
    pc_disp = ""
    pc = getattr(p, "pos_customer", None)
    if pc:
        pc_disp = (pc.company_name or pc.display_name or "").strip() or f"Customer #{pc.id}"
    return {
        "id": p.id,
        "name": p.name or "",
        "code": p.code or "",
        "sort_order": p.sort_order,
        "is_active": p.is_active,
        "notes": p.notes or "",
        "pond_size_decimal": str(p.pond_size_decimal) if p.pond_size_decimal is not None else None,
        "lease_contract_start": p.lease_contract_start.isoformat() if p.lease_contract_start else None,
        "lease_contract_end": p.lease_contract_end.isoformat() if p.lease_contract_end else None,
        "lease_price_per_decimal_per_year": (
            str(p.lease_price_per_decimal_per_year) if p.lease_price_per_decimal_per_year is not None else None
        ),
        "lease_paid_to_landlord": str(_money_q(p.lease_paid_to_landlord or Decimal(0))),
        **lease,
        "pos_customer_id": pcid,
        "pos_customer_display": pc_disp,
        "pos_customer_auto_managed": bool(getattr(p, "auto_pos_customer", False)),
        "pond_role": getattr(p, "pond_role", None) or "grow_out",
        "pond_role_label": POND_ROLE_LABELS.get(getattr(p, "pond_role", None) or "grow_out", "Grow-out"),
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_expense_categories(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [
            {
                "id": c,
                "label": lbl,
                "hint": EXPENSE_CATEGORY_EXTRA_HELP.get(c),
            }
            for c, lbl in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
        ],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_income_types(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_INCOME_TYPE_CHOICES],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_species(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_FISH_SPECIES_CHOICES],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_production_cycles_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureProductionCycle.objects.filter(company_id=cid).select_related("pond")
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        qs = qs.order_by("pond_id", "sort_order", "-start_date", "id")
        return JsonResponse([_cycle_to_json(c) for c in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    name = (body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    sd = _parse_date(body.get("start_date"))
    if not sd:
        return JsonResponse({"detail": "start_date is required (YYYY-MM-DD)"}, status=400)
    ed = _parse_date(body.get("end_date")) if body.get("end_date") else None
    if ed and ed < sd:
        return JsonResponse({"detail": "end_date must be on or after start_date"}, status=400)
    auto_code = _next_automatic_cycle_code(cid, pond_id)
    c = AquacultureProductionCycle(
        company_id=cid,
        pond=pond,
        name=name[:200],
        code=auto_code[:64],
        start_date=sd,
        end_date=ed,
        sort_order=int(body.get("sort_order") or 0),
        is_active=bool(body.get("is_active", True)),
        notes=(body.get("notes") or "")[:5000],
    )
    c.save()
    return JsonResponse(_cycle_to_json(c), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_production_cycle_detail(request, cycle_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    c = AquacultureProductionCycle.objects.filter(pk=cycle_id, company_id=cid).select_related("pond").first()
    if not c:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_cycle_to_json(c))
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        if "name" in body:
            n = (body.get("name") or "").strip()
            if n:
                c.name = n[:200]
        if "code" in body:
            new_code = (body.get("code") or "").strip()[:64]
            if new_code != (c.code or "").strip() and _cycle_code_conflict(cid, c.pond_id, new_code, c.id):
                return JsonResponse(
                    {"detail": "Another cycle for this pond already uses this code."},
                    status=400,
                )
            c.code = new_code
        if "start_date" in body:
            sd = _parse_date(body.get("start_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid start_date"}, status=400)
            c.start_date = sd
        if "end_date" in body:
            if body.get("end_date") in (None, ""):
                c.end_date = None
            else:
                ed = _parse_date(body.get("end_date"))
                if not ed:
                    return JsonResponse({"detail": "Invalid end_date"}, status=400)
                c.end_date = ed
        if c.end_date and c.end_date < c.start_date:
            return JsonResponse({"detail": "end_date must be on or after start_date"}, status=400)
        if "sort_order" in body:
            c.sort_order = int(body.get("sort_order") or 0)
        if "is_active" in body:
            c.is_active = bool(body["is_active"])
        if "notes" in body:
            c.notes = str(body.get("notes") or "")[:5000]
        c.save()
        return JsonResponse(_cycle_to_json(c))
    c.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_ponds_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquaculturePond.objects.filter(company_id=cid).select_related("pos_customer").order_by("sort_order", "id")
        return JsonResponse([_pond_to_json(p) for p in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    name = (body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    skip_auto = bool(body.get("skip_auto_pos_customer"))
    auto_code = _next_automatic_pond_code(cid)
    p = AquaculturePond(
        company_id=cid,
        name=name[:200],
        code=auto_code[:64],
        sort_order=int(body.get("sort_order") or 0),
        is_active=bool(body.get("is_active", True)),
        notes=(body.get("notes") or "")[:5000],
    )
    if body.get("pond_role") is not None and str(body.get("pond_role")).strip() != "":
        pr, pr_err = normalize_pond_role(body.get("pond_role"))
        if pr_err:
            return JsonResponse({"detail": pr_err}, status=400)
        p.pond_role = pr
    lease_err = _apply_pond_lease_fields(p, body)
    if lease_err:
        return JsonResponse({"detail": lease_err}, status=400)
    pos_err = _apply_pond_pos_customer(p, body, cid)
    if pos_err:
        return JsonResponse({"detail": pos_err}, status=400)
    try:
        with transaction.atomic():
            p.save()
            prov_err = maybe_provision_auto_pos_customer(company_id=cid, pond=p, skip_auto=skip_auto)
            if prov_err:
                raise ValueError(prov_err)
    except ValueError as ex:
        return JsonResponse({"detail": str(ex)}, status=400)
    p = AquaculturePond.objects.filter(pk=p.pk).select_related("pos_customer").first()
    return JsonResponse(_pond_to_json(p), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_pond_detail(request, pond_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    p = _pond_for_company(cid, pond_id)
    if not p:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    if request.method == "GET":
        p = AquaculturePond.objects.filter(pk=p.pk).select_related("pos_customer").first()
        return JsonResponse(_pond_to_json(p))
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        prev_pos_customer_id = p.pos_customer_id
        prev_auto_pos_customer = bool(getattr(p, "auto_pos_customer", False))
        if "name" in body:
            n = (body.get("name") or "").strip()
            if n:
                p.name = n[:200]
        if "code" in body:
            new_code = (body.get("code") or "").strip()[:64]
            if new_code != (p.code or "").strip() and _pond_code_conflict(cid, new_code, p.id):
                return JsonResponse({"detail": "Another pond already uses this code."}, status=400)
            p.code = new_code
        if "sort_order" in body:
            p.sort_order = int(body.get("sort_order") or 0)
        if "is_active" in body:
            p.is_active = bool(body["is_active"])
        if "notes" in body:
            p.notes = str(body.get("notes") or "")[:5000]
        if "pond_role" in body:
            pr, pr_err = normalize_pond_role(body.get("pond_role"))
            if pr_err:
                return JsonResponse({"detail": pr_err}, status=400)
            p.pond_role = pr
        lease_err = _apply_pond_lease_fields(p, body)
        if lease_err:
            return JsonResponse({"detail": lease_err}, status=400)
        pos_err = _apply_pond_pos_customer(p, body, cid)
        if pos_err:
            return JsonResponse({"detail": pos_err}, status=400)
        p.save()
        if "pos_customer_id" in body:
            raw_pc = body.get("pos_customer_id")
            if raw_pc in (None, ""):
                on_pond_pos_customer_cleared(
                    company_id=cid,
                    old_customer_id=prev_pos_customer_id,
                    old_was_auto_managed=prev_auto_pos_customer,
                )
            else:
                new_pc = p.pos_customer_id
                if prev_pos_customer_id != new_pc:
                    on_pond_pos_customer_replaced(
                        company_id=cid,
                        old_customer_id=prev_pos_customer_id,
                        old_was_auto_managed=prev_auto_pos_customer,
                        new_customer_id=new_pc,
                    )
        sync_auto_pos_customer_from_pond(p)
        p = AquaculturePond.objects.filter(pk=p.pk).select_related("pos_customer").first()
        return JsonResponse(_pond_to_json(p))
    on_pond_deleted(company_id=cid, pond=p)
    p.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _expense_to_json(x: AquacultureExpense) -> dict:
    pond_name = ""
    if x.pond_id and getattr(x, "pond", None):
        pond_name = (x.pond.name or "").strip()
    shares = []
    for sh in x.pond_shares.all():
        pname = ""
        if getattr(sh, "pond", None):
            pname = (sh.pond.name or "").strip()
        shares.append({"pond_id": sh.pond_id, "pond_name": pname, "amount": str(sh.amount)})
    shares.sort(key=lambda r: r["pond_id"])
    cname = ""
    cid_cycle = None
    if x.production_cycle_id and getattr(x, "production_cycle", None):
        cid_cycle = x.production_cycle_id
        cname = (x.production_cycle.name or "").strip()
    src_sid = getattr(x, "source_station_id", None)
    src_sname = ""
    if src_sid and getattr(x, "source_station", None):
        src_sname = (x.source_station.station_name or "").strip()
    return {
        "id": x.id,
        "pond_id": x.pond_id,
        "pond_name": pond_name,
        "is_shared": x.pond_id is None,
        "pond_shares": shares,
        "production_cycle_id": cid_cycle,
        "production_cycle_name": cname,
        "expense_category": x.expense_category,
        "expense_category_label": EXPENSE_CATEGORY_LABELS.get(x.expense_category, x.expense_category),
        "expense_date": x.expense_date.isoformat(),
        "amount": str(x.amount),
        "memo": x.memo or "",
        "vendor_name": x.vendor_name or "",
        "source_station_id": src_sid,
        "source_station_name": src_sname,
        "feed_sack_count": str(x.feed_sack_count) if getattr(x, "feed_sack_count", None) is not None else None,
        "feed_weight_kg": str(x.feed_weight_kg) if getattr(x, "feed_weight_kg", None) is not None else None,
        "created_at": x.created_at.isoformat() if x.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_expenses_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquacultureExpense.objects.filter(company_id=cid)
            .select_related("pond", "production_cycle", "source_station")
            .prefetch_related("pond_shares__pond")
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            p_int = int(pid)
            qs = qs.filter(Q(pond_id=p_int) | Q(pond_shares__pond_id=p_int)).distinct()
        qs = qs.order_by("-expense_date", "-id")[:500]
        return JsonResponse([_expense_to_json(x) for x in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    cat, cerr = normalize_expense_category(body.get("expense_category"))
    if cerr:
        return JsonResponse({"detail": cerr}, status=400)
    ed = _parse_date(body.get("expense_date"))
    if not ed:
        return JsonResponse({"detail": "expense_date is required (YYYY-MM-DD)"}, status=400)
    amt = _decimal(body.get("amount"))
    if amt <= 0:
        return JsonResponse({"detail": "amount must be greater than zero"}, status=400)
    amt = _money_q(amt)

    pond_raw = body.get("pond_id")
    is_shared = pond_raw is None or (isinstance(pond_raw, str) and pond_raw.strip() == "")

    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)

    if is_shared:
        if cycle_obj is not None:
            return JsonResponse(
                {"detail": "Shared expenses cannot be assigned to a production_cycle (omit production_cycle_id)."},
                status=400,
            )
        pairs, perr = _parse_shared_expense_plan(body, cid, amt)
        if perr:
            return JsonResponse({"detail": perr}, status=400)
        assert pairs is not None
        with transaction.atomic():
            x = AquacultureExpense(
                company_id=cid,
                pond=None,
                production_cycle=None,
                expense_category=cat,
                expense_date=ed,
                amount=amt,
                memo=(body.get("memo") or "")[:5000],
                vendor_name=(body.get("vendor_name") or "")[:200],
            )
            fer = _apply_expense_feed_metrics_from_body(x, body)
            if fer:
                return JsonResponse({"detail": fer}, status=400)
            x.save()
            for pid, a in pairs:
                AquacultureExpensePondShare.objects.create(
                    expense=x,
                    pond_id=pid,
                    amount=_money_q(a),
                )
        x = (
            AquacultureExpense.objects.filter(pk=x.pk)
            .select_related("pond", "production_cycle", "source_station")
            .prefetch_related("pond_shares__pond")
            .first()
        )
        return JsonResponse(_expense_to_json(x), status=201)

    try:
        pond_id = int(pond_raw)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required (integer) unless saving a shared expense"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    if body.get("pond_shares") is not None or body.get("shared_equal_pond_ids") is not None:
        return JsonResponse(
            {"detail": "Do not send pond_shares or shared_equal_pond_ids when pond_id is set (direct cost)."},
            status=400,
        )
    if cycle_obj is not None and cycle_obj.pond_id != pond.id:
        return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)

    x = AquacultureExpense(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        expense_category=cat,
        expense_date=ed,
        amount=amt,
        memo=(body.get("memo") or "")[:5000],
        vendor_name=(body.get("vendor_name") or "")[:200],
    )
    fer = _apply_expense_feed_metrics_from_body(x, body)
    if fer:
        return JsonResponse({"detail": fer}, status=400)
    x.save()
    x = (
        AquacultureExpense.objects.filter(pk=x.pk)
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .first()
    )
    return JsonResponse(_expense_to_json(x), status=201)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_shop_stock_issue(request):
    """
    Advanced / optional: issue perpetual-inventory shop stock from a station to a pond at average cost
    (Dr COGS / Cr inventory + one AquacultureExpense). Prefer POS on-account sales to the pond’s linked customer
    for inventoried items so quantity and GL follow normal retail; use this endpoint only for internal at-cost moves.
    """
    err = _aquaculture_access(request)
    if err:
        return err
    body, e = parse_json_body(request)
    if e:
        return e
    cid = request.company_id
    cat, cerr = normalize_expense_category(body.get("expense_category"))
    if cerr:
        return JsonResponse({"detail": cerr}, status=400)
    ed = _parse_date(body.get("expense_date"))
    if not ed:
        return JsonResponse({"detail": "expense_date is required (YYYY-MM-DD)"}, status=400)
    raw_sid = body.get("station_id")
    raw_pid = body.get("pond_id")
    if raw_sid is None or raw_sid == "":
        return JsonResponse({"detail": "station_id is required"}, status=400)
    if raw_pid is None or raw_pid == "":
        return JsonResponse({"detail": "pond_id is required"}, status=400)
    try:
        station_id = int(raw_sid)
        pond_id = int(raw_pid)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "station_id and pond_id must be integers"}, status=400)
    cycle_raw = body.get("production_cycle_id")
    cycle_id: int | None
    if cycle_raw in (None, ""):
        cycle_id = None
    else:
        try:
            cycle_id = int(cycle_raw)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
    items = body.get("items")
    if not isinstance(items, list):
        return JsonResponse({"detail": "items must be an array of { item_id, quantity }"}, status=400)
    memo = str(body.get("memo") or "")
    vendor_name = str(body.get("vendor_name") or "")
    feed_sack_count: Decimal | None = None
    feed_weight_kg: Decimal | None = None
    if "feed_sack_count" in body:
        r = body.get("feed_sack_count")
        if r not in (None, ""):
            feed_sack_count = _decimal(str(r))
            if feed_sack_count < 0:
                return JsonResponse({"detail": "feed_sack_count cannot be negative"}, status=400)
    if "feed_weight_kg" in body:
        r = body.get("feed_weight_kg")
        if r not in (None, ""):
            feed_weight_kg = _decimal(str(r))
            if feed_weight_kg < 0:
                return JsonResponse({"detail": "feed_weight_kg cannot be negative"}, status=400)
    try:
        x = execute_aquaculture_shop_stock_issue(
            company_id=cid,
            station_id=station_id,
            pond_id=pond_id,
            production_cycle_id=cycle_id,
            expense_category=cat,
            expense_date=ed,
            items=items,
            memo=memo,
            vendor_name=vendor_name,
            feed_sack_count=feed_sack_count,
            feed_weight_kg=feed_weight_kg,
        )
    except StockBusinessError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    except GlPostingError as ex:
        return JsonResponse({"detail": getattr(ex, "detail", str(ex))}, status=400)
    return JsonResponse(_expense_to_json(x), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_expense_detail(request, expense_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    x = (
        AquacultureExpense.objects.filter(pk=expense_id, company_id=cid)
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .first()
    )
    if not x:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_expense_to_json(x))
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        was_shared = x.pond_id is None
        if "amount" in body:
            na = _decimal(body.get("amount"))
            if na <= 0:
                return JsonResponse({"detail": "amount must be greater than zero"}, status=400)
            amt = _money_q(na)
        else:
            amt = _money_q(x.amount)

        if "pond_id" in body:
            pr = body.get("pond_id")
            target_shared = pr is None or pr is False or (isinstance(pr, str) and str(pr).strip() == "")
        else:
            target_shared = was_shared

        cy = x.production_cycle
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                cy = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)

        if target_shared:
            if cy is not None:
                return JsonResponse({"detail": "Shared expenses cannot use production_cycle_id."}, status=400)
            must_reshare = (not was_shared) or ("amount" in body) or body.get("pond_shares") is not None or body.get(
                "shared_equal_pond_ids"
            ) is not None
            if must_reshare:
                pairs, perr = _parse_shared_expense_plan(body, cid, amt)
                if perr:
                    return JsonResponse({"detail": perr}, status=400)
                assert pairs is not None
                with transaction.atomic():
                    x.pond = None
                    x.production_cycle = None
                    x.amount = amt
                    AquacultureExpensePondShare.objects.filter(expense=x).delete()
                    for pid, a in pairs:
                        AquacultureExpensePondShare.objects.create(
                            expense=x,
                            pond_id=pid,
                            amount=_money_q(a),
                        )
            else:
                x.pond = None
                x.production_cycle = None
        else:
            if "pond_id" in body:
                try:
                    pid = int(body["pond_id"])
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "pond_id must be an integer for a direct expense"}, status=400)
            else:
                pid = x.pond_id
            if pid is None:
                return JsonResponse({"detail": "pond_id is required for a direct expense"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            if body.get("pond_shares") is not None or body.get("shared_equal_pond_ids") is not None:
                return JsonResponse(
                    {"detail": "Remove pond_shares / shared_equal_pond_ids when assigning a direct pond_id."},
                    status=400,
                )
            if cy is not None and cy.pond_id != pond.id:
                return JsonResponse(
                    {"detail": "production_cycle_id does not belong to the selected pond"},
                    status=400,
                )
            with transaction.atomic():
                x.pond = pond
                x.production_cycle = cy
                x.amount = amt
                AquacultureExpensePondShare.objects.filter(expense=x).delete()

        if "expense_category" in body:
            cat, cerr = normalize_expense_category(body.get("expense_category"))
            if cerr:
                return JsonResponse({"detail": cerr}, status=400)
            x.expense_category = cat
        if "expense_date" in body:
            ed = _parse_date(body.get("expense_date"))
            if not ed:
                return JsonResponse({"detail": "Invalid expense_date"}, status=400)
            x.expense_date = ed
        if "memo" in body:
            x.memo = str(body.get("memo") or "")[:5000]
        if "vendor_name" in body:
            x.vendor_name = str(body.get("vendor_name") or "")[:200]

        fer = _apply_expense_feed_metrics_from_body(x, body)
        if fer:
            return JsonResponse({"detail": fer}, status=400)

        x.save()
        x = (
            AquacultureExpense.objects.filter(pk=x.pk)
            .select_related("pond", "production_cycle", "source_station")
            .prefetch_related("pond_shares__pond")
            .first()
        )
        return JsonResponse(_expense_to_json(x))
    x.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _sale_to_json(s: AquacultureFishSale) -> dict:
    cname = ""
    cid_cycle = None
    if s.production_cycle_id and getattr(s, "production_cycle", None):
        cid_cycle = s.production_cycle_id
        cname = (s.production_cycle.name or "").strip()
    it = getattr(s, "income_type", None) or "fish_harvest_sale"
    sp = getattr(s, "fish_species", None) or "tilapia"
    spo = getattr(s, "fish_species_other", None) or ""
    return {
        "id": s.id,
        "pond_id": s.pond_id,
        "pond_name": (s.pond.name or "").strip() if getattr(s, "pond_id", None) else "",
        "production_cycle_id": cid_cycle,
        "production_cycle_name": cname,
        "income_type": it,
        "income_type_label": INCOME_TYPE_LABELS.get(it, it),
        "fish_species": sp,
        "fish_species_other": spo,
        "fish_species_label": fish_species_display_label(sp, spo),
        "sale_date": s.sale_date.isoformat(),
        "weight_kg": str(s.weight_kg),
        "fish_count": s.fish_count,
        "total_amount": str(s.total_amount),
        "buyer_name": s.buyer_name or "",
        "memo": s.memo or "",
        "created_at": s.created_at.isoformat() if s.created_at else "",
        "invoice_id": getattr(s, "invoice_id", None),
        "invoice_number": (
            (getattr(s, "invoice", None) and getattr(s.invoice, "invoice_number", None)) or None
        ),
        "accounting_posted": bool(getattr(s, "invoice_id", None)),
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_sales_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureFishSale.objects.filter(company_id=cid).select_related(
            "pond", "production_cycle", "invoice"
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        qs = qs.order_by("-sale_date", "-id")[:500]
        return JsonResponse([_sale_to_json(s) for s in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    it, ierr = normalize_income_type(body.get("income_type"))
    if ierr:
        return JsonResponse({"detail": ierr}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    sd = _parse_date(body.get("sale_date"))
    if not sd:
        return JsonResponse({"detail": "sale_date is required (YYYY-MM-DD)"}, status=400)
    wk = _decimal(body.get("weight_kg"))
    if wk <= 0:
        return JsonResponse({"detail": "weight_kg must be greater than zero"}, status=400)
    ta = _decimal(body.get("total_amount"))
    if ta < 0:
        return JsonResponse({"detail": "total_amount cannot be negative"}, status=400)
    fc = body.get("fish_count")
    fc_int = None
    if fc is not None and str(fc).strip() != "":
        try:
            fc_int = int(fc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "fish_count must be an integer"}, status=400)
    if it in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES:
        fs = "not_applicable"
        fso = ""
    else:
        fs, fserr = normalize_fish_species(body.get("fish_species"))
        if fserr:
            return JsonResponse({"detail": fserr}, status=400)
        if fs == "not_applicable":
            return JsonResponse(
                {
                    "detail": "Pick a fish species for fish-related income, or choose empty sacks / scrap sale for non-fish lines."
                },
                status=400,
            )
        fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    s = AquacultureFishSale(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        income_type=it,
        fish_species=fs,
        fish_species_other=fso,
        sale_date=sd,
        weight_kg=wk,
        fish_count=fc_int,
        total_amount=ta.quantize(Decimal("0.01")),
        buyer_name=(body.get("buyer_name") or "")[:200],
        memo=(body.get("memo") or "")[:5000],
    )
    with transaction.atomic():
        s.save()
        sync_biomass_sample_from_fish_sale(s)
    s = AquacultureFishSale.objects.filter(pk=s.pk).select_related(
        "pond", "production_cycle", "invoice"
    ).first()
    return JsonResponse(_sale_to_json(s), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_sale_detail(request, sale_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    s = (
        AquacultureFishSale.objects.filter(pk=sale_id, company_id=cid)
        .select_related("pond", "production_cycle", "invoice")
        .first()
    )
    if not s:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_sale_to_json(s))
    if request.method == "PUT":
        if getattr(s, "invoice_id", None):
            return JsonResponse(
                {
                    "detail": "This sale is posted to the books. Change or void the linked invoice from the "
                    "Invoices page, or delete that invoice first to unlock editing this line."
                },
                status=409,
            )
        body, e = parse_json_body(request)
        if e:
            return e
        if "pond_id" in body:
            try:
                pid = int(body["pond_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            s.pond = pond
        if "income_type" in body:
            it, ierr = normalize_income_type(body.get("income_type"))
            if ierr:
                return JsonResponse({"detail": ierr}, status=400)
            s.income_type = it
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                s.production_cycle = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)
                if cy.pond_id != s.pond_id:
                    return JsonResponse({"detail": "production_cycle_id does not belong to the sale pond"}, status=400)
                s.production_cycle = cy
        if "sale_date" in body:
            sd = _parse_date(body.get("sale_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid sale_date"}, status=400)
            s.sale_date = sd
        if "weight_kg" in body:
            wk = _decimal(body.get("weight_kg"))
            if wk <= 0:
                return JsonResponse({"detail": "weight_kg must be greater than zero"}, status=400)
            s.weight_kg = wk
        if "total_amount" in body:
            ta = _decimal(body.get("total_amount"))
            if ta < 0:
                return JsonResponse({"detail": "total_amount cannot be negative"}, status=400)
            s.total_amount = ta.quantize(Decimal("0.01"))
        if "fish_count" in body:
            fc = body.get("fish_count")
            if fc is None or str(fc).strip() == "":
                s.fish_count = None
            else:
                try:
                    s.fish_count = int(fc)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "fish_count must be an integer"}, status=400)
        if "buyer_name" in body:
            s.buyer_name = str(body.get("buyer_name") or "")[:200]
        if "memo" in body:
            s.memo = str(body.get("memo") or "")[:5000]
        if "fish_species" in body:
            fs, fserr = normalize_fish_species(body.get("fish_species"))
            if fserr:
                return JsonResponse({"detail": fserr}, status=400)
            s.fish_species = fs
            if "fish_species_other" in body:
                s.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), fs)
            else:
                s.fish_species_other = normalize_fish_species_other(None, fs)
        elif "fish_species_other" in body:
            s.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), s.fish_species)
        if s.income_type in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES:
            s.fish_species = "not_applicable"
            s.fish_species_other = ""
        elif s.fish_species == "not_applicable":
            return JsonResponse(
                {
                    "detail": "Pick a fish species for fish-related income, or use an empty-sack / scrap income type for non-fish lines."
                },
                status=400,
            )
        with transaction.atomic():
            s.save()
            sync_biomass_sample_from_fish_sale(s)
        s = AquacultureFishSale.objects.filter(pk=s.pk).select_related(
            "pond", "production_cycle", "invoice"
        ).first()
        return JsonResponse(_sale_to_json(s))
    if getattr(s, "invoice_id", None):
        return JsonResponse(
            {
                "detail": "This sale is linked to an invoice. Delete or void that invoice first, then you can "
                "remove this pond sale line."
            },
            status=409,
        )
    s.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def aquaculture_sale_finalize(request, sale_id: int):
    """Create Invoice + GL for a pond sale (idempotent if already finalized)."""
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    body, e = parse_json_body(request)
    if e:
        return e
    from api.services.aquaculture_sale_accounting import finalize_aquaculture_fish_sale_to_invoice

    sale, inv_dict, msg = finalize_aquaculture_fish_sale_to_invoice(cid, sale_id, body or {})
    if msg:
        return JsonResponse({"detail": msg}, status=400)
    if sale is None or inv_dict is None:
        return JsonResponse({"detail": "Unexpected finalize result"}, status=500)
    sale = (
        AquacultureFishSale.objects.filter(pk=sale.pk, company_id=cid)
        .select_related("pond", "production_cycle", "invoice")
        .first()
    )
    return JsonResponse({"sale": _sale_to_json(sale), "invoice": inv_dict})


def _sample_to_json(b: AquacultureBiomassSample) -> dict:
    cyc_id = getattr(b, "production_cycle_id", None)
    cname = ""
    if cyc_id and getattr(b, "production_cycle", None):
        cname = (b.production_cycle.name or "").strip()
    sp = getattr(b, "fish_species", None) or "tilapia"
    spo = getattr(b, "fish_species_other", None) or ""
    return {
        "id": b.id,
        "pond_id": b.pond_id,
        "pond_name": (b.pond.name or "").strip() if getattr(b, "pond_id", None) else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cname,
        "sample_date": b.sample_date.isoformat(),
        "estimated_fish_count": b.estimated_fish_count,
        "estimated_total_weight_kg": str(b.estimated_total_weight_kg) if b.estimated_total_weight_kg is not None else None,
        "avg_weight_kg": str(b.avg_weight_kg) if b.avg_weight_kg is not None else None,
        "fish_species": sp,
        "fish_species_other": spo,
        "fish_species_label": fish_species_display_label(sp, spo),
        "notes": b.notes or "",
        "source_fish_sale_id": getattr(b, "source_fish_sale_id", None),
        "created_at": b.created_at.isoformat() if b.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_samples_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = AquacultureBiomassSample.objects.filter(company_id=cid).select_related("pond", "production_cycle")
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        qs = qs.order_by("-sample_date", "-id")[:200]
        return JsonResponse([_sample_to_json(b) for b in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    sd = _parse_date(body.get("sample_date"))
    if not sd:
        return JsonResponse({"detail": "sample_date is required (YYYY-MM-DD)"}, status=400)
    efc = body.get("estimated_fish_count")
    efc_i = None
    if efc is not None and str(efc).strip() != "":
        try:
            efc_i = int(efc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "estimated_fish_count must be an integer"}, status=400)
    etw = body.get("estimated_total_weight_kg")
    etw_d = None
    if etw is not None and str(etw).strip() != "":
        etw_d = _decimal(etw)
        if etw_d < 0:
            return JsonResponse({"detail": "estimated_total_weight_kg cannot be negative"}, status=400)
    aw = body.get("avg_weight_kg")
    aw_d = None
    if aw is not None and str(aw).strip() != "":
        aw_d = _decimal(aw)
        if aw_d < 0:
            return JsonResponse({"detail": "avg_weight_kg cannot be negative"}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    fs, fserr = normalize_fish_species(body.get("fish_species"))
    if fserr:
        return JsonResponse({"detail": fserr}, status=400)
    if fs == "not_applicable":
        return JsonResponse(
            {"detail": "fish_species must be a fish species (not N/A) for biomass sampling."},
            status=400,
        )
    fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    b = AquacultureBiomassSample(
        company_id=cid,
        pond=pond,
        production_cycle=cycle_obj,
        sample_date=sd,
        estimated_fish_count=efc_i,
        estimated_total_weight_kg=etw_d,
        avg_weight_kg=aw_d,
        fish_species=fs,
        fish_species_other=fso,
        notes=(body.get("notes") or "")[:5000],
    )
    b.save()
    b = AquacultureBiomassSample.objects.filter(pk=b.pk).select_related("pond", "production_cycle").first()
    return JsonResponse(_sample_to_json(b), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_sample_detail(request, sample_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    b = (
        AquacultureBiomassSample.objects.filter(pk=sample_id, company_id=cid)
        .select_related("pond", "production_cycle")
        .first()
    )
    if not b:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_sample_to_json(b))
    if request.method == "PUT":
        body, e = parse_json_body(request)
        if e:
            return e
        if "pond_id" in body:
            try:
                pid = int(body["pond_id"])
            except (TypeError, ValueError):
                return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
            pond = _pond_for_company(cid, pid)
            if not pond:
                return JsonResponse({"detail": "Pond not found"}, status=404)
            b.pond = pond
        if "sample_date" in body:
            sd = _parse_date(body.get("sample_date"))
            if not sd:
                return JsonResponse({"detail": "Invalid sample_date"}, status=400)
            b.sample_date = sd
        if "estimated_fish_count" in body:
            fc = body.get("estimated_fish_count")
            if fc is None or str(fc).strip() == "":
                b.estimated_fish_count = None
            else:
                try:
                    b.estimated_fish_count = int(fc)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "estimated_fish_count must be an integer"}, status=400)
        if "estimated_total_weight_kg" in body:
            etw = body.get("estimated_total_weight_kg")
            if etw is None or str(etw).strip() == "":
                b.estimated_total_weight_kg = None
            else:
                d = _decimal(etw)
                if d < 0:
                    return JsonResponse({"detail": "estimated_total_weight_kg cannot be negative"}, status=400)
                b.estimated_total_weight_kg = d
        if "avg_weight_kg" in body:
            aw = body.get("avg_weight_kg")
            if aw is None or str(aw).strip() == "":
                b.avg_weight_kg = None
            else:
                d = _decimal(aw)
                if d < 0:
                    return JsonResponse({"detail": "avg_weight_kg cannot be negative"}, status=400)
                b.avg_weight_kg = d
        if "production_cycle_id" in body:
            raw_cy = body.get("production_cycle_id")
            if raw_cy in (None, ""):
                b.production_cycle = None
            else:
                try:
                    cy_id = int(raw_cy)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
                cy = _cycle_for_company(cid, cy_id)
                if not cy:
                    return JsonResponse({"detail": "Production cycle not found"}, status=404)
                if cy.pond_id != b.pond_id:
                    return JsonResponse({"detail": "production_cycle_id does not belong to the sample pond"}, status=400)
                b.production_cycle = cy
        if "notes" in body:
            b.notes = str(body.get("notes") or "")[:5000]
        if "fish_species" in body:
            fs, fserr = normalize_fish_species(body.get("fish_species"))
            if fserr:
                return JsonResponse({"detail": fserr}, status=400)
            if fs == "not_applicable":
                return JsonResponse(
                    {"detail": "fish_species must be a fish species (not N/A) for biomass sampling."},
                    status=400,
                )
            b.fish_species = fs
            if "fish_species_other" in body:
                b.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), fs)
            else:
                b.fish_species_other = normalize_fish_species_other(None, fs)
        elif "fish_species_other" in body:
            b.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), b.fish_species)
        b.save()
        b = AquacultureBiomassSample.objects.filter(pk=b.pk).select_related("pond", "production_cycle").first()
        return JsonResponse(_sample_to_json(b))
    b.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


def _stock_ledger_to_json(x: AquacultureFishStockLedger) -> dict:
    cyc_id = getattr(x, "production_cycle_id", None)
    cname = ""
    if cyc_id and getattr(x, "production_cycle", None):
        cname = (x.production_cycle.name or "").strip()
    je = x.journal_entry
    lr = (x.loss_reason or "").strip()
    return {
        "id": x.id,
        "pond_id": x.pond_id,
        "pond_name": (x.pond.name or "").strip() if getattr(x, "pond_id", None) else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cname,
        "entry_date": x.entry_date.isoformat(),
        "entry_kind": x.entry_kind,
        "entry_kind_label": STOCK_LEDGER_ENTRY_KIND_LABELS.get(x.entry_kind, x.entry_kind),
        "loss_reason": lr,
        "loss_reason_label": STOCK_LEDGER_LOSS_REASON_LABELS.get(lr, "") or None,
        "fish_species": x.fish_species,
        "fish_species_other": x.fish_species_other or "",
        "fish_species_label": fish_species_display_label(x.fish_species, x.fish_species_other),
        "fish_count_delta": x.fish_count_delta,
        "weight_kg_delta": str(x.weight_kg_delta),
        "book_value": str(x.book_value),
        "post_to_books": bool(x.post_to_books),
        "memo": x.memo or "",
        "journal_entry_id": x.journal_entry_id,
        "journal_is_posted": bool(je.is_posted) if je else False,
        "journal_entry_number": (je.entry_number or "") if je else "",
        "created_at": x.created_at.isoformat() if x.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_stock_ledger_reference(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        {
            "entry_kind": [{"id": c, "label": lbl} for c, lbl in STOCK_LEDGER_ENTRY_KIND_CHOICES],
            "loss_reason": [{"id": c, "label": lbl} for c, lbl in STOCK_LEDGER_LOSS_REASON_CHOICES],
            "coa_note": STOCK_LEDGER_COA_NOTE,
        }
    )


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_fish_stock_position(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    pond_id = None
    raw_p = request.GET.get("pond_id")
    if raw_p and str(raw_p).strip().isdigit():
        pond_id = int(raw_p)
        if not _pond_for_company(cid, pond_id):
            return JsonResponse({"detail": "pond not found"}, status=404)
    cy_id = None
    raw_c = request.GET.get("production_cycle_id")
    if raw_c and str(raw_c).strip().isdigit():
        cy_id = int(raw_c)
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=cid).first()
        if not cy:
            return JsonResponse({"detail": "production_cycle not found"}, status=404)
        if pond_id is not None and cy.pond_id != pond_id:
            return JsonResponse({"detail": "production_cycle_id does not belong to pond_id"}, status=400)
    rows = compute_fish_stock_position_rows(cid, pond_id=pond_id, production_cycle_id=cy_id)
    return JsonResponse({"rows": rows})


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_fish_stock_ledger_list_or_create(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquacultureFishStockLedger.objects.filter(company_id=cid)
            .select_related("pond", "production_cycle", "journal_entry")
            .order_by("-entry_date", "-id")[:500]
        )
        pid = request.GET.get("pond_id")
        if pid and str(pid).strip().isdigit():
            qs = qs.filter(pond_id=int(pid))
        return JsonResponse([_stock_ledger_to_json(x) for x in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    ed = _parse_date(body.get("entry_date"))
    if not ed:
        return JsonResponse({"detail": "entry_date is required (YYYY-MM-DD)"}, status=400)
    kind, kerr = normalize_stock_ledger_entry_kind(body.get("entry_kind"))
    if kerr:
        return JsonResponse({"detail": kerr}, status=400)
    lr, lerr = normalize_stock_ledger_loss_reason(body.get("loss_reason"), kind)
    if lerr:
        return JsonResponse({"detail": lerr}, status=400)
    fs, fserr = normalize_fish_species(body.get("fish_species"))
    if fserr:
        return JsonResponse({"detail": fserr}, status=400)
    fso = normalize_fish_species_other(body.get("fish_species_other"), fs)
    try:
        fcd = int(body.get("fish_count_delta", 0))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "fish_count_delta must be an integer"}, status=400)
    wkd = _decimal(body.get("weight_kg_delta"), "0")
    bv = _money_q(_decimal(body.get("book_value"), "0"))
    if bv < 0:
        return JsonResponse({"detail": "book_value cannot be negative"}, status=400)
    post_books = body.get("post_to_books")
    if post_books is None:
        post_books = False
    else:
        post_books = bool(post_books)
    if post_books and bv <= 0:
        return JsonResponse({"detail": "post_to_books requires book_value greater than zero"}, status=400)
    if fcd == 0 and wkd == 0:
        return JsonResponse({"detail": "Provide a non-zero fish_count_delta and/or weight_kg_delta"}, status=400)
    if kind == "loss":
        if fcd > 0 or wkd > 0:
            return JsonResponse({"detail": "For entry_kind loss, fish_count_delta and weight_kg_delta must be <= 0"}, status=400)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)

    is_write_down = True
    if kind == "adjustment":
        if fcd >= 0 and wkd >= 0 and (fcd > 0 or wkd > 0):
            is_write_down = False
        elif fcd <= 0 and wkd <= 0 and (fcd < 0 or wkd < 0):
            is_write_down = True
        else:
            return JsonResponse(
                {"detail": "Manual adjustment cannot mix positive and negative signs across count and weight"},
                status=400,
            )
    if post_books:
        if kind == "adjustment" and not is_write_down and (fcd <= 0 and wkd <= 0):
            return JsonResponse({"detail": "Count gain posting requires positive fish_count_delta or weight_kg_delta"}, status=400)
        if is_write_down and fcd >= 0 and wkd >= 0:
            return JsonResponse({"detail": "Write-down posting requires a negative fish_count_delta or weight_kg_delta"}, status=400)

    memo = str(body.get("memo") or "")[:5000]
    pond_label = (pond.name or "").strip() or f"Pond #{pond.id}"
    line_memo = memo or f"Aquaculture fish stock — {kind}"

    if post_books:
        bio = ChartOfAccount.objects.filter(company_id=cid, account_code="1581", is_active=True).first()
        exp = ChartOfAccount.objects.filter(company_id=cid, account_code="6726", is_active=True).first()
        gain = ChartOfAccount.objects.filter(company_id=cid, account_code="4244", is_active=True).first()
        if not bio or (is_write_down and not exp) or (not is_write_down and not gain):
            return JsonResponse(
                {
                    "detail": (
                        "Could not post GL: missing chart accounts 1581 (biological inventory), "
                        "6726 (mortality expense), and/or 4244 (count gain). Re-save Company settings with "
                        "Aquaculture enabled to seed new COA lines, or add these codes manually."
                    )
                },
                status=400,
            )

    with transaction.atomic():
        led = AquacultureFishStockLedger(
            company_id=cid,
            pond=pond,
            production_cycle=cycle_obj,
            entry_date=ed,
            entry_kind=kind,
            loss_reason=lr,
            fish_species=fs,
            fish_species_other=fso,
            fish_count_delta=fcd,
            weight_kg_delta=wkd,
            book_value=bv,
            post_to_books=post_books,
            memo=memo,
        )
        led.save()
        if post_books:
            je = post_aquaculture_fish_stock_ledger_journal(
                cid,
                led.id,
                ed,
                is_write_down=is_write_down,
                book_value=bv,
                pond_label=pond_label,
                line_memo=line_memo[:300],
            )
            if je:
                led.journal_entry = je
                led.save(update_fields=["journal_entry"])

    led = (
        AquacultureFishStockLedger.objects.filter(pk=led.pk)
        .select_related("pond", "production_cycle", "journal_entry")
        .first()
    )
    return JsonResponse(_stock_ledger_to_json(led), status=201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
@require_company_id
def aquaculture_fish_stock_ledger_detail(request, ledger_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    led = (
        AquacultureFishStockLedger.objects.filter(pk=ledger_id, company_id=cid)
        .select_related("pond", "production_cycle", "journal_entry")
        .first()
    )
    if not led:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_stock_ledger_to_json(led))
    if request.method == "DELETE":
        if led.journal_entry_id:
            return JsonResponse(
                {"detail": "This row is linked to a journal entry. Void or delete that journal entry first, then retry."},
                status=400,
            )
        led.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    body, e = parse_json_body(request)
    if e:
        return e
    if led.journal_entry_id:
        if set(body.keys()) - {"memo"}:
            return JsonResponse({"detail": "Only memo can be edited after GL posting"}, status=400)
        if "memo" in body:
            led.memo = str(body.get("memo") or "")[:5000]
            led.save(update_fields=["memo", "updated_at"])
        led = AquacultureFishStockLedger.objects.filter(pk=led.pk).select_related("pond", "production_cycle", "journal_entry").first()
        return JsonResponse(_stock_ledger_to_json(led))

    ed = _parse_date(body.get("entry_date")) if "entry_date" in body else led.entry_date
    if "entry_date" in body and not ed:
        return JsonResponse({"detail": "Invalid entry_date"}, status=400)
    if "entry_date" in body:
        led.entry_date = ed
    if "entry_kind" in body:
        kind, kerr = normalize_stock_ledger_entry_kind(body.get("entry_kind"))
        if kerr:
            return JsonResponse({"detail": kerr}, status=400)
        led.entry_kind = kind
    kind_cur = led.entry_kind
    if "loss_reason" in body:
        lr, lerr = normalize_stock_ledger_loss_reason(body.get("loss_reason"), kind_cur)
        if lerr:
            return JsonResponse({"detail": lerr}, status=400)
        led.loss_reason = lr
    if "fish_species" in body:
        fs, fserr = normalize_fish_species(body.get("fish_species"))
        if fserr:
            return JsonResponse({"detail": fserr}, status=400)
        led.fish_species = fs
    if "fish_species_other" in body:
        led.fish_species_other = normalize_fish_species_other(body.get("fish_species_other"), led.fish_species)
    elif "fish_species" in body:
        led.fish_species_other = normalize_fish_species_other(None, led.fish_species)
    if "fish_count_delta" in body:
        try:
            led.fish_count_delta = int(body.get("fish_count_delta"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "fish_count_delta must be an integer"}, status=400)
    if "weight_kg_delta" in body:
        led.weight_kg_delta = _decimal(body.get("weight_kg_delta"), "0")
    if "book_value" in body:
        led.book_value = _money_q(_decimal(body.get("book_value"), "0"))
    if "memo" in body:
        led.memo = str(body.get("memo") or "")[:5000]
    if "production_cycle_id" in body:
        raw_cy = body.get("production_cycle_id")
        if raw_cy in (None, ""):
            led.production_cycle = None
        else:
            try:
                cy_id = int(raw_cy)
            except (TypeError, ValueError):
                return JsonResponse({"detail": "production_cycle_id must be an integer or null"}, status=400)
            cy = _cycle_for_company(cid, cy_id)
            if not cy:
                return JsonResponse({"detail": "Production cycle not found"}, status=404)
            if cy.pond_id != led.pond_id:
                return JsonResponse({"detail": "production_cycle_id does not belong to this row's pond"}, status=400)
            led.production_cycle = cy
    if "pond_id" in body:
        try:
            pid = int(body["pond_id"])
        except (TypeError, ValueError):
            return JsonResponse({"detail": "pond_id must be an integer"}, status=400)
        p2 = _pond_for_company(cid, pid)
        if not p2:
            return JsonResponse({"detail": "Pond not found"}, status=404)
        led.pond = p2
        if led.production_cycle_id and led.production_cycle.pond_id != p2.id:
            led.production_cycle = None

    led.save()
    led = AquacultureFishStockLedger.objects.filter(pk=led.pk).select_related("pond", "production_cycle", "journal_entry").first()
    return JsonResponse(_stock_ledger_to_json(led))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pl_summary(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    start = _parse_date(request.GET.get("start_date"))
    end = _parse_date(request.GET.get("end_date"))
    if not start or not end:
        return JsonResponse({"detail": "start_date and end_date are required (YYYY-MM-DD)"}, status=400)
    if start > end:
        return JsonResponse({"detail": "start_date must be on or before end_date"}, status=400)

    pond_filter_id = None
    raw_p = request.GET.get("pond_id")
    if raw_p and str(raw_p).strip().isdigit():
        pond_filter_id = int(raw_p)
        if not _pond_for_company(cid, pond_filter_id):
            return JsonResponse({"detail": "Pond not found"}, status=404)

    cycle_filter_id = None
    scoped_cycle = None
    raw_c = request.GET.get("cycle_id")
    if raw_c and str(raw_c).strip().isdigit():
        cycle_filter_id = int(raw_c)
        scoped_cycle = AquacultureProductionCycle.objects.filter(pk=cycle_filter_id, company_id=cid).first()
        if not scoped_cycle:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if pond_filter_id is not None and scoped_cycle.pond_id != pond_filter_id:
            return JsonResponse({"detail": "cycle_id does not belong to the selected pond"}, status=400)
        pond_filter_id = scoped_cycle.pond_id

    include_cycle_breakdown = str(request.GET.get("include_cycle_breakdown", "")).lower() in ("1", "true", "yes")

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        start,
        end,
        pond_filter_id,
        cycle_filter_id,
        scoped_cycle,
        include_cycle_breakdown,
    )
    return JsonResponse(payload)


def _profit_transfer_to_json(t: AquaculturePondProfitTransfer, *, include_journal: bool = False) -> dict:
    je = t.journal_entry
    cyc_id = getattr(t, "production_cycle_id", None)
    cyc_name = ""
    if cyc_id and getattr(t, "production_cycle", None):
        cyc_name = (t.production_cycle.name or "").strip()
    out = {
        "id": t.id,
        "pond_id": t.pond_id,
        "pond_name": (t.pond.name or "") if t.pond_id else "",
        "production_cycle_id": cyc_id,
        "production_cycle_name": cyc_name,
        "transfer_date": t.transfer_date.isoformat(),
        "amount": str(t.amount),
        "debit_account_id": t.debit_account_id,
        "debit_account_code": (t.debit_account.account_code or "") if t.debit_account_id else "",
        "debit_account_name": (t.debit_account.account_name or "") if t.debit_account_id else "",
        "credit_account_id": t.credit_account_id,
        "credit_account_code": (t.credit_account.account_code or "") if t.credit_account_id else "",
        "credit_account_name": (t.credit_account.account_name or "") if t.credit_account_id else "",
        "memo": t.memo or "",
        "journal_entry_id": t.journal_entry_id,
        "journal_is_posted": bool(je.is_posted) if je else False,
        "journal_entry_number": (je.entry_number or "") if je else "",
    }
    if include_journal:
        out["journal_entry"] = _entry_to_json(je) if je else None
    return out


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_pond_profit_transfers(request):
    """
    GET: recent pond-scoped profit transfers (each posts Dr/Cr to chosen GL accounts).
    POST: create balanced journal (optionally posted) and link audit row to the pond.
    """
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquaculturePondProfitTransfer.objects.filter(company_id=cid)
            .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
            .order_by("-transfer_date", "-id")[:200]
        )
        return JsonResponse([_profit_transfer_to_json(t, include_journal=False) for t in qs], safe=False)

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        pond_id = int(body.get("pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "pond_id is required and must be an integer"}, status=400)
    pond = _pond_for_company(cid, pond_id)
    if not pond:
        return JsonResponse({"detail": "Pond not found"}, status=404)
    cycle_obj = None
    raw_cy = body.get("production_cycle_id")
    if raw_cy not in (None, ""):
        try:
            cy_id = int(raw_cy)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "production_cycle_id must be an integer"}, status=400)
        cycle_obj = _cycle_for_company(cid, cy_id)
        if not cycle_obj:
            return JsonResponse({"detail": "Production cycle not found"}, status=404)
        if cycle_obj.pond_id != pond.id:
            return JsonResponse({"detail": "production_cycle_id does not belong to the selected pond"}, status=400)
    td = _parse_date(body.get("transfer_date"))
    if not td:
        return JsonResponse({"detail": "transfer_date is required (YYYY-MM-DD)"}, status=400)
    amt = _decimal(body.get("amount"))
    if amt <= 0:
        return JsonResponse({"detail": "amount must be greater than zero"}, status=400)
    amt = amt.quantize(Decimal("0.01"))
    try:
        debit_id = int(body.get("debit_account_id"))
        credit_id = int(body.get("credit_account_id"))
    except (TypeError, ValueError):
        return JsonResponse(
            {"detail": "debit_account_id and credit_account_id are required integers"},
            status=400,
        )
    if debit_id == credit_id:
        return JsonResponse({"detail": "Debit and credit accounts must differ"}, status=400)
    dr = ChartOfAccount.objects.filter(pk=debit_id, company_id=cid).first()
    cr = ChartOfAccount.objects.filter(pk=credit_id, company_id=cid).first()
    if not dr or not cr:
        return JsonResponse({"detail": "One or both GL accounts were not found for this company"}, status=400)
    memo = (body.get("memo") or "")[:5000]
    do_post = body.get("post")
    if do_post is None:
        do_post = True
    else:
        do_post = bool(do_post)

    pond_label = (pond.name or "").strip() or f"Pond #{pond.id}"
    cycle_bit = f" ({cycle_obj.name})" if cycle_obj else ""
    desc = (body.get("description") or "").strip()
    if not desc:
        desc = f"Aquaculture pond profit transfer — {pond_label}{cycle_bit}"
    desc = desc[:500]

    with transaction.atomic():
        count = JournalEntry.objects.filter(company_id=cid).count()
        je = JournalEntry(
            company_id=cid,
            entry_number=f"JE-{count + 1}",
            entry_date=td,
            description=desc,
            station_id=None,
            is_posted=False,
            posted_at=None,
        )
        je.save()
        line_desc = (memo or desc)[:300]
        JournalEntryLine.objects.create(
            journal_entry=je,
            account_id=debit_id,
            debit=amt,
            credit=Decimal("0"),
            description=line_desc,
            station_id=None,
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account_id=credit_id,
            debit=Decimal("0"),
            credit=amt,
            description=line_desc,
            station_id=None,
        )
        xfer = AquaculturePondProfitTransfer(
            company_id=cid,
            pond=pond,
            production_cycle=cycle_obj,
            transfer_date=td,
            amount=amt,
            debit_account_id=debit_id,
            credit_account_id=credit_id,
            memo=memo,
            journal_entry=je,
        )
        xfer.save()
        if do_post:
            je.is_posted = True
            je.posted_at = django_timezone.now()
            je.save()

    xfer = (
        AquaculturePondProfitTransfer.objects.filter(pk=xfer.pk)
        .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
        .prefetch_related(
            "journal_entry__lines",
            "journal_entry__lines__account",
            "journal_entry__lines__station",
            "journal_entry__station",
        )
        .first()
    )
    return JsonResponse(_profit_transfer_to_json(xfer, include_journal=True), status=201)


def _fish_transfer_line_to_json(line: AquacultureFishPondTransferLine) -> dict:
    cname = ""
    if line.to_production_cycle_id and getattr(line, "to_production_cycle", None):
        cname = (line.to_production_cycle.name or "").strip()
    tpname = ""
    if getattr(line, "to_pond", None):
        tpname = (line.to_pond.name or "").strip()
    return {
        "id": line.id,
        "to_pond_id": line.to_pond_id,
        "to_pond_name": tpname,
        "to_production_cycle_id": line.to_production_cycle_id,
        "to_production_cycle_name": cname,
        "weight_kg": str(line.weight_kg),
        "fish_count": line.fish_count,
        "pcs_per_kg": str(line.pcs_per_kg) if line.pcs_per_kg is not None else None,
        "cost_amount": str(_money_q(line.cost_amount or Decimal(0))),
    }


def _fish_transfer_to_json(t: AquacultureFishPondTransfer) -> dict:
    from_name = (t.from_pond.name or "").strip() if getattr(t, "from_pond", None) else ""
    fcname = ""
    if t.from_production_cycle_id and getattr(t, "from_production_cycle", None):
        fcname = (t.from_production_cycle.name or "").strip()
    lines = [_fish_transfer_line_to_json(x) for x in t.lines.all()]
    return {
        "id": t.id,
        "company_id": t.company_id,
        "from_pond_id": t.from_pond_id,
        "from_pond_name": from_name,
        "from_production_cycle_id": t.from_production_cycle_id,
        "from_production_cycle_name": fcname,
        "transfer_date": t.transfer_date.isoformat(),
        "fish_species": t.fish_species or "tilapia",
        "fish_species_label": fish_species_display_label(t.fish_species, t.fish_species_other),
        "fish_species_other": t.fish_species_other or "",
        "memo": t.memo or "",
        "lines": lines,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def aquaculture_pond_roles_reference(request):
    err = _aquaculture_access(request)
    if err:
        return err
    return JsonResponse(
        [{"id": c, "label": lbl} for c, lbl in AQUACULTURE_POND_ROLE_CHOICES],
        safe=False,
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
@require_company_id
def aquaculture_fish_pond_transfers(request):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    if request.method == "GET":
        qs = (
            AquacultureFishPondTransfer.objects.filter(company_id=cid)
            .select_related("from_pond", "from_production_cycle")
            .prefetch_related("lines__to_pond", "lines__to_production_cycle")
            .order_by("-transfer_date", "-id")
        )
        fp = request.GET.get("from_pond_id")
        if fp and str(fp).strip().isdigit():
            qs = qs.filter(from_pond_id=int(fp))
        tp = request.GET.get("to_pond_id")
        if tp and str(tp).strip().isdigit():
            qs = qs.filter(lines__to_pond_id=int(tp)).distinct()
        qs = qs[:300]
        return JsonResponse(
            {
                "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
                "transfers": [_fish_transfer_to_json(t) for t in qs],
            }
        )

    body, e = parse_json_body(request)
    if e:
        return e
    try:
        from_pond_id = int(body.get("from_pond_id"))
    except (TypeError, ValueError):
        return JsonResponse({"detail": "from_pond_id is required and must be an integer"}, status=400)
    from_pond = _pond_for_company(cid, from_pond_id)
    if not from_pond:
        return JsonResponse({"detail": "from_pond not found"}, status=404)
    td = _parse_date(body.get("transfer_date"))
    if not td:
        return JsonResponse({"detail": "transfer_date is required (YYYY-MM-DD)"}, status=400)
    sp, sperr = normalize_fish_species(body.get("fish_species"))
    if sperr:
        return JsonResponse({"detail": sperr}, status=400)
    sp_other = normalize_fish_species_other(body.get("fish_species_other"), sp)
    from_cycle_obj = None
    raw_fc = body.get("from_production_cycle_id")
    if raw_fc not in (None, ""):
        try:
            fcy = int(raw_fc)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "from_production_cycle_id must be an integer or null"}, status=400)
        from_cycle_obj = AquacultureProductionCycle.objects.filter(
            pk=fcy, company_id=cid, pond_id=from_pond_id
        ).first()
        if not from_cycle_obj:
            return JsonResponse({"detail": "from_production_cycle_id not found for this pond"}, status=404)
    raw_lines = body.get("lines")
    if not isinstance(raw_lines, list) or len(raw_lines) == 0:
        return JsonResponse({"detail": "lines must be a non-empty array"}, status=400)

    memo = str(body.get("memo") or "")[:5000]
    line_models: list[AquacultureFishPondTransferLine] = []
    for i, row in enumerate(raw_lines):
        if not isinstance(row, dict):
            return JsonResponse({"detail": f"lines[{i}] must be an object"}, status=400)
        try:
            to_pond_id = int(row.get("to_pond_id"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": f"lines[{i}].to_pond_id is required (integer)"}, status=400)
        if to_pond_id == from_pond_id:
            return JsonResponse({"detail": f"lines[{i}].to_pond_id must differ from from_pond_id"}, status=400)
        to_pond = _pond_for_company(cid, to_pond_id)
        if not to_pond:
            return JsonResponse({"detail": f"lines[{i}].to_pond not found"}, status=404)
        wk = _decimal(row.get("weight_kg"))
        if wk <= 0:
            return JsonResponse({"detail": f"lines[{i}].weight_kg must be greater than zero"}, status=400)
        cost_amt = _money_q(_decimal(row.get("cost_amount"), "0"))
        if cost_amt < 0:
            return JsonResponse({"detail": f"lines[{i}].cost_amount cannot be negative"}, status=400)
        fc_raw = row.get("to_production_cycle_id")
        to_cycle = None
        if fc_raw not in (None, ""):
            try:
                tcy = int(fc_raw)
            except (TypeError, ValueError):
                return JsonResponse({"detail": f"lines[{i}].to_production_cycle_id must be integer or null"}, status=400)
            to_cycle = AquacultureProductionCycle.objects.filter(
                pk=tcy, company_id=cid, pond_id=to_pond_id
            ).first()
            if not to_cycle:
                return JsonResponse({"detail": f"lines[{i}].to_production_cycle_id not found for destination pond"}, status=404)
        fcount = row.get("fish_count")
        fcount_i = None
        if fcount not in (None, ""):
            try:
                fcount_i = int(fcount)
            except (TypeError, ValueError):
                return JsonResponse({"detail": f"lines[{i}].fish_count must be an integer or null"}, status=400)
            if fcount_i < 0:
                return JsonResponse({"detail": f"lines[{i}].fish_count cannot be negative"}, status=400)
        pcs_raw = row.get("pcs_per_kg")
        pcs_dec = None
        if pcs_raw not in (None, ""):
            pcs_dec = _decimal(pcs_raw)
            if pcs_dec < 0:
                return JsonResponse({"detail": f"lines[{i}].pcs_per_kg cannot be negative"}, status=400)
        line_models.append(
            AquacultureFishPondTransferLine(
                to_pond=to_pond,
                to_production_cycle=to_cycle,
                weight_kg=wk,
                fish_count=fcount_i,
                pcs_per_kg=pcs_dec,
                cost_amount=cost_amt,
            )
        )

    with transaction.atomic():
        xfer = AquacultureFishPondTransfer(
            company_id=cid,
            from_pond=from_pond,
            from_production_cycle=from_cycle_obj,
            transfer_date=td,
            fish_species=sp,
            fish_species_other=sp_other,
            memo=memo,
        )
        xfer.save()
        for ln in line_models:
            ln.transfer = xfer
            ln.save()

    xfer = (
        AquacultureFishPondTransfer.objects.filter(pk=xfer.pk)
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .first()
    )
    return JsonResponse(
        {
            "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
            "transfer": _fish_transfer_to_json(xfer),
        },
        status=201,
    )


@csrf_exempt
@require_http_methods(["GET", "DELETE"])
@auth_required
@require_company_id
def aquaculture_fish_pond_transfer_detail(request, transfer_id: int):
    err = _aquaculture_access(request)
    if err:
        return err
    cid = request.company_id
    t = (
        AquacultureFishPondTransfer.objects.filter(pk=transfer_id, company_id=cid)
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .first()
    )
    if not t:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(
            {
                "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
                "transfer": _fish_transfer_to_json(t),
            }
        )
    t.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)
