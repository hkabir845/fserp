"""Bills API: list, create, get, update, delete (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q, Sum
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.exceptions import GlPostingError, StockBusinessError
from api.models import (
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    BillLine,
    Item,
    PaymentBillAllocation,
    Station,
    Tank,
    Vendor,
)
from api.services.aquaculture_constants import (
    fish_species_display_label,
    normalize_fish_species,
    normalize_fish_species_other,
)
from api.services.aquaculture_pond_display import bill_line_pond_display_name
from api.services.aquaculture_production_cycle_service import (
    assign_auto_production_cycles_for_parsed_bill_lines,
    repair_stale_aquaculture_bill_line_cycles,
)
from api.services.station_capabilities import require_fuel_forecourt_station
from api.services.station_stock import receipt_station_id_for_vendor
from api.services.document_posting_lifecycle import (
    assert_bill_edit_allowed,
    body_has_material_bill_change,
    reconcile_bill_after_material_edit,
)
from api.services.gl_posting import (
    bill_eligible_for_posting,
    cleanup_vendor_bill_posting_effects,
    sync_posted_vendor_bill,
    undo_bill_stock_receipt,
)
from api.utils.auth import auth_required
from api.utils.pagination import json_paged, parse_skip_limit, wants_paged_response
from api.utils.transaction_filters import (
    apply_transaction_amount_range,
    apply_transaction_date_range,
)
from api.views.common import parse_json_body, require_company_id, _serialize_quantity
from api.services.aquaculture_bill_defaults import (
    apply_aquaculture_expense_category_to_bill_line_row,
    expense_category_from_cost_bucket,
    validate_and_apply_shared_pond_bill_line_category,
)
from api.services.bill_purpose_validation import (
    infer_bill_purpose_from_parsed_lines,
    parse_bill_purpose,
    validate_parsed_lines_for_bill_purpose,
)
from api.services.fuel_station_bill_defaults import apply_fuel_station_category_to_bill_line_row
from api.services.aquaculture_bill_pond_share import (
    bill_line_cost_mode,
    expand_parsed_bill_line_for_pond_share,
)
from api.services.station_bill_share import (
    expand_parsed_bill_line_for_station_share,
    parse_optional_line_receipt_station_id,
    station_bill_line_cost_mode,
)
from api.services.coa_gl_defaults import ALLOWED_BILL_EXPENSE_DEBIT, parse_optional_chart_account_id
from api.services.tenant_reporting_categories import (
    FUEL_STATION_EXPENSE_MAP_TARGETS,
    tenant_expense_row,
    APP_FUEL_STATION,
)


def _next_bill_number(company_id: int) -> str:
    """Next BILL-n: lowest free suffix (reuses gaps when a bill number is deleted)."""
    from api.services.reference_code import next_available_code

    return next_available_code(company_id, Bill, "bill_number", "BILL")


def _bill_line_aquaculture_expense_category(line: BillLine) -> str | None:
    trc = getattr(line, "tenant_reporting_category", None)
    if trc and getattr(trc, "application", None) == "aquaculture" and getattr(trc, "code", None):
        return (trc.code or "").strip() or None
    return expense_category_from_cost_bucket(getattr(line, "aquaculture_cost_bucket", None))


def _bill_line_tenant_reporting_label(line: BillLine) -> str:
    trc = getattr(line, "tenant_reporting_category", None)
    if trc and getattr(trc, "label", None):
        return (trc.label or "").strip()
    return ""


def _fuel_station_category_label(company_id: int, code: str, trc) -> str:
    if trc and getattr(trc, "label", None):
        return (trc.label or "").strip()
    c = (code or "").strip()
    if not c:
        return ""
    for key, lbl in FUEL_STATION_EXPENSE_MAP_TARGETS:
        if key == c:
            return lbl
    row = tenant_expense_row(company_id, APP_FUEL_STATION, c)
    return (row.label or "").strip() if row else c.replace("_", " ").title()


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _amount_paid(bill: Bill) -> Decimal:
    cache = getattr(bill, "_prefetched_objects_cache", None)
    if cache and "payment_allocations" in cache:
        return sum(
            (a.amount for a in bill.payment_allocations.all()),
            start=Decimal("0"),
        )
    agg = PaymentBillAllocation.objects.filter(bill_id=bill.id).aggregate(t=Sum("amount"))
    return agg["t"] or Decimal("0")


def _balance_due(bill: Bill) -> Decimal:
    total = bill.total or Decimal("0")
    paid = _amount_paid(bill)
    return max(Decimal("0"), total - paid)


def _refresh_bill_totals_from_lines(bill: Bill) -> None:
    """Subtotal = sum(line amounts); total = subtotal + header tax_total."""
    sub = bill.lines.aggregate(s=Sum("amount"))["s"] or Decimal("0")
    tax = bill.tax_total or Decimal("0")
    bill.subtotal = sub
    bill.total = sub + tax
    bill.save(update_fields=["subtotal", "total", "updated_at"])


def _drop_invalid_bill_line_expense_account_id(company_id: int, row: dict) -> None:
    """
    Clear stale client expense_account_id so pond/fuel category defaults can refill.
    Vendor bills only accept active expense / COGS accounts for this company.
    """
    raw = row.get("expense_account_id")
    if raw in (None, ""):
        return
    eid, err = parse_optional_chart_account_id(
        company_id,
        raw,
        allowed_normalized_types=ALLOWED_BILL_EXPENSE_DEBIT,
        field_label="expense_account_id",
    )
    if err:
        row["expense_account_id"] = None
    else:
        row["expense_account_id"] = eid


def _parse_bill_lines_from_body(
    company_id: int, lines_body: list | None
) -> tuple[list[dict], JsonResponse | None]:
    """Parse request line rows into BillLine create kwargs (with optional pond-share expansion)."""
    parsed_lines: list[dict] = []
    for row in lines_body or []:
        _drop_invalid_bill_line_expense_account_id(company_id, row)
        shared_err = validate_and_apply_shared_pond_bill_line_category(company_id, row)
        if shared_err:
            return [], JsonResponse({"detail": shared_err}, status=400)
        cat_err = apply_aquaculture_expense_category_to_bill_line_row(company_id, row)
        if cat_err:
            return [], JsonResponse({"detail": cat_err}, status=400)
        fs_err = apply_fuel_station_category_to_bill_line_row(company_id, row)
        if fs_err:
            return [], JsonResponse({"detail": fs_err}, status=400)
        computed_amt = _decimal(row.get("quantity"), 1) * _decimal(
            row.get("unit_cost", row.get("unit_price")), 0
        )
        raw_amt = row.get("amount")
        if raw_amt is None or raw_amt == "":
            amt = computed_amt
        else:
            amt = _decimal(raw_amt, computed_amt)
            if amt == 0 and computed_amt > 0:
                amt = computed_amt
        item_id = _coerce_item_id(row)
        tank_id, terr = _coerce_line_tank_id(company_id, row, item_id)
        if terr:
            return [], terr
        aq_kw, aq_err = _parse_bill_line_aquaculture(company_id, row)
        if aq_err:
            return [], aq_err
        assert aq_kw is not None
        fish_kw, fish_err = _parse_bill_line_fish_dims(company_id, row, item_id)
        if fish_err:
            return [], fish_err
        assert fish_kw is not None
        eid, eerr = parse_optional_chart_account_id(
            company_id,
            row.get("expense_account_id"),
            allowed_normalized_types=ALLOWED_BILL_EXPENSE_DEBIT,
            field_label="expense_account_id",
        )
        if eerr:
            return [], JsonResponse({"detail": eerr}, status=400)
        line_sid, sid_err = parse_optional_line_receipt_station_id(company_id, row)
        if sid_err:
            return [], JsonResponse({"detail": sid_err}, status=400)
        pl = {
            "item_id": item_id,
            "tank_id": tank_id,
            "description": row.get("description") or "",
            "quantity": _bill_line_quantity_from_row(company_id, item_id, row, fish_kw),
            "unit_price": _decimal(row.get("unit_cost", row.get("unit_price")), 0),
            "amount": amt,
            "expense_account_id": eid,
            "fuel_station_expense_category": (row.get("fuel_station_expense_category") or "")[:64],
            "tenant_reporting_category_id": row.get("tenant_reporting_category_id"),
            "receipt_station_id": line_sid,
            **aq_kw,
            **fish_kw,
        }
        bucket = str(row.get("aquaculture_cost_bucket") or "").strip()[:40]
        if bucket:
            pl["aquaculture_cost_bucket"] = bucket
        pmode = bill_line_cost_mode(row)
        smode = station_bill_line_cost_mode(row)
        if pmode in ("shared_equal", "shared_manual") and smode in (
            "shared_equal",
            "shared_manual",
        ):
            return [], JsonResponse(
                {
                    "detail": "Use either pond shared split or station shared split on a line, not both.",
                },
                status=400,
            )
        if pmode in ("shared_equal", "shared_manual"):
            expanded, exp_err = expand_parsed_bill_line_for_pond_share(company_id, row, pl)
        elif smode in ("shared_equal", "shared_manual"):
            expanded, exp_err = expand_parsed_bill_line_for_station_share(company_id, row, pl)
        else:
            expanded, exp_err = [pl], None
        if exp_err:
            return [], exp_err
        parsed_lines.extend(expanded)
    return parsed_lines, None


def _parse_bill_line_aquaculture(company_id: int, row: dict):
    """
    Optional pond/cycle/bucket on a bill line for aquaculture P&L (posted to GL journal lines).
    Returns (kwargs_dict, error_response_or_None).
    """
    raw_p = row.get("aquaculture_pond_id")
    raw_c = row.get("aquaculture_production_cycle_id")
    bucket = str(row.get("aquaculture_cost_bucket") or "").strip()[:40]
    if raw_p in (None, ""):
        if raw_c not in (None, ""):
            return None, JsonResponse(
                {"detail": "aquaculture_production_cycle_id requires aquaculture_pond_id"},
                status=400,
            )
        return {
            "aquaculture_pond_id": None,
            "aquaculture_production_cycle_id": None,
            "aquaculture_cost_bucket": "",
        }, None
    try:
        pid = int(raw_p)
    except (TypeError, ValueError):
        return None, JsonResponse({"detail": "aquaculture_pond_id must be an integer"}, status=400)
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
        return None, JsonResponse(
            {"detail": "Unknown aquaculture_pond_id for this company"},
            status=400,
        )
    cid = None
    if raw_c not in (None, ""):
        try:
            cid = int(raw_c)
        except (TypeError, ValueError):
            return None, JsonResponse(
                {"detail": "aquaculture_production_cycle_id must be an integer"},
                status=400,
            )
        cyc = AquacultureProductionCycle.objects.filter(pk=cid, company_id=company_id).first()
        if not cyc or cyc.pond_id != pid:
            return None, JsonResponse(
                {
                    "detail": "aquaculture_production_cycle_id must belong to aquaculture_pond_id",
                },
                status=400,
            )
    return {
        "aquaculture_pond_id": pid,
        "aquaculture_production_cycle_id": cid,
        "aquaculture_cost_bucket": bucket,
    }, None


def _parse_bill_line_fish_dims(request_company_id: int, row: dict, item_id: Optional[int]):
    """
    Weight (kg) and headcount are required for Item.pos_category == 'fish' lines (both must be > 0).
    When the item has Line (pieces_per_kg), headcount and line amount are the user inputs: weight (kg)
    is heads ÷ Line; billing quantity is that kg (stored on the line for AP).
    Ignored (stored null) for other items. Returns (kwargs_dict, error_response_or_None).
    """
    w_raw = row.get("aquaculture_fish_weight_kg")
    c_raw = row.get("aquaculture_fish_count")

    def _empty():
        return {
            "aquaculture_fish_weight_kg": None,
            "aquaculture_fish_count": None,
            "aquaculture_fish_species": "",
            "aquaculture_fish_species_other": "",
        }, None

    if not item_id:
        if w_raw not in (None, "") or c_raw not in (None, ""):
            return None, JsonResponse(
                {"detail": "aquaculture_fish_weight_kg / aquaculture_fish_count require an item line"},
                status=400,
            )
        return _empty()

    item = Item.objects.filter(pk=item_id, company_id=request_company_id).only(
        "pos_category", "pieces_per_kg"
    ).first()
    if not item:
        return None, JsonResponse({"detail": "Unknown item_id for this company"}, status=400)

    if (item.pos_category or "").strip().lower() != "fish":
        return _empty()

    # Fish purchase lines must stock into a pond and carry an explicit species.
    raw_pond = row.get("aquaculture_pond_id")
    if raw_pond is None or str(raw_pond).strip() == "":
        return None, JsonResponse(
            {"detail": "Fish purchase lines must stock into a pond (choose a destination pond)."},
            status=400,
        )
    raw_species = row.get("aquaculture_fish_species")
    if raw_species is None or str(raw_species).strip() == "":
        return None, JsonResponse(
            {"detail": "Fish purchase lines require a species (e.g. tilapia, rui, pangas)."},
            status=400,
        )
    sp_code, sp_err = normalize_fish_species(raw_species)
    if sp_err:
        return None, JsonResponse({"detail": sp_err}, status=400)
    if sp_code == "not_applicable":
        return None, JsonResponse(
            {"detail": "Choose a fish species for a fish purchase line."},
            status=400,
        )
    sp_other = normalize_fish_species_other(row.get("aquaculture_fish_species_other"), sp_code)
    species_kw = {
        "aquaculture_fish_species": sp_code,
        "aquaculture_fish_species_other": sp_other,
    }

    ppk = getattr(item, "pieces_per_kg", None)
    if ppk is not None and ppk > 0:
        try:
            fish_n = int(c_raw)
        except (TypeError, ValueError):
            return None, JsonResponse(
                {
                    "detail": "Fish items with Line (pieces per kg) require aquaculture_fish_count "
                    "(total heads, greater than zero).",
                },
                status=400,
            )
        if fish_n <= 0:
            return None, JsonResponse(
                {
                    "detail": "aquaculture_fish_count must be greater than zero for fish items with Line.",
                },
                status=400,
            )
        fish_kg = (Decimal(fish_n) / ppk).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        if fish_kg <= 0:
            return None, JsonResponse(
                {"detail": "Derived weight (kg) must be greater than zero."},
                status=400,
            )
        return {
            "aquaculture_fish_weight_kg": fish_kg,
            "aquaculture_fish_count": fish_n,
            **species_kw,
        }, None

    if w_raw in (None, "") or c_raw in (None, ""):
        return None, JsonResponse(
            {
                "detail": "Fish-type bill lines require aquaculture_fish_weight_kg and aquaculture_fish_count "
                "(both greater than zero).",
            },
            status=400,
        )

    fish_kg = _decimal(w_raw, None)
    if fish_kg is None:
        return None, JsonResponse(
            {"detail": "aquaculture_fish_weight_kg must be a number"},
            status=400,
        )
    if fish_kg <= 0:
        return None, JsonResponse(
            {"detail": "aquaculture_fish_weight_kg must be greater than zero"},
            status=400,
        )

    try:
        fish_n = int(c_raw)
    except (TypeError, ValueError):
        return None, JsonResponse(
            {"detail": "aquaculture_fish_count must be an integer"},
            status=400,
        )
    if fish_n <= 0:
        return None, JsonResponse(
            {"detail": "aquaculture_fish_count must be greater than zero"},
            status=400,
        )

    return {
        "aquaculture_fish_weight_kg": fish_kg,
        "aquaculture_fish_count": fish_n,
        **species_kw,
    }, None


def _bill_line_quantity_from_row(
    request_company_id: int,
    item_id: Optional[int],
    row: dict,
    fish_kw: dict,
) -> Decimal:
    """AP quantity: for fish items with Line, billing kg equals derived weight from heads."""
    qty = _decimal(row.get("quantity"), 1)
    w = fish_kw.get("aquaculture_fish_weight_kg")
    if not item_id or w is None:
        return qty
    item = Item.objects.filter(pk=item_id, company_id=request_company_id).only("pieces_per_kg").first()
    if item and getattr(item, "pieces_per_kg", None) and item.pieces_per_kg > 0:
        return w
    return qty


def _bill_line_to_json(b: Bill, l: BillLine) -> dict:
    item = getattr(l, "item", None) if getattr(l, "item_id", None) else None
    pond = getattr(l, "aquaculture_pond", None) if getattr(l, "aquaculture_pond_id", None) else None
    cycle = (
        getattr(l, "aquaculture_production_cycle", None)
        if getattr(l, "aquaculture_production_cycle_id", None)
        else None
    )
    return {
        "id": l.id,
        "line_number": getattr(l, "line_number", 0),
        "item_id": l.item_id,
        "item_name": ((item.name or "").strip() if item else ""),
        "item_pos_category": ((item.pos_category or "").strip() if item else ""),
        "item_pieces_per_kg": (
            _serialize_quantity(item.pieces_per_kg)
            if item and getattr(item, "pieces_per_kg", None) is not None
            else None
        ),
        "description": l.description or "",
        "quantity": _serialize_quantity(l.quantity),
        "unit_price": str(l.unit_price),
        "unit_cost": str(l.unit_price),
        "amount": str(l.amount),
        "expense_account_id": getattr(l, "expense_account_id", None),
        "tank_id": getattr(l, "tank_id", None),
        "tank_name": (
            l.tank.tank_name
            if getattr(l, "tank_id", None) and getattr(l, "tank", None)
            else None
        ),
        "tax_amount": str(getattr(l, "tax_amount", 0)),
        "aquaculture_pond_id": getattr(l, "aquaculture_pond_id", None),
        "pond_name": ((pond.name or "").strip() if pond else ""),
        "pond_display_name": bill_line_pond_display_name(pond, l) if pond else "",
        "aquaculture_production_cycle_id": getattr(l, "aquaculture_production_cycle_id", None),
        "cycle_name": ((cycle.name or "").strip() if cycle else ""),
        "aquaculture_cost_bucket": (getattr(l, "aquaculture_cost_bucket", None) or "")[:40],
        "aquaculture_expense_category": _bill_line_aquaculture_expense_category(l),
        "tenant_reporting_category_id": getattr(l, "tenant_reporting_category_id", None),
        "tenant_reporting_category_label": _bill_line_tenant_reporting_label(l),
        "aquaculture_fish_weight_kg": (
            str(l.aquaculture_fish_weight_kg)
            if getattr(l, "aquaculture_fish_weight_kg", None) is not None
            else None
        ),
        "aquaculture_fish_count": getattr(l, "aquaculture_fish_count", None),
        "aquaculture_fish_species": getattr(l, "aquaculture_fish_species", "") or "",
        "aquaculture_fish_species_other": getattr(l, "aquaculture_fish_species_other", "") or "",
        "aquaculture_fish_species_label": (
            fish_species_display_label(
                getattr(l, "aquaculture_fish_species", "") or "",
                getattr(l, "aquaculture_fish_species_other", "") or "",
            )
            if (getattr(l, "aquaculture_fish_species", "") or "")
            else ""
        ),
        "expense_account_code": (
            (l.expense_account.account_code or "").strip()
            if getattr(l, "expense_account_id", None) and getattr(l, "expense_account", None)
            else ""
        ),
        "expense_account_name": (
            (l.expense_account.account_name or "").strip()
            if getattr(l, "expense_account_id", None) and getattr(l, "expense_account", None)
            else ""
        ),
        "fuel_station_expense_category": (
            getattr(l, "fuel_station_expense_category", None) or ""
        )[:64],
        "line_receipt_station_id": getattr(l, "receipt_station_id", None),
        "receipt_station_id": getattr(l, "receipt_station_id", None),
        "fuel_station_expense_category_label": _fuel_station_category_label(
            b.company_id,
            getattr(l, "fuel_station_expense_category", None) or "",
            getattr(l, "tenant_reporting_category", None),
        ),
    }


def _bill_receipt_pond_summary(b) -> tuple[int | None, str]:
    """When all tagged lines share one pond, surface it on list responses (lines omitted)."""
    pond_by_id: dict[int, str] = {}
    for line in b.lines.all():
        pid = getattr(line, "aquaculture_pond_id", None)
        if not pid:
            continue
        pond = getattr(line, "aquaculture_pond", None)
        label = bill_line_pond_display_name(pond, line) if pond else ""
        pond_by_id[int(pid)] = label or (pond.name.strip() if pond and pond.name else f"Pond #{pid}")
    if len(pond_by_id) == 1:
        pid, label = next(iter(pond_by_id.items()))
        return pid, label
    return None, ""


def _bill_to_json(b, *, include_lines: bool = True):
    total = b.total or Decimal("0")
    tax = b.tax_total or Decimal("0")
    sub = b.subtotal or Decimal("0")
    paid = _amount_paid(b)
    bal = _balance_due(b)
    payload = {
        "id": b.id,
        "bill_number": b.bill_number,
        "bill_date": _serialize_date(b.bill_date),
        "due_date": _serialize_date(b.due_date),
        "vendor_id": b.vendor_id,
        "vendor_name": (
            (b.vendor.display_name or b.vendor.company_name or "").strip()
            if b.vendor_id and getattr(b, "vendor", None)
            else ""
        ),
        "receipt_station_id": getattr(b, "receipt_station_id", None),
        "receipt_station_name": (
            b.receipt_station.station_name
            if getattr(b, "receipt_station_id", None) and getattr(b, "receipt_station", None)
            else ""
        ),
        "vendor_reference": getattr(b, "vendor_reference", "") or "",
        "memo": getattr(b, "memo", "") or "",
        "status": b.status,
        "subtotal": str(sub),
        "tax_total": str(tax),
        "total": str(total),
        # Frontend-friendly aliases (QuickBooks / Xero style)
        "tax_amount": str(tax),
        "total_amount": str(total),
        "amount_paid": str(paid),
        "balance_due": str(bal),
    }
    if not include_lines:
        receipt_pond_id, receipt_pond_display_name = _bill_receipt_pond_summary(b)
        payload["receipt_pond_id"] = receipt_pond_id
        payload["receipt_pond_display_name"] = receipt_pond_display_name
        payload["lines"] = []
        return payload
    lines = list(
        b.lines.all().select_related(
            "item",
            "tank",
            "aquaculture_pond",
            "aquaculture_production_cycle",
            "expense_account",
            "tenant_reporting_category",
        )
    )
    payload["lines"] = [_bill_line_to_json(b, l) for l in lines]
    return payload


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


def _normalize_due_date(bill_date: date, due: Optional[date]) -> Optional[date]:
    if due is None:
        return None
    if bill_date and due < bill_date:
        return bill_date
    return due


def _normalize_bill_status(val: Optional[str], fallback: str = "draft") -> str:
    """Map UI/accounting aliases to stored status; only known values are kept."""
    s = (val or fallback or "draft").strip().lower()[:32]
    aliases = {
        "partially_paid": "partial",
        "approved": "open",
        "posted": "open",
    }
    s = aliases.get(s, s)
    allowed = ("draft", "open", "paid", "partial", "overdue", "void")
    return s if s in allowed else "draft"


def _coerce_item_id(row: dict) -> Optional[int]:
    raw = row.get("item_id")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _acknowledge_tank_overfill_from_body(body: dict) -> bool:
    """True when client confirms receiving fuel beyond tank capacity (e.g. drums)."""
    v = body.get("acknowledge_tank_overfill")
    if v is True:
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "1", "yes", "on"):
        return True
    return False


def _coerce_line_tank_id(company_id: int, row: dict, item_id: Optional[int]):
    raw = row.get("tank_id")
    if raw is None or raw == "":
        return None, None
    try:
        tid = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse({"detail": "Invalid tank_id"}, status=400)
    if not item_id:
        return None, JsonResponse(
            {"detail": "tank_id requires item_id on the line"}, status=400
        )
    tank = Tank.objects.filter(id=tid, company_id=company_id, is_active=True).select_related("station").first()
    if not tank:
        return None, JsonResponse(
            {"detail": "Unknown or inactive tank for this company"}, status=400
        )
    fuel_err = require_fuel_forecourt_station(company_id, tank.station_id)
    if fuel_err:
        return None, fuel_err
    if tank.product_id != item_id:
        return None, JsonResponse(
            {"detail": "Tank does not match the line item"}, status=400
        )
    return tid, None


@csrf_exempt
@auth_required
@require_company_id
def bills_list_or_create(request):
    if request.method == "GET":
        return _bills_list(request)
    if request.method == "POST":
        return bills_create(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _bills_list(request):
    pond_line_qs = BillLine.objects.filter(aquaculture_pond_id__isnull=False).select_related(
        "aquaculture_pond", "item"
    )
    qs = (
        Bill.objects.filter(company_id=request.company_id)
        .select_related("vendor", "receipt_station")
        .prefetch_related(
            Prefetch("lines", queryset=pond_line_qs),
            "payment_allocations",
        )
        .order_by("-bill_date", "-id")
    )
    status_filter = request.GET.get("status_filter", "").strip()
    if status_filter:
        qs = qs.filter(status=status_filter)
    qs = apply_transaction_date_range(qs, request, "bill_date")
    qs = apply_transaction_amount_range(qs, request, "total")
    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(bill_number__icontains=q)
            | Q(vendor_reference__icontains=q)
            | Q(memo__icontains=q)
            | Q(vendor__company_name__icontains=q)
        )
    if wants_paged_response(request):
        skip, limit = parse_skip_limit(request, default_limit=25, max_limit=200)
        total = qs.count()
        page = qs[skip : skip + limit]
        return json_paged(
            [_bill_to_json(b, include_lines=False) for b in page],
            total=total,
            skip=skip,
            limit=limit,
        )
    return JsonResponse([_bill_to_json(b, include_lines=False) for b in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def bills_create(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    vendor_id = body.get("vendor_id")
    if not vendor_id or not Vendor.objects.filter(id=vendor_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Valid vendor_id required"}, status=400)
    bill_date = _parse_date(body.get("bill_date")) or date.today()
    due_date = _normalize_due_date(bill_date, _parse_date(body.get("due_date")))
    tax_total = _decimal(body.get("tax_amount", body.get("tax_total")))
    status = _normalize_bill_status(body.get("status"), "draft")
    ack_tank_overfill = _acknowledge_tank_overfill_from_body(body)
    receipt_station_id = None
    raw_rs = body.get("receipt_station_id") or body.get("station_id")
    if raw_rs is not None and raw_rs != "":
        try:
            receipt_station_id = int(raw_rs)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "receipt_station_id must be an integer"}, status=400)
        if not Station.objects.filter(
            pk=receipt_station_id, company_id=request.company_id, is_active=True
        ).exists():
            return JsonResponse(
                {"detail": "Unknown or inactive receipt_station_id for this company"},
                status=400,
            )
    else:
        vrow = (
            Vendor.objects.filter(pk=vendor_id, company_id=request.company_id)
            .only("default_station_id", "default_aquaculture_pond_id")
            .first()
        )
        # Vendor default site and/or default pond (pond → shop linked on Station when set).
        receipt_station_id = receipt_station_id_for_vendor(request.company_id, vrow)

    parsed_lines, parse_err = _parse_bill_lines_from_body(request.company_id, body.get("lines"))
    if parse_err:
        return parse_err
    bill_purpose, purpose_err = parse_bill_purpose(body)
    if purpose_err:
        return JsonResponse({"detail": purpose_err}, status=400)
    if "bill_purpose" not in body:
        bill_purpose = infer_bill_purpose_from_parsed_lines(parsed_lines, request.company_id)
    line_purpose_err = validate_parsed_lines_for_bill_purpose(
        bill_purpose, parsed_lines, request.company_id
    )
    if line_purpose_err:
        return JsonResponse({"detail": line_purpose_err}, status=400)

    try:
        with transaction.atomic():
            b = Bill(
                company_id=request.company_id,
                vendor_id=vendor_id,
                receipt_station_id=receipt_station_id,
                bill_number=_next_bill_number(request.company_id),
                bill_date=bill_date,
                due_date=due_date,
                vendor_reference=(body.get("vendor_reference") or "")[:200],
                memo=(body.get("memo") or "")[:5000],
                status=status,
                subtotal=_decimal(body.get("subtotal")),
                tax_total=tax_total,
                total=_decimal(body.get("total_amount", body.get("total"))),
            )
            b.save()
            assign_auto_production_cycles_for_parsed_bill_lines(request.company_id, b, parsed_lines)
            for pl in parsed_lines:
                BillLine.objects.create(
                    bill=b,
                    item_id=pl["item_id"],
                    tank_id=pl["tank_id"],
                    description=pl["description"],
                    quantity=pl["quantity"],
                    unit_price=pl["unit_price"],
                    amount=pl["amount"],
                    aquaculture_pond_id=pl.get("aquaculture_pond_id"),
                    aquaculture_production_cycle_id=pl.get("aquaculture_production_cycle_id"),
                    aquaculture_cost_bucket=pl.get("aquaculture_cost_bucket") or "",
                    aquaculture_fish_weight_kg=pl.get("aquaculture_fish_weight_kg"),
                    aquaculture_fish_count=pl.get("aquaculture_fish_count"),
                    aquaculture_fish_species=pl.get("aquaculture_fish_species") or "",
                    aquaculture_fish_species_other=pl.get("aquaculture_fish_species_other") or "",
                    expense_account_id=pl.get("expense_account_id"),
                    fuel_station_expense_category=pl.get("fuel_station_expense_category") or "",
                    tenant_reporting_category_id=pl.get("tenant_reporting_category_id"),
                    receipt_station_id=pl.get("receipt_station_id"),
                )
            b.tax_total = tax_total
            b.save(update_fields=["tax_total", "updated_at"])
            _refresh_bill_totals_from_lines(b)
            b.refresh_from_db()
            b = (
                Bill.objects.filter(id=b.id)
                .select_related("vendor", "receipt_station")
                .prefetch_related(
                    "lines__item",
                    "lines__tank",
                    "lines__aquaculture_pond",
                    "lines__aquaculture_production_cycle",
                    "lines__expense_account",
                    "lines__tenant_reporting_category",
                    "payment_allocations",
                )
                .first()
            )
            if bill_eligible_for_posting(b):
                sync_posted_vendor_bill(
                    request.company_id,
                    b,
                    acknowledge_tank_overfill=ack_tank_overfill,
                )
            repair_stale_aquaculture_bill_line_cycles(
                request.company_id,
                bill_ids=[b.id],
                resync_gl=True,
            )
            b = (
                Bill.objects.filter(id=b.id)
                .select_related("vendor", "receipt_station")
                .prefetch_related(
                    "lines__item",
                    "lines__tank",
                    "lines__aquaculture_pond",
                    "lines__aquaculture_production_cycle",
                    "lines__expense_account",
                    "lines__tenant_reporting_category",
                    "payment_allocations",
                )
                .first()
            )
    except GlPostingError as e:
        return JsonResponse({"detail": e.detail}, status=400)
    except StockBusinessError as e:
        return JsonResponse({"detail": e.detail}, status=400)
    except IntegrityError:
        return JsonResponse(
            {
                "detail": (
                    "Could not assign a unique bill number. Retry once; if it persists, "
                    "contact support (bill number collision)."
                )
            },
            status=409,
        )
    return JsonResponse(_bill_to_json(b), status=201)


@csrf_exempt
@auth_required
@require_company_id
def bill_detail(request, bill_id: int):
    b = (
        Bill.objects.filter(id=bill_id, company_id=request.company_id)
        .select_related("vendor", "receipt_station")
        .prefetch_related(
            "lines__item",
            "lines__tank",
            "lines__aquaculture_pond",
            "lines__aquaculture_production_cycle",
            "lines__expense_account",
            "lines__tenant_reporting_category",
            "payment_allocations",
        )
        .first()
    )
    if not b:
        return JsonResponse({"detail": "Bill not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_bill_to_json(b))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        ok_edit, err_edit = assert_bill_edit_allowed(b)
        if not ok_edit:
            return JsonResponse({"detail": err_edit}, status=409)
        if "receipt_station_id" in body or "station_id" in body:
            raw_rs = (
                body.get("receipt_station_id")
                if "receipt_station_id" in body
                else body.get("station_id")
            )
            if raw_rs is None or raw_rs == "":
                b.receipt_station_id = None
            else:
                try:
                    rid = int(raw_rs)
                except (TypeError, ValueError):
                    return JsonResponse({"detail": "receipt_station_id must be an integer"}, status=400)
                if not Station.objects.filter(
                    pk=rid, company_id=request.company_id, is_active=True
                ).exists():
                    return JsonResponse(
                        {"detail": "Unknown or inactive receipt_station_id for this company"},
                        status=400,
                    )
                b.receipt_station_id = rid
        parsed_lines = None
        if body.get("vendor_id"):
            vid = body.get("vendor_id")
            try:
                vid = int(vid)
            except (TypeError, ValueError):
                vid = None
            if vid and Vendor.objects.filter(id=vid, company_id=request.company_id).exists():
                b.vendor_id = vid
        b.bill_date = _parse_date(body.get("bill_date")) or b.bill_date
        b.due_date = _normalize_due_date(b.bill_date, _parse_date(body.get("due_date")))
        if "vendor_reference" in body:
            b.vendor_reference = (body.get("vendor_reference") or "")[:200]
        if "memo" in body:
            b.memo = (body.get("memo") or "")[:5000]
        b.tax_total = _decimal(body.get("tax_amount", body.get("tax_total")), b.tax_total)
        if "status" in body:
            b.status = _normalize_bill_status(body.get("status"), b.status)
        ack_tank_overfill = _acknowledge_tank_overfill_from_body(body)
        lines_in_body = "lines" in body
        material_bill = body_has_material_bill_change(body, lines_changed=lines_in_body)
        if lines_in_body:
            parsed_lines, parse_err = _parse_bill_lines_from_body(
                request.company_id, body.get("lines")
            )
            if parse_err:
                return parse_err
            bill_purpose, purpose_err = parse_bill_purpose(body)
            if purpose_err:
                return JsonResponse({"detail": purpose_err}, status=400)
            if "bill_purpose" not in body:
                bill_purpose = infer_bill_purpose_from_parsed_lines(
                    parsed_lines, request.company_id
                )
            line_purpose_err = validate_parsed_lines_for_bill_purpose(
                bill_purpose, parsed_lines, request.company_id
            )
            if line_purpose_err:
                return JsonResponse({"detail": line_purpose_err}, status=400)
        elif "bill_purpose" in body:
            bill_purpose, purpose_err = parse_bill_purpose(body)
            if purpose_err:
                return JsonResponse({"detail": purpose_err}, status=400)
            existing_lines = [
                {
                    "aquaculture_pond_id": ln.aquaculture_pond_id,
                    "aquaculture_cost_bucket": ln.aquaculture_cost_bucket,
                    "fuel_station_expense_category": ln.fuel_station_expense_category,
                    "receipt_station_id": ln.receipt_station_id,
                }
                for ln in b.lines.all()
            ]
            line_purpose_err = validate_parsed_lines_for_bill_purpose(
                bill_purpose, existing_lines, request.company_id
            )
            if line_purpose_err:
                return JsonResponse({"detail": line_purpose_err}, status=400)
        try:
            with transaction.atomic():
                b.save()
                if parsed_lines is not None:
                    if not (material_bill and bill_eligible_for_posting(b)):
                        undo_bill_stock_receipt(b)
                        b.refresh_from_db(fields=["stock_receipt_applied"])
                    b.lines.all().delete()
                    assign_auto_production_cycles_for_parsed_bill_lines(request.company_id, b, parsed_lines)
                    for pl in parsed_lines:
                        BillLine.objects.create(
                            bill=b,
                            item_id=pl["item_id"],
                            tank_id=pl["tank_id"],
                            description=pl["description"],
                            quantity=pl["quantity"],
                            unit_price=pl["unit_price"],
                            amount=pl["amount"],
                            aquaculture_pond_id=pl.get("aquaculture_pond_id"),
                            aquaculture_production_cycle_id=pl.get("aquaculture_production_cycle_id"),
                            aquaculture_cost_bucket=pl.get("aquaculture_cost_bucket") or "",
                            aquaculture_fish_weight_kg=pl.get("aquaculture_fish_weight_kg"),
                            aquaculture_fish_count=pl.get("aquaculture_fish_count"),
                            aquaculture_fish_species=pl.get("aquaculture_fish_species") or "",
                            aquaculture_fish_species_other=pl.get("aquaculture_fish_species_other") or "",
                            expense_account_id=pl.get("expense_account_id"),
                            fuel_station_expense_category=pl.get("fuel_station_expense_category") or "",
                            tenant_reporting_category_id=pl.get("tenant_reporting_category_id"),
                            receipt_station_id=pl.get("receipt_station_id"),
                        )
                _refresh_bill_totals_from_lines(b)
                b.refresh_from_db()
                b = (
                    Bill.objects.filter(id=b.id)
                    .select_related("vendor", "receipt_station")
                    .prefetch_related(
                        "lines__item",
                        "lines__tank",
                        "lines__aquaculture_pond",
                        "lines__aquaculture_production_cycle",
                        "lines__expense_account",
                        "lines__tenant_reporting_category",
                        "payment_allocations",
                    )
                    .first()
                )
                if (b.status or "").strip().lower() == "void":
                    cleanup_vendor_bill_posting_effects(request.company_id, b)
                elif bill_eligible_for_posting(b):
                    if material_bill:
                        reconcile_bill_after_material_edit(
                            request.company_id,
                            b,
                            acknowledge_tank_overfill=ack_tank_overfill,
                        )
                    else:
                        sync_posted_vendor_bill(
                            request.company_id,
                            b,
                            acknowledge_tank_overfill=ack_tank_overfill,
                        )
                repair_stale_aquaculture_bill_line_cycles(
                    request.company_id,
                    bill_ids=[b.id],
                    resync_gl=True,
                )
                b = (
                    Bill.objects.filter(id=b.id)
                    .select_related("vendor", "receipt_station")
                    .prefetch_related(
                        "lines__item",
                        "lines__tank",
                        "lines__aquaculture_pond",
                        "lines__aquaculture_production_cycle",
                        "lines__expense_account",
                        "lines__tenant_reporting_category",
                        "payment_allocations",
                    )
                    .first()
                )
        except GlPostingError as e:
            return JsonResponse({"detail": e.detail}, status=400)
        except StockBusinessError as e:
            return JsonResponse({"detail": e.detail}, status=400)
        return JsonResponse(_bill_to_json(b))
    if request.method == "DELETE":
        paid = _amount_paid(b)
        if paid > 0:
            return JsonResponse(
                {
                    "detail": (
                        "Cannot delete a bill that has vendor payments allocated. "
                        "Remove or reallocate those payments first."
                    )
                },
                status=409,
            )
        cleanup_vendor_bill_posting_effects(request.company_id, b)
        b.delete()
        return HttpResponse(status=204)
    return JsonResponse({"detail": "Method not allowed"}, status=405)
