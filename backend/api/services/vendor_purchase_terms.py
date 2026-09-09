"""Feed/medicine mill purchase terms: credit facility, rate cards, scheme credits.

Vendor types (supplier_category) classify every supplier. Mill dealer schemes
(instant MRP discount, transport deduction, volume rebates, credit limit) apply
to Feed and Medicine. Other types keep ordinary vendor-bill behaviour.
"""
from __future__ import annotations

import calendar
import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.db import transaction
from django.db.models import F
from django.http import JsonResponse

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
)
from api.services.gl_posting import (
    CODE_AP,
    _coa,
    _create_posted_entry,
    _ensure_core_posting_account,
    bill_eligible_for_posting,
    sync_payment_made_gl,
)
from api.services.party_balance_sync import refresh_vendor_balance
from api.services.payment_allocation import (
    compute_vendor_balance_due,
    refresh_bills_touched_by_payment,
)

_MONEY = Decimal("0.01")
_Q4 = Decimal("0.0001")
CODE_REBATE_INCOME = "4400"
CODE_OTHER_REV = "4230"

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
    return {
        "id": card.id,
        "effective_from": card.effective_from.isoformat(),
        "effective_to": card.effective_to.isoformat() if card.effective_to else None,
        "instant_discount_percent": str(_q(card.instant_discount_percent, _Q4)),
        "instant_discount_per_unit": str(_q(card.instant_discount_per_unit, _Q4)),
        "transport_per_unit": str(_q(card.transport_per_unit, _Q4)),
        "transport_per_kg": str(_q(card.transport_per_kg, _Q4)),
        "monthly_rebate_percent": str(_q(card.monthly_rebate_percent, _Q4)),
        "yearly_rebate_percent": str(_q(card.yearly_rebate_percent, _Q4)),
        "yearly_target_kg": str(_q(card.yearly_target_kg, _Q4)),
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
    transport = _q(qty * _q(card.transport_per_unit, _Q4))
    transport += _q(kg * _q(card.transport_per_kg, _Q4))
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
    for fname in (
        "instant_discount_percent",
        "instant_discount_per_unit",
        "transport_per_unit",
        "transport_per_kg",
        "monthly_rebate_percent",
        "yearly_rebate_percent",
        "yearly_target_kg",
    ):
        if fname in raw:
            val = _q(raw.get(fname), _Q4)
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


def scheme_progress(company_id: int, vendor: Vendor, as_of: Optional[date] = None) -> dict[str, Any]:
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
    return {
        "as_of": as_of.isoformat(),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "year_start": year_start.isoformat(),
        "year_end": year_end.isoformat(),
        "month_mrp": str(_q(month_mrp)),
        "year_mrp": str(_q(year_mrp)),
        "year_kg": str(_q(year_kg, _Q4)),
        "yearly_target_kg": str(target),
        "monthly_rebate_percent": str(monthly_pct),
        "yearly_rebate_percent": str(yearly_pct),
        "estimated_monthly_credit": str(monthly_est),
        "estimated_yearly_credit": str(yearly_est),
        "yearly_target_reached": yearly_earned,
    }


def purchase_terms_payload(company_id: int, vendor: Vendor, as_of: Optional[date] = None) -> dict[str, Any]:
    as_of = as_of or date.today()
    snap = vendor_credit_snapshot(company_id, vendor, as_of=as_of)
    card = active_rate_card(vendor, as_of)
    credits = [
        vendor_credit_to_json(c)
        for c in VendorCredit.objects.filter(company_id=company_id, vendor_id=vendor.id)[:25]
    ]
    return {
        **snap,
        "rate_card": rate_card_to_json(card),
        "scheme": scheme_progress(company_id, vendor, as_of) if uses_purchase_terms(vendor) else None,
        "recent_credits": credits,
    }


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
    }


def _post_vendor_credit_journal(company_id: int, credit: VendorCredit) -> Optional[JournalEntry]:
    ap = _ensure_core_posting_account(company_id, CODE_AP)
    income = _coa(company_id, CODE_REBATE_INCOME) or _coa(company_id, CODE_OTHER_REV)
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
    credit.save()
    je = _post_vendor_credit_journal(company_id, credit)
    with transaction.atomic():
        row = VendorCredit.objects.select_for_update().filter(pk=credit.pk).first()
        if row and not row.vendor_ap_decremented:
            Vendor.objects.filter(pk=vendor.id).update(current_balance=F("current_balance") - amount)
            VendorCredit.objects.filter(pk=row.pk).update(
                vendor_ap_decremented=True,
                journal_id=je.id if je else None,
            )
    refresh_vendor_balance(company_id, vendor.id)
    credit.refresh_from_db()
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
        row.delete()
    if vid:
        refresh_vendor_balance(company_id, vid)


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
