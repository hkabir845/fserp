"""Bills API: list, create, get, update, delete (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.exceptions import StockBusinessError
from api.models import Bill, BillLine, PaymentBillAllocation, Station, Tank, Vendor
from api.services.station_stock import get_or_create_default_station
from api.services.gl_posting import (
    bill_eligible_for_posting,
    cleanup_vendor_bill_posting_effects,
    sync_posted_vendor_bill,
    undo_bill_stock_receipt,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id


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


def _bill_to_json(b):
    lines = list(b.lines.all().select_related("item", "tank"))
    total = b.total or Decimal("0")
    tax = b.tax_total or Decimal("0")
    sub = b.subtotal or Decimal("0")
    paid = _amount_paid(b)
    bal = _balance_due(b)
    return {
        "id": b.id,
        "bill_number": b.bill_number,
        "bill_date": _serialize_date(b.bill_date),
        "due_date": _serialize_date(b.due_date),
        "vendor_id": b.vendor_id,
        "vendor_name": b.vendor.company_name if b.vendor_id else "",
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
        "lines": [
            {
                "id": l.id,
                "line_number": getattr(l, "line_number", 0),
                "item_id": l.item_id,
                "description": l.description or "",
                "quantity": str(l.quantity),
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
            }
            for l in lines
        ],
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
    tank = Tank.objects.filter(id=tid, company_id=company_id, is_active=True).first()
    if not tank:
        return None, JsonResponse(
            {"detail": "Unknown or inactive tank for this company"}, status=400
        )
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
    qs = (
        Bill.objects.filter(company_id=request.company_id)
        .select_related("vendor", "receipt_station")
        .prefetch_related("lines__item", "lines__tank", "payment_allocations")
        .order_by("-bill_date", "-id")
    )
    status_filter = request.GET.get("status_filter", "").strip()
    if status_filter:
        qs = qs.filter(status=status_filter)
    return JsonResponse([_bill_to_json(b) for b in qs], safe=False)


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
    count = Bill.objects.filter(company_id=request.company_id).count()
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
            .only("default_station_id")
            .first()
        )
        if (
            vrow
            and vrow.default_station_id
            and Station.objects.filter(
                pk=vrow.default_station_id,
                company_id=request.company_id,
                is_active=True,
            ).exists()
        ):
            receipt_station_id = vrow.default_station_id
        else:
            # Single-site and multi-site: default receiving location so GL/stock and reports stay consistent.
            receipt_station_id = get_or_create_default_station(request.company_id).id

    try:
        with transaction.atomic():
            b = Bill(
                company_id=request.company_id,
                vendor_id=vendor_id,
                receipt_station_id=receipt_station_id,
                bill_number=f"BILL-{count + 1}",
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
            for i, row in enumerate(body.get("lines") or []):
                amt = _decimal(row.get("amount"), _decimal(row.get("quantity"), 1) * _decimal(row.get("unit_cost", row.get("unit_price")), 0))
                item_id = _coerce_item_id(row)
                tank_id, terr = _coerce_line_tank_id(request.company_id, row, item_id)
                if terr:
                    transaction.set_rollback(True)
                    return terr
                BillLine.objects.create(
                    bill=b,
                    item_id=item_id,
                    tank_id=tank_id,
                    description=row.get("description") or "",
                    quantity=_decimal(row.get("quantity"), 1),
                    unit_price=_decimal(row.get("unit_cost", row.get("unit_price")), 0),
                    amount=amt,
                )
            b.tax_total = tax_total
            b.save(update_fields=["tax_total", "updated_at"])
            _refresh_bill_totals_from_lines(b)
            b.refresh_from_db()
            b = (
                Bill.objects.filter(id=b.id)
                .select_related("vendor", "receipt_station")
                .prefetch_related("lines__item", "lines__tank", "payment_allocations")
                .first()
            )
            if bill_eligible_for_posting(b):
                sync_posted_vendor_bill(
                    request.company_id,
                    b,
                    acknowledge_tank_overfill=ack_tank_overfill,
                )
    except StockBusinessError as e:
        return JsonResponse({"detail": e.detail}, status=400)
    return JsonResponse(_bill_to_json(b), status=201)


@csrf_exempt
@auth_required
@require_company_id
def bill_detail(request, bill_id: int):
    b = (
        Bill.objects.filter(id=bill_id, company_id=request.company_id)
        .select_related("vendor", "receipt_station")
        .prefetch_related("lines__item", "lines__tank", "payment_allocations")
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
        if "lines" in body:
            parsed_lines = []
            for row in body.get("lines") or []:
                amt = _decimal(
                    row.get("amount"),
                    _decimal(row.get("quantity"), 1)
                    * _decimal(row.get("unit_cost", row.get("unit_price")), 0),
                )
                item_id = _coerce_item_id(row)
                tank_id, terr = _coerce_line_tank_id(request.company_id, row, item_id)
                if terr:
                    return terr
                parsed_lines.append(
                    {
                        "item_id": item_id,
                        "tank_id": tank_id,
                        "description": row.get("description") or "",
                        "quantity": _decimal(row.get("quantity"), 1),
                        "unit_price": _decimal(row.get("unit_cost", row.get("unit_price")), 0),
                        "amount": amt,
                    }
                )
        try:
            with transaction.atomic():
                b.save()
                if parsed_lines is not None:
                    undo_bill_stock_receipt(b)
                    b.refresh_from_db(fields=["stock_receipt_applied"])
                    b.lines.all().delete()
                    for pl in parsed_lines:
                        BillLine.objects.create(
                            bill=b,
                            item_id=pl["item_id"],
                            tank_id=pl["tank_id"],
                            description=pl["description"],
                            quantity=pl["quantity"],
                            unit_price=pl["unit_price"],
                            amount=pl["amount"],
                        )
                _refresh_bill_totals_from_lines(b)
                b.refresh_from_db()
                b = (
                    Bill.objects.filter(id=b.id)
                    .select_related("vendor", "receipt_station")
                    .prefetch_related("lines__item", "lines__tank", "payment_allocations")
                    .first()
                )
                if bill_eligible_for_posting(b):
                    sync_posted_vendor_bill(
                        request.company_id,
                        b,
                        acknowledge_tank_overfill=ack_tank_overfill,
                    )
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
