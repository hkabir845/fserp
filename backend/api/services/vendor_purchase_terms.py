"""Feed/medicine mill purchase terms: credit facility, rate cards, scheme credits.

Vendor types (supplier_category) classify every supplier. Mill dealer schemes
(instant MRP discount, transport deduction, volume rebates, credit limit) apply
to Feed and Medicine. Other types keep ordinary vendor-bill behaviour.

Every rate-card field is optional. Blank/zero means that mill does not use the
term; the bill is priced from whatever the clerk actually filled in.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.db import transaction
from django.db.models import F
from django.http import JsonResponse

from api.exceptions import GlPostingError
from api.models import (
    Bill,
    BillLine,
    Item,
    JournalEntry,
    Payment,
    PaymentBillAllocation,
    Vendor,
    VendorCredit,
    VendorRateCard,
    VendorSchemeReserve,
)
from api.services.gl_posting import (
    CODE_AP,
    _coa,
    _create_posted_entry,
    _debit_account_for_paid_sale,
    _ensure_core_posting_account,
    bill_eligible_for_posting,
    sync_payment_made_gl,
)
from api.services.party_balance_sync import refresh_vendor_balance
from api.services.payment_allocation import (
    compute_vendor_balance_due,
    refresh_bill_from_allocations,
    refresh_bills_touched_by_payment,
)

_MONEY = Decimal("0.01")
_Q4 = Decimal("0.0001")
CODE_REBATE_INCOME = "4400"
CODE_OTHER_REV = "4230"
CODE_PURCHASE_DISCOUNT = "5130"
CODE_LORRY_ALLOWANCE = "5131"
CODE_MILL_COMMISSION_MONTHLY = "5132"
CODE_MILL_COMMISSION_YEARLY = "5133"
CODE_FREIGHT_EXPENSE = "7100"

MILL_SETTLEMENT_CASH = "cash"
MILL_SETTLEMENT_CREDIT = "credit"

MILL_CREDIT_KIND_INCOME = {
    "discount": CODE_PURCHASE_DISCOUNT,
    "transport": CODE_LORRY_ALLOWANCE,
    "monthly": CODE_MILL_COMMISSION_MONTHLY,
    "yearly": CODE_MILL_COMMISSION_YEARLY,
}

SUPPLIER_CATEGORY_LABELS: dict[str, str] = {
    Vendor.CATEGORY_GENERAL: "General",
    Vendor.CATEGORY_FEED: "Feed",
    Vendor.CATEGORY_MEDICINE: "Medicine",
    Vendor.CATEGORY_FISH_FRY: "Fish fry & fingerling",
    Vendor.CATEGORY_EQUIPMENT: "Equipment",
    Vendor.CATEGORY_OTHER: "Other",
}


def _q(val, places: Decimal = _MONEY) -> Decimal:
    try:
        d = Decimal(str(val if val is not None else 0))
    except Exception:
        d = Decimal("0")
    return d.quantize(places, rounding=ROUND_HALF_UP)


def _parse_date(val) -> Optional[date]:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def normalize_supplier_category(raw) -> tuple[str, Optional[str]]:
    cat = (str(raw).strip().lower() if raw is not None else "") or Vendor.CATEGORY_GENERAL
    aliases = {
        "fish fry": Vendor.CATEGORY_FISH_FRY,
        "fish_fry": Vendor.CATEGORY_FISH_FRY,
        "fry": Vendor.CATEGORY_FISH_FRY,
        "fingerling": Vendor.CATEGORY_FISH_FRY,
        "fingerlings": Vendor.CATEGORY_FISH_FRY,
        "equipments": Vendor.CATEGORY_EQUIPMENT,
        "equipment": Vendor.CATEGORY_EQUIPMENT,
        "others": Vendor.CATEGORY_OTHER,
        "other": Vendor.CATEGORY_OTHER,
        "feed mill": Vendor.CATEGORY_FEED,
        "feeds": Vendor.CATEGORY_FEED,
        "medicines": Vendor.CATEGORY_MEDICINE,
    }
    cat = aliases.get(cat, cat)
    allowed = {c[0] for c in Vendor.CATEGORY_CHOICES}
    if cat not in allowed:
        return Vendor.CATEGORY_GENERAL, (
            f"supplier_category must be one of: {', '.join(sorted(allowed))}"
        )
    return cat, None


def uses_purchase_terms(vendor: Optional[Vendor]) -> bool:
    if not vendor:
        return False
    return (vendor.supplier_category or Vendor.CATEGORY_GENERAL) in Vendor.PURCHASE_TERMS_CATEGORIES


def supplier_category_label(code: str | None) -> str:
    c = (code or Vendor.CATEGORY_GENERAL).strip().lower()
    return SUPPLIER_CATEGORY_LABELS.get(c, SUPPLIER_CATEGORY_LABELS[Vendor.CATEGORY_GENERAL])


def _add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)


def effective_square_off_date(vendor: Vendor) -> Optional[date]:
    if vendor.square_off_date:
        return vendor.square_off_date
    start = vendor.credit_start_date
    if not start:
        return None
    return _add_years(start, 1)


def credit_facility_active(vendor: Optional[Vendor]) -> bool:
    if not vendor:
        return False
    return bool(vendor.credit_facility_enabled) and _q(vendor.credit_limit) > 0


def vendor_credit_snapshot(
    company_id: int,
    vendor: Vendor,
    *,
    as_of: Optional[date] = None,
    extra_bill_net: Decimal = Decimal("0"),
    exclude_bill_id: Optional[int] = None,
) -> dict[str, Any]:
    """Used / available credit. Used is the live A/P subledger (bills − cash − mill credits)."""
    as_of = as_of or date.today()
    used = _q(compute_vendor_balance_due(company_id, vendor.id))
    if exclude_bill_id:
        bill = Bill.objects.filter(
            pk=exclude_bill_id, company_id=company_id, vendor_id=vendor.id
        ).first()
        if bill and bill_eligible_for_posting(bill):
            used = _q(used - _q(bill.total))
    used = max(Decimal("0.00"), used)
    limit = _q(vendor.credit_limit)
    enabled = credit_facility_active(vendor)
    square = effective_square_off_date(vendor)
    square_off_hold = bool(
        enabled
        and vendor.require_zero_on_square_off
        and square
        and as_of >= square
        and used > 0
    )
    if not enabled:
        available = None
        cash_only = False
    elif square_off_hold:
        available = Decimal("0.00")
        cash_only = True
    else:
        available = max(Decimal("0.00"), limit - used)
        cash_only = available <= 0
    extra = _q(extra_bill_net)
    cash_required = Decimal("0.00")
    if enabled and extra > 0:
        room = available if available is not None else Decimal("0")
        cash_required = max(Decimal("0.00"), extra - room)
    return {
        "supplier_category": vendor.supplier_category or Vendor.CATEGORY_GENERAL,
        "supplier_category_label": supplier_category_label(vendor.supplier_category),
        "uses_purchase_terms": uses_purchase_terms(vendor),
        "credit_facility_enabled": bool(vendor.credit_facility_enabled),
        "credit_limit": str(limit),
        "credit_start_date": vendor.credit_start_date.isoformat() if vendor.credit_start_date else None,
        "square_off_date": square.isoformat() if square else None,
        "require_zero_on_square_off": bool(vendor.require_zero_on_square_off),
        "used": str(used),
        "available": str(available) if available is not None else None,
        "cash_only": cash_only,
        "square_off_hold": square_off_hold,
        "cash_required": str(cash_required),
    }


def active_rate_card(vendor: Vendor, as_of: Optional[date] = None) -> Optional[VendorRateCard]:
    as_of = as_of or date.today()
    cards = list(
        VendorRateCard.objects.filter(
            vendor_id=vendor.id, company_id=vendor.company_id, is_active=True
        )
    )
    eligible = [
        c
        for c in cards
        if c.effective_from <= as_of and (c.effective_to is None or c.effective_to >= as_of)
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda c: (c.effective_from, c.id))


def rate_card_to_json(card: Optional[VendorRateCard]) -> Optional[dict[str, Any]]:
    if not card:
        return None
    # UI / bills show money and % to 2 decimal places only.
    return {
        "id": card.id,
        "effective_from": card.effective_from.isoformat(),
        "effective_to": card.effective_to.isoformat() if card.effective_to else None,
        "instant_discount_percent": str(_q(card.instant_discount_percent)),
        "instant_discount_per_unit": str(_q(card.instant_discount_per_unit)),
        "transport_percent": str(_q(card.transport_percent)),
        "transport_per_truck": str(_q(card.transport_per_truck)),
        "transport_per_unit": str(_q(card.transport_per_unit)),
        "transport_per_kg": str(_q(card.transport_per_kg)),
        "transport_per_ton": str(_q(getattr(card, "transport_per_ton", 0))),
        "monthly_rebate_percent": str(_q(card.monthly_rebate_percent)),
        "yearly_rebate_percent": str(_q(card.yearly_rebate_percent)),
        "yearly_target_kg": str(_q(card.yearly_target_kg)),
        "yearly_target_tons": str(_q(_q(card.yearly_target_kg) / Decimal("1000"))),
        "is_active": bool(card.is_active),
    }


def line_weight_kg(qty: Decimal, item: Optional[Item]) -> Decimal:
    if not item:
        return qty
    sack = getattr(item, "content_weight_kg", None)
    if sack is not None and _q(sack, _Q4) > 0:
        return _q(qty * _q(sack, _Q4), _Q4)
    unit = (item.unit or "").strip().lower()
    if unit in ("kg", "kgs", "kilogram", "kilograms"):
        return _q(qty, _Q4)
    return Decimal("0")


def apply_rate_card_to_line(
    *,
    quantity: Decimal,
    mrp_unit: Decimal,
    card: VendorRateCard,
    item: Optional[Item] = None,
) -> dict[str, Decimal]:
    qty = _q(quantity, Decimal("0.0001"))
    mrp = _q(mrp_unit)
    gross = _q(qty * mrp)
    instant = _q(gross * _q(card.instant_discount_percent, _Q4) / Decimal("100"))
    instant += _q(qty * _q(card.instant_discount_per_unit, _Q4))
    kg = line_weight_kg(qty, item)
    tons = _q(kg / Decimal("1000"), _Q4) if kg > 0 else Decimal("0")
    # Feed mills credit transport per ton (e.g. 10 t × 950). Optional % / unit / kg still stack.
    # Per-truck is bill-level (apply_bill_truck_transport), not × qty here.
    transport = _q(gross * _q(card.transport_percent, _Q4) / Decimal("100"))
    transport += _q(qty * _q(card.transport_per_unit, _Q4))
    transport += _q(kg * _q(card.transport_per_kg, _Q4))
    transport += _q(tons * _q(getattr(card, "transport_per_ton", 0), _Q4))
    net = _q(gross - instant - transport)
    if net < 0:
        net = Decimal("0.00")
    unit_net = _q(net / qty) if qty > 0 else Decimal("0.00")
    return {
        "mrp": mrp,
        "gross_mrp": gross,
        "instant_discount_amount": instant,
        "transport_amount": transport,
        "amount": net,
        "unit_price": unit_net,
    }


def price_parsed_bill_line(
    row: dict,
    pl: dict,
    vendor: Optional[Vendor],
    bill_date: Optional[date],
    item: Optional[Item],
) -> Optional[JsonResponse]:
    """If MRP is present (or item.mrp + mill vendor), compute net = qty×MRP − instant − transport."""
    qty = _q(pl.get("quantity") or 1, Decimal("0.0001"))
    raw_mrp = row.get("mrp")
    mrp = _q(raw_mrp) if raw_mrp not in (None, "") else Decimal("0")
    if mrp <= 0 and item is not None:
        mrp = _q(getattr(item, "mrp", 0))
    if mrp <= 0:
        pl["mrp"] = Decimal("0.00")
        pl["instant_discount_amount"] = _q(row.get("instant_discount_amount"))
        pl["transport_amount"] = _q(row.get("transport_amount"))
        return None
    card = active_rate_card(vendor, bill_date) if vendor else None
    inst_given = "instant_discount_amount" in row and row.get("instant_discount_amount") not in (None, "")
    trans_given = "transport_amount" in row and row.get("transport_amount") not in (None, "")
    if card and not (inst_given and trans_given):
        priced = apply_rate_card_to_line(quantity=qty, mrp_unit=mrp, card=card, item=item)
        if inst_given:
            priced["instant_discount_amount"] = _q(row.get("instant_discount_amount"))
        if trans_given:
            priced["transport_amount"] = _q(row.get("transport_amount"))
        priced["amount"] = _q(
            priced["gross_mrp"] - priced["instant_discount_amount"] - priced["transport_amount"]
        )
        if priced["amount"] < 0:
            return JsonResponse(
                {"detail": "Instant discount plus transport cannot exceed qty × MRP."},
                status=400,
            )
        if qty > 0:
            priced["unit_price"] = _q(priced["amount"] / qty)
        pl.update(
            {
                "mrp": priced["mrp"],
                "instant_discount_amount": priced["instant_discount_amount"],
                "transport_amount": priced["transport_amount"],
                "amount": priced["amount"],
                "unit_price": priced["unit_price"],
            }
        )
        return None
    instant = _q(row.get("instant_discount_amount")) if inst_given else Decimal("0")
    transport = _q(row.get("transport_amount")) if trans_given else Decimal("0")
    gross = _q(qty * mrp)
    net = _q(gross - instant - transport)
    if net < 0:
        return JsonResponse(
            {"detail": "Instant discount plus transport cannot exceed qty × MRP."},
            status=400,
        )
    pl["mrp"] = mrp
    pl["instant_discount_amount"] = instant
    pl["transport_amount"] = transport
    pl["amount"] = net
    pl["unit_price"] = _q(net / qty) if qty > 0 else Decimal("0.00")
    return None


def split_purchase_term_amounts(pl: dict, portion: Decimal, original_amount: Decimal) -> None:
    if original_amount <= 0:
        return
    ratio = portion / original_amount
    for key in ("instant_discount_amount", "transport_amount"):
        raw = pl.get(key)
        if raw:
            pl[key] = _q(_q(raw) * ratio)


def resolve_truck_transport_amount(
    vendor: Optional[Vendor],
    bill_date: Optional[date],
    body: Optional[dict],
) -> Decimal:
    """Per-bill truck transport: explicit body value wins; else the rate card; else 0."""
    body = body or {}
    if "truck_transport_amount" in body and body.get("truck_transport_amount") not in (None, ""):
        val = _q(body.get("truck_transport_amount"))
        return val if val > 0 else Decimal("0.00")
    card = active_rate_card(vendor, bill_date) if vendor else None
    if not card:
        return Decimal("0.00")
    val = _q(card.transport_per_truck, _Q4)
    return val if val > 0 else Decimal("0.00")


def _reprice_line_without_truck(
    pl: dict,
    card: Optional[VendorRateCard],
    item: Optional[Item],
) -> None:
    qty = _q(pl.get("quantity") or 1, Decimal("0.0001"))
    mrp = _q(pl.get("mrp"))
    if mrp <= 0 or qty <= 0:
        return
    gross = _q(qty * mrp)
    instant = _q(pl.get("instant_discount_amount"))
    transport = Decimal("0.00")
    if card:
        priced = apply_rate_card_to_line(quantity=qty, mrp_unit=mrp, card=card, item=item)
        transport = priced["transport_amount"]
    net = _q(gross - instant - transport)
    if net < 0:
        net = Decimal("0.00")
    pl["transport_amount"] = transport
    pl["amount"] = net
    pl["unit_price"] = _q(net / qty)


def apply_bill_truck_transport(
    parsed_lines: list[dict],
    vendor: Optional[Vendor],
    bill_date: Optional[date],
    body: Optional[dict],
) -> tuple[Decimal, Optional[JsonResponse]]:
    """Deduct per-truck transport once across MRP lines. No-op when the mill left it blank."""
    truck = resolve_truck_transport_amount(vendor, bill_date, body)
    if truck <= 0 or not parsed_lines:
        return Decimal("0.00"), None
    mrp_indexes = [i for i, pl in enumerate(parsed_lines) if _q(pl.get("mrp")) > 0]
    if not mrp_indexes:
        return Decimal("0.00"), None
    card = active_rate_card(vendor, bill_date) if vendor else None
    item_ids = [parsed_lines[i].get("item_id") for i in mrp_indexes if parsed_lines[i].get("item_id")]
    items = {it.id: it for it in Item.objects.filter(pk__in=item_ids)} if item_ids else {}
    weights: list[Decimal] = []
    for i in mrp_indexes:
        pl = parsed_lines[i]
        item = items.get(pl.get("item_id")) if pl.get("item_id") else None
        _reprice_line_without_truck(pl, card, item)
        qty = _q(pl.get("quantity") or 1, Decimal("0.0001"))
        gross = _q(qty * _q(pl.get("mrp")))
        weights.append(gross if gross > 0 else Decimal("0.01"))
    total_w = sum(weights) or Decimal("0.01")
    remaining = truck
    for n, i in enumerate(mrp_indexes):
        share = remaining if n == len(mrp_indexes) - 1 else _q(truck * weights[n] / total_w)
        remaining = _q(remaining - share)
        pl = parsed_lines[i]
        pl["transport_amount"] = _q(_q(pl.get("transport_amount")) + share)
        qty = _q(pl.get("quantity") or 1, Decimal("0.0001"))
        mrp = _q(pl.get("mrp"))
        gross = _q(qty * mrp)
        net = _q(gross - _q(pl.get("instant_discount_amount")) - _q(pl.get("transport_amount")))
        if net < 0:
            return Decimal("0.00"), JsonResponse(
                {"detail": "Instant discount plus transport cannot exceed qty × MRP."},
                status=400,
            )
        pl["amount"] = net
        pl["unit_price"] = _q(net / qty) if qty > 0 else Decimal("0.00")
    return truck, None


def mill_mrp_of_parsed_lines(parsed_lines: list[dict]) -> Decimal:
    total = Decimal("0.00")
    for pl in parsed_lines:
        mrp = _q(pl.get("mrp"))
        qty = _q(pl.get("quantity") or 1, Decimal("0.0001"))
        if mrp > 0 and qty > 0:
            total += _q(qty * mrp)
    return total


def mill_settlement_lane(
    company_id: int,
    vendor: Optional[Vendor],
    mrp_gross: Decimal,
    *,
    bill_date: Optional[date] = None,
    exclude_bill_id: Optional[int] = None,
) -> str:
    """credit = room under limit (net payable on A/P); cash = limit full (must pay net now)."""
    if not uses_purchase_terms(vendor):
        return MILL_SETTLEMENT_CASH
    if not credit_facility_active(vendor):
        return MILL_SETTLEMENT_CASH
    snap = vendor_credit_snapshot(
        company_id,
        vendor,
        as_of=bill_date or date.today(),
        extra_bill_net=Decimal("0"),
        exclude_bill_id=exclude_bill_id,
    )
    if snap.get("cash_only") or snap.get("square_off_hold"):
        return MILL_SETTLEMENT_CASH
    available = snap.get("available")
    if available is None:
        return MILL_SETTLEMENT_CASH
    if _q(available) + Decimal("0.005") >= _q(mrp_gross):
        return MILL_SETTLEMENT_CREDIT
    return MILL_SETTLEMENT_CASH


def apply_mill_bill_settlement(
    parsed_lines: list[dict],
    vendor: Optional[Vendor],
    bill_date: Optional[date],
    body: Optional[dict],
    company_id: int,
    *,
    exclude_bill_id: Optional[int] = None,
) -> tuple[Decimal, str, Optional[JsonResponse]]:
    """Discount and mill transport credit always reduce the bill when feed arrives; lane only controls cash vs A/P."""
    truck, err = apply_bill_truck_transport(parsed_lines, vendor, bill_date, body)
    if err:
        return Decimal("0.00"), MILL_SETTLEMENT_CASH, err
    if not uses_purchase_terms(vendor):
        return truck, "", None
    mrp = mill_mrp_of_parsed_lines(parsed_lines)
    lane = mill_settlement_lane(
        company_id,
        vendor,
        mrp,
        bill_date=bill_date,
        exclude_bill_id=exclude_bill_id,
    )
    return truck, lane, None


def mill_cash_required_error(
    vendor: Vendor,
    posted_net: Decimal,
    cash_applied: Decimal,
) -> Optional[dict[str, Any]]:
    """When the mill limit is full, the whole load is cash: pay MRP − discount − lorry."""
    if _q(cash_applied) + Decimal("0.005") >= _q(posted_net):
        return None
    need = _q(_q(posted_net) - _q(cash_applied))
    return {
        "detail": (
            "Credit limit is full. Pay this feed by cash/bank at MRP minus discount and lorry "
            f"(need {need})."
        ),
        "code": "vendor_credit_limit",
        "cash_only": True,
        "cash_required": str(_q(posted_net)),
        "bill_net": str(_q(posted_net)),
        "cash_applied": str(_q(cash_applied)),
        "credit_limit": str(_q(vendor.credit_limit)),
    }


def bill_gross_mrp(bill: Bill) -> Decimal:
    total = Decimal("0.00")
    for ln in bill.lines.all() if hasattr(bill, "lines") else BillLine.objects.filter(bill_id=bill.id):
        mrp = _q(getattr(ln, "mrp", 0))
        qty = _q(getattr(ln, "quantity", 1) or 1, Decimal("0.0001"))
        if mrp > 0:
            total += _q(qty * mrp)
    return total


def bill_instant_discount_total(bill: Bill) -> Decimal:
    total = Decimal("0.00")
    qs = bill.lines.all() if hasattr(bill, "lines") else BillLine.objects.filter(bill_id=bill.id)
    for ln in qs:
        total += _q(getattr(ln, "instant_discount_amount", 0))
    return total


def bill_transport_total(bill: Bill) -> Decimal:
    truck = _q(getattr(bill, "truck_transport_amount", 0))
    if truck > 0:
        return truck
    total = Decimal("0.00")
    qs = bill.lines.all() if hasattr(bill, "lines") else BillLine.objects.filter(bill_id=bill.id)
    for ln in qs:
        total += _q(getattr(ln, "transport_amount", 0))
    return total


def evaluate_bill_credit_limit(
    company_id: int,
    vendor: Vendor,
    bill_net: Decimal,
    *,
    bill_date: Optional[date] = None,
    exclude_bill_id: Optional[int] = None,
    cash_applied: Decimal = Decimal("0"),
) -> Optional[dict[str, Any]]:
    """Return an error payload when a posted bill would exceed available credit."""
    if not credit_facility_active(vendor):
        return None
    snap = vendor_credit_snapshot(
        company_id,
        vendor,
        as_of=bill_date or date.today(),
        extra_bill_net=bill_net,
        exclude_bill_id=exclude_bill_id,
    )
    cash_required = _q(snap["cash_required"])
    if cash_required <= 0:
        return None
    if _q(cash_applied) + Decimal("0.005") >= cash_required:
        return None
    return {
        "detail": (
            "Credit limit is fully used for this supplier. Pay cash for this purchase "
            f"(need {_q(cash_required - _q(cash_applied))}), pay down the account, "
            "or raise the credit limit on the vendor."
        ),
        "code": "vendor_credit_limit",
        **{k: snap[k] for k in (
            "credit_limit",
            "used",
            "available",
            "cash_required",
            "cash_only",
            "square_off_hold",
        )},
        "bill_net": str(_q(bill_net)),
        "cash_applied": str(_q(cash_applied)),
    }


def credit_limit_error_response(payload: dict[str, Any]) -> JsonResponse:
    return JsonResponse(payload, status=400)


def apply_facility_fields(vendor: Vendor, body: dict) -> Optional[str]:
    if "supplier_category" in body:
        cat, err = normalize_supplier_category(body.get("supplier_category"))
        if err:
            return err
        vendor.supplier_category = cat
    if "credit_facility_enabled" in body:
        vendor.credit_facility_enabled = bool(body.get("credit_facility_enabled"))
    if "credit_limit" in body:
        vendor.credit_limit = _q(body.get("credit_limit"))
        if vendor.credit_limit < 0:
            return "credit_limit cannot be negative"
        if vendor.credit_limit > 0 and "credit_facility_enabled" not in body:
            vendor.credit_facility_enabled = True
    if "credit_start_date" in body:
        vendor.credit_start_date = _parse_date(body.get("credit_start_date"))
    if "square_off_date" in body:
        vendor.square_off_date = _parse_date(body.get("square_off_date"))
    if "require_zero_on_square_off" in body:
        vendor.require_zero_on_square_off = bool(body.get("require_zero_on_square_off"))
    return None


def upsert_rate_card_from_body(vendor: Vendor, body: dict) -> tuple[Optional[VendorRateCard], Optional[str]]:
    raw = body.get("rate_card")
    if raw is None:
        return None, None
    if not isinstance(raw, dict):
        return None, "rate_card must be an object"
    from_d = _parse_date(raw.get("effective_from")) or date.today()
    card = (
        VendorRateCard.objects.filter(
            vendor_id=vendor.id,
            company_id=vendor.company_id,
            effective_from=from_d,
        ).first()
        or VendorRateCard(vendor=vendor, company_id=vendor.company_id, effective_from=from_d)
    )
    if "effective_to" in raw:
        card.effective_to = _parse_date(raw.get("effective_to"))
    if "yearly_target_tons" in raw and "yearly_target_kg" not in raw:
        tons = _q(raw.get("yearly_target_tons"))
        if tons < 0:
            return None, "yearly_target_tons cannot be negative"
        raw = {**raw, "yearly_target_kg": tons * Decimal("1000")}
    for fname in (
        "instant_discount_percent",
        "instant_discount_per_unit",
        "transport_percent",
        "transport_per_truck",
        "transport_per_unit",
        "transport_per_kg",
        "transport_per_ton",
        "monthly_rebate_percent",
        "yearly_rebate_percent",
        "yearly_target_kg",
    ):
        if fname in raw:
            val = _q(raw.get(fname))
            if val < 0:
                return None, f"{fname} cannot be negative"
            setattr(card, fname, val)
    if "is_active" in raw:
        card.is_active = bool(raw.get("is_active"))
    card.save()
    return card, None


def _credit_year_bounds(vendor: Vendor, as_of: date) -> tuple[date, date]:
    start = vendor.credit_start_date
    if not start:
        return date(as_of.year, 1, 1), date(as_of.year, 12, 31)
    end = effective_square_off_date(vendor) or _add_years(start, 1)
    window_start = start
    window_end = end
    guard = 0
    while as_of >= window_end and guard < 40:
        window_start = window_end
        window_end = _add_years(window_start, 1)
        guard += 1
    while as_of < window_start and guard < 80:
        window_end = window_start
        window_start = _add_years(window_start, -1)
        guard += 1
    last = window_end - timedelta(days=1) if window_end > window_start else window_end
    return window_start, last


def closed_credit_year(vendor: Vendor, as_of: date) -> Optional[tuple[date, date]]:
    """Credit year whose square-off date is on or before as_of, or None if none has closed yet."""
    start = vendor.credit_start_date
    if not start:
        if as_of.month == 12 and as_of.day == 31:
            return date(as_of.year, 1, 1), as_of
        if as_of.year > 1:
            return date(as_of.year - 1, 1, 1), date(as_of.year - 1, 12, 31)
        return None
    ws = start
    we = effective_square_off_date(vendor) or _add_years(start, 1)
    last_closed: Optional[tuple[date, date]] = None
    guard = 0
    while we <= as_of and guard < 40:
        last_closed = (ws, we - timedelta(days=1) if we > ws else we)
        ws = we
        we = _add_years(ws, 1)
        guard += 1
    return last_closed


def scheme_progress(
    company_id: int,
    vendor: Vendor,
    as_of: Optional[date] = None,
    *,
    _skip_closed_eligibility: bool = False,
) -> dict[str, Any]:
    as_of = as_of or date.today()
    month_start = as_of.replace(day=1)
    month_end = date(as_of.year, as_of.month, calendar.monthrange(as_of.year, as_of.month)[1])
    year_start, year_end = _credit_year_bounds(vendor, as_of)
    lines = (
        BillLine.objects.filter(
            bill__company_id=company_id,
            bill__vendor_id=vendor.id,
        )
        .exclude(bill__status__in=("draft", "void"))
        .select_related("item", "bill")
    )
    month_mrp = Decimal("0.00")
    year_mrp = Decimal("0.00")
    year_kg = Decimal("0.0000")
    for ln in lines:
        bd = ln.bill.bill_date
        qty = _q(ln.quantity, Decimal("0.0001"))
        mrp_u = _q(ln.mrp)
        gross = _q(qty * mrp_u) if mrp_u > 0 else _q(ln.amount)
        kg = line_weight_kg(qty, ln.item)
        if month_start <= bd <= month_end:
            month_mrp += gross
        if year_start <= bd <= year_end:
            year_mrp += gross
            year_kg += kg
    card = active_rate_card(vendor, as_of)
    monthly_pct = _q(card.monthly_rebate_percent, _Q4) if card else Decimal("0")
    yearly_pct = _q(card.yearly_rebate_percent, _Q4) if card else Decimal("0")
    target = _q(card.yearly_target_kg, _Q4) if card else Decimal("0")
    monthly_est = _q(month_mrp * monthly_pct / Decimal("100")) if monthly_pct > 0 else Decimal("0")
    yearly_est = Decimal("0.00")
    yearly_earned = False
    if yearly_pct > 0 and (target <= 0 or year_kg + Decimal("0.00005") >= target):
        yearly_est = _q(year_mrp * yearly_pct / Decimal("100"))
        yearly_earned = target <= 0 or year_kg >= target
    month_period = as_of.strftime("%Y-%m")
    reserved_row = (
        VendorSchemeReserve.objects.filter(
            company_id=company_id,
            vendor_id=vendor.id,
            credit_kind=VendorSchemeReserve.KIND_MONTHLY,
            period_label=month_period,
        ).first()
        if monthly_pct > 0
        else None
    )
    monthly_reserved = _q(reserved_row.amount) if reserved_row else monthly_est
    year_start_s = year_start.isoformat()
    monthly_posted = VendorCredit.objects.filter(
        company_id=company_id,
        vendor_id=vendor.id,
        credit_kind=VendorCredit.KIND_MONTHLY,
        period_label=month_period,
    ).exists()
    can_post_monthly = bool(
        monthly_pct > 0 and monthly_reserved > 0 and not monthly_posted
    )
    yearly_posted = VendorCredit.objects.filter(
        company_id=company_id,
        vendor_id=vendor.id,
        credit_kind=VendorCredit.KIND_YEARLY,
        period_label=year_start_s,
    ).exists()
    closed = closed_credit_year(vendor, as_of)
    can_post_yearly = bool(
        closed
        and yearly_pct > 0
        and yearly_earned
        and yearly_est > 0
        and not yearly_posted
        and closed[0] == year_start
    )
    # On/after square-off, this as_of is already in the next year; eligibility uses the closed year.
    if (
        not _skip_closed_eligibility
        and closed
        and not can_post_yearly
        and yearly_pct > 0
        and closed[0] != year_start
    ):
        closed_start, closed_end = closed
        closed_posted = VendorCredit.objects.filter(
            company_id=company_id,
            vendor_id=vendor.id,
            credit_kind=VendorCredit.KIND_YEARLY,
            period_label=closed_start.isoformat(),
        ).exists()
        nested = scheme_progress(
            company_id, vendor, closed_end, _skip_closed_eligibility=True
        )
        can_post_yearly = bool(
            not closed_posted
            and nested.get("yearly_target_reached")
            and _q(nested.get("estimated_yearly_credit")) > 0
        )
    return {
        "as_of": as_of.isoformat(),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "year_start": year_start.isoformat(),
        "year_end": year_end.isoformat(),
        "month_mrp": str(_q(month_mrp)),
        "year_mrp": str(_q(year_mrp)),
        "year_kg": str(_q(year_kg)),
        "year_tons": str(_q(year_kg / Decimal("1000"))),
        "yearly_target_kg": str(_q(target)),
        "yearly_target_tons": str(_q(target / Decimal("1000"))),
        "monthly_rebate_percent": str(_q(monthly_pct)),
        "yearly_rebate_percent": str(_q(yearly_pct)),
        "estimated_monthly_credit": str(monthly_est),
        "monthly_reserved": str(monthly_reserved),
        "monthly_is_reserve": True,
        "monthly_credit_posted": monthly_posted,
        "can_post_monthly": can_post_monthly,
        "estimated_yearly_credit": str(yearly_est),
        "yearly_target_reached": yearly_earned,
        "yearly_credit_posted": yearly_posted,
        "can_post_yearly": can_post_yearly,
    }


def purchase_terms_payload(company_id: int, vendor: Vendor, as_of: Optional[date] = None) -> dict[str, Any]:
    as_of = as_of or date.today()
    snap = vendor_credit_snapshot(company_id, vendor, as_of=as_of)
    card = active_rate_card(vendor, as_of)
    credits = [
        vendor_credit_to_json(c)
        for c in VendorCredit.objects.filter(company_id=company_id, vendor_id=vendor.id)[:25]
    ]
    reserves = [
        {
            "id": r.id,
            "credit_kind": r.credit_kind,
            "period_label": r.period_label,
            "amount": str(_q(r.amount)),
            "mrp_base_amount": str(_q(r.mrp_base_amount)),
            "percent_applied": str(_q(r.percent_applied, _Q4)),
        }
        for r in VendorSchemeReserve.objects.filter(company_id=company_id, vendor_id=vendor.id)[:24]
    ]
    pending = pending_mill_term_credits(company_id, vendor) if uses_purchase_terms(vendor) else None
    return {
        **snap,
        "rate_card": rate_card_to_json(card),
        "scheme": scheme_progress(company_id, vendor, as_of) if uses_purchase_terms(vendor) else None,
        "pending_terms": pending,
        "recent_credits": credits,
        "recent_reserves": reserves,
    }


def sync_monthly_scheme_reserve(
    company_id: int,
    vendor: Vendor,
    as_of: Optional[date] = None,
) -> Optional[VendorSchemeReserve]:
    """Track monthly % of MRP as a reserve. Does not reduce A/P. No-op if monthly % was left blank."""
    if not uses_purchase_terms(vendor):
        return None
    as_of = as_of or date.today()
    card = active_rate_card(vendor, as_of)
    pct = _q(card.monthly_rebate_percent, _Q4) if card else Decimal("0")
    if pct <= 0:
        return None
    prog = scheme_progress(company_id, vendor, as_of, _skip_closed_eligibility=True)
    period = as_of.strftime("%Y-%m")
    amount = _q(prog.get("estimated_monthly_credit"))
    row, _created = VendorSchemeReserve.objects.update_or_create(
        company_id=company_id,
        vendor=vendor,
        credit_kind=VendorSchemeReserve.KIND_MONTHLY,
        period_label=period,
        defaults={
            "amount": amount,
            "mrp_base_amount": _q(prog.get("month_mrp")),
            "percent_applied": pct,
            "as_of": as_of,
            "memo": f"{pct}% of MRP reserved (not credited to A/P)",
        },
    )
    return row


def apply_monthly_scheme_credit(
    company_id: int,
    vendor: Vendor,
    body: Optional[dict] = None,
) -> tuple[Optional[VendorCredit], Optional[JsonResponse]]:
    """
    Post monthly % of MRP as a VendorCredit (reduces A/P).

    Amount comes from the current month reserve / estimate. One credit per YYYY-MM.
    """
    body = body or {}
    as_of = _parse_date(body.get("credit_date")) or date.today()
    if not uses_purchase_terms(vendor):
        return None, JsonResponse(
            {"detail": "Monthly scheme credits apply only to feed/medicine mill vendors."},
            status=400,
        )
    sync_monthly_scheme_reserve(company_id, vendor, as_of)
    prog = scheme_progress(company_id, vendor, as_of, _skip_closed_eligibility=True)
    pct = _q(prog.get("monthly_rebate_percent"), _Q4)
    if pct <= 0:
        return None, JsonResponse(
            {"detail": "This mill has no monthly scheme percent on the rate card."},
            status=400,
        )
    period = as_of.strftime("%Y-%m")
    if VendorCredit.objects.filter(
        company_id=company_id,
        vendor_id=vendor.id,
        credit_kind=VendorCredit.KIND_MONTHLY,
        period_label=period,
    ).exists():
        return None, JsonResponse(
            {"detail": f"Monthly scheme already credited for {period}."},
            status=400,
        )
    amount = _q(prog.get("monthly_reserved") or prog.get("estimated_monthly_credit"))
    if amount <= 0:
        return None, JsonResponse(
            {"detail": "No monthly scheme amount to credit (no MRP purchases this month)."},
            status=400,
        )
    memo = (body.get("memo") or f"Monthly {pct}% of MRP for {period}").strip()[:500]
    return create_vendor_credit(
        company_id,
        vendor,
        {
            "amount": str(amount),
            "credit_kind": VendorCredit.KIND_MONTHLY,
            "period_label": period,
            "mrp_base_amount": prog.get("month_mrp"),
            "percent_applied": str(pct),
            "credit_date": as_of.isoformat(),
            "memo": memo,
        },
    )


def apply_yearly_scheme_credit(
    company_id: int,
    vendor: Vendor,
    body: Optional[dict] = None,
) -> tuple[Optional[VendorCredit], Optional[JsonResponse]]:
    """Credit yearly % of MRP at square-off if the (optional) tonnage target was met."""
    body = body or {}
    as_of = _parse_date(body.get("credit_date")) or date.today()
    closed = closed_credit_year(vendor, as_of)
    if closed is None:
        return None, JsonResponse(
            {
                "detail": (
                    "Yearly mill credit posts on or after square-off (the credit-year end). "
                    "That date has not been reached."
                )
            },
            status=400,
        )
    year_start, year_end = closed
    prog = scheme_progress(company_id, vendor, year_end, _skip_closed_eligibility=True)
    pct = _q(prog.get("yearly_rebate_percent"), _Q4)
    if pct <= 0:
        return None, JsonResponse(
            {"detail": "This mill has no yearly scheme percent on the rate card."},
            status=400,
        )
    if not prog.get("yearly_target_reached"):
        return None, JsonResponse(
            {
                "detail": (
                    "Yearly tonnage target was not reached; no mill account credit is due. "
                    "Leave the target blank if this mill has no volume gate."
                )
            },
            status=400,
        )
    amount = _q(prog.get("estimated_yearly_credit"))
    if amount <= 0:
        return None, JsonResponse(
            {"detail": "No yearly scheme amount to credit (no MRP in the credit year)."},
            status=400,
        )
    period = year_start.isoformat()
    if VendorCredit.objects.filter(
        company_id=company_id,
        vendor_id=vendor.id,
        credit_kind=VendorCredit.KIND_YEARLY,
        period_label=period,
    ).exists():
        return None, JsonResponse(
            {"detail": "Yearly scheme already credited for this credit year."},
            status=400,
        )
    memo = (body.get("memo") or f"Yearly {pct}% of MRP (target met)").strip()[:500]
    return create_vendor_credit(
        company_id,
        vendor,
        {
            "amount": str(amount),
            "credit_kind": VendorCredit.KIND_YEARLY,
            "period_label": period,
            "mrp_base_amount": prog.get("year_mrp"),
            "percent_applied": str(pct),
            "credit_date": as_of.isoformat(),
            "memo": memo,
        },
    )


def vendor_list_purchase_fields(company_id: int, vendor: Vendor, balance: Decimal) -> dict[str, Any]:
    cat = vendor.supplier_category or Vendor.CATEGORY_GENERAL
    enabled = credit_facility_active(vendor)
    used = max(Decimal("0.00"), _q(balance))
    limit = _q(vendor.credit_limit)
    available = max(Decimal("0.00"), limit - used) if enabled else None
    return {
        "supplier_category": cat,
        "supplier_category_label": supplier_category_label(cat),
        "uses_purchase_terms": uses_purchase_terms(vendor),
        "credit_facility_enabled": bool(vendor.credit_facility_enabled),
        "credit_limit": str(limit),
        "credit_used": str(used) if enabled else None,
        "credit_available": str(available) if available is not None else None,
        "cash_only": bool(enabled and available is not None and available <= 0),
    }


def vendor_credit_to_json(c: VendorCredit) -> dict[str, Any]:
    return {
        "id": c.id,
        "credit_date": c.credit_date.isoformat(),
        "amount": str(_q(c.amount)),
        "credit_kind": c.credit_kind,
        "period_label": c.period_label or "",
        "mrp_base_amount": str(_q(c.mrp_base_amount)),
        "percent_applied": str(_q(c.percent_applied, _Q4)),
        "memo": c.memo or "",
        "journal_id": c.journal_id,
        "bill_id": c.bill_id,
    }


def _income_account_for_mill_credit(company_id: int, kind: str):
    code = MILL_CREDIT_KIND_INCOME.get(kind)
    if code:
        acc = _ensure_core_posting_account(company_id, code)
        if acc:
            return acc
    return (
        _coa(company_id, CODE_REBATE_INCOME)
        or _ensure_core_posting_account(company_id, CODE_OTHER_REV)
    )


def _post_vendor_credit_journal(company_id: int, credit: VendorCredit) -> Optional[JournalEntry]:
    ap = _ensure_core_posting_account(company_id, CODE_AP)
    income = _income_account_for_mill_credit(company_id, credit.credit_kind)
    if not ap or not income:
        return None
    entry_number = f"AUTO-VCRED-{credit.id}"
    lines = [
        (ap, credit.amount, Decimal("0"), credit.memo or f"Mill credit {credit.id}"),
        (income, Decimal("0"), credit.amount, credit.memo or f"Mill credit {credit.id}"),
    ]
    return _create_posted_entry(
        company_id,
        credit.credit_date,
        entry_number,
        f"Supplier credit #{credit.id}",
        lines,
    )


def create_vendor_credit(company_id: int, vendor: Vendor, body: dict) -> tuple[Optional[VendorCredit], Optional[JsonResponse]]:
    amount = _q(body.get("amount"))
    if amount <= 0:
        return None, JsonResponse({"detail": "amount must be positive"}, status=400)
    kind = (body.get("credit_kind") or VendorCredit.KIND_MANUAL).strip().lower()
    allowed = {c[0] for c in VendorCredit.KIND_CHOICES}
    if kind not in allowed:
        return None, JsonResponse({"detail": "Invalid credit_kind"}, status=400)
    credit = VendorCredit(
        company_id=company_id,
        vendor=vendor,
        credit_date=_parse_date(body.get("credit_date")) or date.today(),
        amount=amount,
        credit_kind=kind,
        period_label=(body.get("period_label") or "")[:32],
        mrp_base_amount=_q(body.get("mrp_base_amount")),
        percent_applied=_q(body.get("percent_applied"), _Q4),
        memo=(body.get("memo") or "")[:500],
    )
    raw_bill = body.get("bill_id")
    if raw_bill not in (None, ""):
        try:
            bid = int(raw_bill)
        except (TypeError, ValueError):
            return None, JsonResponse({"detail": "bill_id must be an integer"}, status=400)
        bill = Bill.objects.filter(pk=bid, company_id=company_id, vendor_id=vendor.id).first()
        if not bill:
            return None, JsonResponse({"detail": "bill_id is not a bill for this mill"}, status=400)
        credit.bill = bill
    # The credit row, its journal and the A/P decrement are one operation. Previously the row
    # was saved and A/P was reduced even when _post_vendor_credit_journal returned None (a
    # missing 2000 or rebate-income account), so the vendor balance fell with nothing behind it
    # in the ledger — a pure subledger-vs-GL divergence with no error shown.
    try:
        with transaction.atomic():
            credit.save()
            je = _post_vendor_credit_journal(company_id, credit)
            if je is None:
                raise GlPostingError(
                    "G/L: The supplier credit could not be posted. Check that Accounts Payable "
                    "(%s) and a rebate / other income account (%s or %s) exist and are active."
                    % (CODE_AP, CODE_REBATE_INCOME, CODE_OTHER_REV)
                )
            row = VendorCredit.objects.select_for_update().filter(pk=credit.pk).first()
            if row and not row.vendor_ap_decremented:
                Vendor.objects.filter(pk=vendor.id).update(
                    current_balance=F("current_balance") - amount
                )
                VendorCredit.objects.filter(pk=row.pk).update(
                    vendor_ap_decremented=True,
                    journal_id=je.id,
                )
    except GlPostingError as e:
        return None, JsonResponse({"detail": e.detail}, status=400)
    refresh_vendor_balance(company_id, vendor.id)
    credit.refresh_from_db()
    if credit.bill_id:
        refresh_bill_from_allocations(credit.bill, company_id)
    return credit, None


def delete_vendor_credit(company_id: int, credit: VendorCredit) -> None:
    with transaction.atomic():
        row = VendorCredit.objects.select_for_update().filter(pk=credit.pk, company_id=company_id).first()
        if not row:
            return
        if row.vendor_ap_decremented and row.vendor_id:
            Vendor.objects.filter(pk=row.vendor_id).update(
                current_balance=F("current_balance") + row.amount
            )
        if row.journal_id:
            JournalEntry.objects.filter(pk=row.journal_id, company_id=company_id).delete()
        else:
            JournalEntry.objects.filter(
                company_id=company_id, entry_number=f"AUTO-VCRED-{row.id}"
            ).delete()
        vid = row.vendor_id
        bill_id = row.bill_id
        row.delete()
    if vid:
        refresh_vendor_balance(company_id, vid)
    if bill_id:
        bill = Bill.objects.filter(pk=bill_id, company_id=company_id).first()
        if bill:
            refresh_bill_from_allocations(bill, company_id)


def _credit_credit_bills(company_id: int, vendor: Vendor):
    return (
        Bill.objects.filter(
            company_id=company_id,
            vendor_id=vendor.id,
            mill_settlement=MILL_SETTLEMENT_CREDIT,
        )
        .exclude(status__in=("draft", "void"))
        .prefetch_related("lines")
        .order_by("bill_date", "id")
    )


def pending_mill_term_credits(company_id: int, vendor: Vendor) -> dict[str, Any]:
    """Pending mill approvals. Discount and lorry already hit the feed bill; only monthly/yearly wait."""
    scheme = scheme_progress(company_id, vendor)
    return {
        "discount": "0.00",
        "transport": "0.00",
        "can_post_discount": False,
        "can_post_transport": False,
        "discount_bill_ids": [],
        "transport_bill_ids": [],
        "can_post_monthly": bool(scheme.get("can_post_monthly")),
        "can_post_yearly": bool(scheme.get("can_post_yearly")),
        "estimated_monthly": str(_q(scheme.get("estimated_monthly_credit") or scheme.get("monthly_reserved"))),
        "estimated_yearly": str(_q(scheme.get("estimated_yearly_credit"))),
    }


def apply_pending_discount_or_lorry(
    company_id: int,
    vendor: Vendor,
    kind: str,
    body: Optional[dict] = None,
) -> tuple[list[VendorCredit], Optional[JsonResponse]]:
    """Discount and mill transport credit are applied on the feed bill; they are not later credit notes."""
    return [], JsonResponse(
        {
            "detail": (
                "Discount and mill transport credit (৳ per ton) are applied when the feed bill is recorded. "
                "Use monthly/yearly scheme only after the mill officially approves those commissions."
            )
        },
        status=400,
    )


def apply_mill_flags(
    company_id: int,
    vendor: Vendor,
    mill_apply: Optional[dict],
) -> Optional[JsonResponse]:
    """Apply ticked mill credit notes (discount, lorry, monthly, yearly) in one payment save."""
    if not mill_apply or not isinstance(mill_apply, dict):
        return None
    if mill_apply.get("discount") or mill_apply.get("transport") or mill_apply.get("lorry"):
        return JsonResponse(
            {
                "detail": (
                    "Discount and mill transport credit are applied on the feed bill when they send feed. "
                    "Only monthly/yearly commissions are applied here after the mill officially approves."
                )
            },
            status=400,
        )
    if mill_apply.get("monthly"):
        _credit, resp = apply_monthly_scheme_credit(company_id, vendor, mill_apply)
        if resp:
            return resp
    if mill_apply.get("yearly"):
        _credit, resp = apply_yearly_scheme_credit(company_id, vendor, mill_apply)
        if resp:
            return resp
    return None


def parse_actual_lorry_fare(body: Optional[dict]) -> Decimal:
    body = body or {}
    if "actual_lorry_fare" in body and body.get("actual_lorry_fare") not in (None, ""):
        return _q(body.get("actual_lorry_fare"))
    raw = body.get("lorry_payment")
    if isinstance(raw, dict):
        return _q(raw.get("amount"))
    return Decimal("0.00")


def apply_bill_lorry_fare_expense(company_id: int, bill: Bill, body: dict) -> Optional[str]:
    """Pay the driver the actual fare (not the mill). Extra over mill share is our transport cost."""
    fare = parse_actual_lorry_fare(body)
    if fare <= 0:
        fare = _q(getattr(bill, "actual_lorry_fare", 0))
    if fare <= 0:
        return None
    entry_number = f"AUTO-LORRY-{bill.id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return None
    freight = _ensure_core_posting_account(company_id, CODE_FREIGHT_EXPENSE) or _ensure_core_posting_account(
        company_id, "6900"
    )
    raw = body.get("lorry_payment") if isinstance(body.get("lorry_payment"), dict) else {}
    bank_id = raw.get("bank_account_id") if raw else body.get("lorry_bank_account_id")
    try:
        bank_id = int(bank_id) if bank_id not in (None, "") else None
    except (TypeError, ValueError):
        bank_id = None
    method = (raw.get("payment_method") if raw else None) or "cash"
    cash_bank = _debit_account_for_paid_sale(company_id, method, bank_id)
    if not freight or not cash_bank:
        return (
            "Could not post lorry fare: need a freight/expense account (7100) and cash/bank. "
            "The mill bill was saved; record the driver payment as an expense if this persists."
        )
    mill_share = bill_transport_total(bill)
    extra = _q(fare - mill_share) if mill_share > 0 else fare
    memo = (
        f"Lorry fare {fare} for bill {bill.bill_number}"
        + (f" (mill share {mill_share}, our extra {extra})" if mill_share > 0 else "")
    )[:300]
    je = _create_posted_entry(
        company_id,
        bill.bill_date or date.today(),
        entry_number,
        f"Lorry fare bill {bill.bill_number}",
        [
            (freight, fare, Decimal("0"), memo),
            (cash_bank, Decimal("0"), fare, memo),
        ],
    )
    if not je:
        return "Could not post the lorry fare journal (unbalanced or missing accounts)."
    return None


def parse_cash_payment_amount(body: dict) -> Decimal:
    raw = body.get("cash_payment")
    if not isinstance(raw, dict):
        try:
            return _q(body.get("cash_payment_amount"))
        except Exception:
            return Decimal("0.00")
    return _q(raw.get("amount"))


def apply_bill_cash_payment(company_id: int, bill: Bill, body: dict) -> Optional[str]:
    """Optional COD / shortfall cash on the same save as a posted bill. Returns error detail or None."""
    raw = body.get("cash_payment")
    if not raw:
        return None
    if not isinstance(raw, dict):
        return "cash_payment must be an object"
    amount = _q(raw.get("amount"))
    if amount <= 0:
        return None
    if not bill.vendor_id:
        return "cash_payment requires a vendor bill"
    from api.models import BankAccount

    bank_id = raw.get("bank_account_id")
    if bank_id:
        try:
            bank_id = int(bank_id)
        except (TypeError, ValueError):
            bank_id = None
        if bank_id and not BankAccount.objects.filter(id=bank_id, company_id=company_id).exists():
            bank_id = None
    else:
        bank_id = None
    alloc = min(amount, _q(bill.total))
    p = Payment(
        company_id=company_id,
        payment_type="made",
        vendor_id=bill.vendor_id,
        bank_account_id=bank_id,
        amount=amount,
        payment_date=_parse_date(raw.get("payment_date")) or bill.bill_date or date.today(),
        payment_method=(raw.get("payment_method") or "cash").strip()[:32] or "cash",
        reference=(raw.get("reference") or raw.get("reference_number") or "")[:200],
        memo=(raw.get("memo") or f"Cash with bill {bill.bill_number}")[:5000],
    )
    p.save()
    if alloc > 0:
        PaymentBillAllocation.objects.create(payment_id=p.id, bill_id=bill.id, amount=alloc)
    sync_payment_made_gl(company_id, p)
    refresh_bills_touched_by_payment(company_id, p.id)
    return None


def bill_line_purchase_term_kwargs(pl: dict) -> dict:
    return {
        "mrp": _q(pl.get("mrp")),
        "instant_discount_amount": _q(pl.get("instant_discount_amount")),
        "transport_amount": _q(pl.get("transport_amount")),
    }

def report_mill_dealer_terms(
    company_id: int,
    start: date,
    end: date,
) -> dict[str, Any]:
    """
    Feed/medicine mill totals for a period: discount, mill lorry, monthly commission,
    and yearly commission when the tonnage target is reached (or progress toward it).
    """
    vendors = list(
        Vendor.objects.filter(
            company_id=company_id,
            supplier_category__in=Vendor.PURCHASE_TERMS_CATEGORIES,
            is_active=True,
        ).order_by("display_name", "company_name", "id")
    )
    rows: list[dict[str, Any]] = []
    tot_mrp = Decimal("0.00")
    tot_disc = Decimal("0.00")
    tot_lorry = Decimal("0.00")
    tot_fare = Decimal("0.00")
    tot_net = Decimal("0.00")
    tot_monthly = Decimal("0.00")
    tot_yearly = Decimal("0.00")

    for vendor in vendors:
        bills = list(
            Bill.objects.filter(
                company_id=company_id,
                vendor_id=vendor.id,
                bill_date__gte=start,
                bill_date__lte=end,
            )
            .exclude(status__in=("draft", "void"))
            .prefetch_related("lines")
        )
        mrp = Decimal("0.00")
        disc = Decimal("0.00")
        lorry = Decimal("0.00")
        fare = Decimal("0.00")
        net = Decimal("0.00")
        for bill in bills:
            mrp += bill_gross_mrp(bill)
            disc += bill_instant_discount_total(bill)
            lorry += bill_transport_total(bill)
            fare += _q(getattr(bill, "actual_lorry_fare", 0))
            net += _q(bill.total)
        card = active_rate_card(vendor, end)
        monthly_pct = _q(card.monthly_rebate_percent, _Q4) if card else Decimal("0")
        yearly_pct = _q(card.yearly_rebate_percent, _Q4) if card else Decimal("0")
        monthly_est = _q(mrp * monthly_pct / Decimal("100")) if monthly_pct > 0 else Decimal("0")
        scheme = scheme_progress(company_id, vendor, end) if uses_purchase_terms(vendor) else {}
        year_tons = _q(scheme.get("year_tons") or 0, _Q4)
        target_tons = _q(scheme.get("yearly_target_tons") or 0, _Q4)
        target_reached = bool(scheme.get("yearly_target_reached"))
        yearly_est = _q(scheme.get("estimated_yearly_credit") or 0) if target_reached else Decimal("0")
        # If no tonnage target is set, yearly % of year MRP still counts as earnable.
        if yearly_pct > 0 and target_tons <= 0:
            yearly_est = _q(scheme.get("estimated_yearly_credit") or 0)
            target_reached = yearly_est > 0
        rows.append(
            {
                "vendor_id": vendor.id,
                "vendor_number": vendor.vendor_number or "",
                "display_name": (vendor.display_name or vendor.company_name or "").strip(),
                "supplier_category": vendor.supplier_category or "",
                "supplier_category_label": supplier_category_label(vendor.supplier_category),
                "bill_count": len(bills),
                "gross_mrp_total": str(mrp),
                "discount_total": str(disc),
                "lorry_total": str(lorry),
                "actual_lorry_fare_total": str(fare),
                "net_bill_total": str(net),
                "monthly_rebate_percent": str(monthly_pct),
                "monthly_commission": str(monthly_est),
                "yearly_rebate_percent": str(yearly_pct),
                "yearly_target_tons": str(target_tons),
                "year_tons": str(year_tons),
                "yearly_target_reached": target_reached,
                "yearly_commission": str(yearly_est),
                "yearly_commission_posted": bool(scheme.get("yearly_credit_posted")),
                "monthly_commission_posted": bool(scheme.get("monthly_credit_posted")),
            }
        )
        tot_mrp += mrp
        tot_disc += disc
        tot_lorry += lorry
        tot_fare += fare
        tot_net += net
        tot_monthly += monthly_est
        tot_yearly += yearly_est

    return {
        "report_id": "mill-dealer-terms",
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "vendor_count": len(rows),
            "gross_mrp_total": str(tot_mrp),
            "discount_total": str(tot_disc),
            "lorry_total": str(tot_lorry),
            "actual_lorry_fare_total": str(tot_fare),
            "net_bill_total": str(tot_net),
            "monthly_commission": str(tot_monthly),
            "yearly_commission": str(tot_yearly),
        },
        "vendors": rows,
        "accounting_note": (
            "Discount and mill transport credit (৳ per ton) are taken when feed/medicine bills are posted. "
            "Monthly commission is % of period MRP from the mill rate card (counts automatically). "
            "Yearly commission shows only when the tonnage target is reached (or when no target is set). "
            "Monthly/yearly amounts credit your mill A/P only after their official approval. "
            "Actual driver pay is also ৳/ton × ordered tons; mill transport credit is tons × mill ৳/ton from the rate card."
        ),
    }
