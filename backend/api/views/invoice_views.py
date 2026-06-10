"""Invoices API: list, create, get, update, delete, status (company-scoped)."""
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.utils.customer_display import customer_display_name
from api.views.common import parse_json_body, require_company_id
from api.services.coa_gl_defaults import ALLOWED_INCOME, parse_optional_chart_account_id
from api.models import Invoice, InvoiceLine, Customer, ShiftSession
from api.services.document_posting_lifecycle import (
    body_has_material_invoice_change,
    reconcile_invoice_after_material_edit,
)
from api.services.gl_posting import cleanup_invoice_posting_effects, sync_invoice_gl
from api.services.invoice_station import (
    default_station_id_for_document,
    parse_valid_station_id,
    resolve_station_id_for_new_invoice,
)
from api.services.payment_allocation import invoice_balance_due
from api.services.reference_code import next_available_code


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _derive_invoice_list_source(inv: Invoice) -> str:
    """UI source badge (no DB column); POS and aquaculture use stable number prefixes."""
    n = (inv.invoice_number or "").strip().upper()
    if n.startswith("INV-AQ-"):
        return "aquaculture_pond_sale"
    if n.startswith("INV-POS-"):
        return "pos_general"
    return "manual"


def _invoice_to_json(inv, company_id: int):
    lines = list(inv.lines.all().select_related("item", "revenue_account"))
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "invoice_date": _serialize_date(inv.invoice_date),
        "due_date": _serialize_date(inv.due_date),
        "customer_id": inv.customer_id,
        "customer_name": (
            customer_display_name(getattr(inv, "customer", None))
            if inv.customer_id
            else ""
        ),
        "shift_session_id": inv.shift_session_id,
        "station_id": getattr(inv, "station_id", None),
        "station_name": (
            (inv.station.station_name or "").strip()
            if getattr(inv, "station_id", None) and getattr(inv, "station", None)
            else ""
        ),
        "payment_method": inv.payment_method or "",
        "status": inv.status,
        "source": _derive_invoice_list_source(inv),
        "subtotal": str(inv.subtotal),
        "tax_total": str(inv.tax_total),
        "total": str(inv.total),
        "balance_due": str(invoice_balance_due(inv, company_id)),
        "lines": [
            {
                "id": l.id,
                "line_number": i,
                "item_id": l.item_id,
                "item_name": (l.item.name if getattr(l, "item_id", None) and getattr(l, "item", None) else "")
                or "",
                "description": l.description or "",
                "quantity": str(l.quantity),
                "unit_price": str(l.unit_price),
                "amount": str(l.amount),
                "revenue_account_id": getattr(l, "revenue_account_id", None),
            }
            for i, l in enumerate(lines, start=1)
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


def _resolve_shift(company_id: int, shift_session_id) -> ShiftSession | None:
    if not shift_session_id:
        return None
    try:
        sid = int(shift_session_id)
    except (TypeError, ValueError):
        return None
    return ShiftSession.objects.filter(
        id=sid, company_id=company_id, closed_at__isnull=True
    ).first()


def _refresh_invoice_totals_from_lines(inv: Invoice) -> None:
    """Set header subtotal/total from line amounts; preserve invoice-level tax_total."""
    sub = inv.lines.aggregate(s=Sum("amount"))["s"] or Decimal("0")
    tax = inv.tax_total if inv.tax_total is not None else Decimal("0")
    inv.subtotal = sub
    inv.total = sub + tax
    inv.save(update_fields=["subtotal", "total", "updated_at"])


@csrf_exempt
@auth_required
@require_company_id
def invoices_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = (
            Invoice.objects.filter(company_id=cid)
            .select_related("customer", "shift_session", "station")
            .prefetch_related("lines", "lines__item", "lines__revenue_account", "payment_allocations")
            .order_by("-invoice_date", "-id")
        )
        return JsonResponse([_invoice_to_json(inv, cid) for inv in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        customer_id = body.get("customer_id")
        if not customer_id or not Customer.objects.filter(id=customer_id, company_id=cid).exists():
            return JsonResponse({"detail": "Valid customer_id required"}, status=400)
        pm = (body.get("payment_method") or "").strip()[:32]
        shift = _resolve_shift(cid, body.get("shift_session_id"))
        st_raw = body.get("station_id", body.get("station"))
        station_id, s_err = resolve_station_id_for_new_invoice(
            cid, st_raw, int(customer_id)
        )
        if s_err:
            return JsonResponse({"detail": s_err}, status=400)
        assert station_id is not None
        inv = Invoice(
            company_id=cid,
            customer_id=customer_id,
            shift_session=shift,
            station_id=station_id,
            invoice_number=next_available_code(cid, Invoice, "invoice_number", "INV"),
            invoice_date=_parse_date(body.get("invoice_date")) or timezone.localdate(),
            due_date=_parse_date(body.get("due_date")),
            status=body.get("status") or "draft",
            subtotal=_decimal(body.get("subtotal")),
            tax_total=_decimal(body.get("tax_total")),
            total=_decimal(body.get("total")),
            payment_method=pm,
        )
        inv.save()
        line_rows = list(body.get("lines") or body.get("line_items") or [])
        for row in line_rows:
            amount = _decimal(row.get("amount"), _decimal(row.get("quantity"), 1) * _decimal(row.get("unit_price"), 0))
            rid, rerr = parse_optional_chart_account_id(
                cid,
                row.get("revenue_account_id"),
                allowed_normalized_types=ALLOWED_INCOME,
                field_label="revenue_account_id",
            )
            if rerr:
                return JsonResponse({"detail": rerr}, status=400)
            InvoiceLine.objects.create(
                invoice=inv,
                item_id=row.get("item_id") or None,
                description=row.get("description") or "",
                quantity=_decimal(row.get("quantity"), 1),
                unit_price=_decimal(row.get("unit_price"), 0),
                amount=amount,
                revenue_account_id=rid,
            )
        if line_rows:
            _refresh_invoice_totals_from_lines(inv)
        inv.refresh_from_db()
        inv = (
            Invoice.objects.filter(id=inv.id)
            .select_related("customer", "shift_session", "station")
            .prefetch_related("lines", "lines__item", "lines__revenue_account", "payment_allocations")
            .first()
        )
        sync_invoice_gl(
            cid,
            inv,
            payment_method=(body.get("payment_method") or "cash"),
            bank_account_id=body.get("bank_account_id"),
        )
        return JsonResponse(_invoice_to_json(inv, cid), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def invoice_detail(request, invoice_id: int):
    cid = request.company_id
    inv = (
        Invoice.objects.filter(id=invoice_id, company_id=cid)
        .select_related("customer", "shift_session", "station")
        .prefetch_related("lines", "lines__item", "lines__revenue_account", "payment_allocations")
        .first()
    )
    if not inv:
        return JsonResponse({"detail": "Invoice not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_invoice_to_json(inv, cid))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        old_status = inv.status
        material = body_has_material_invoice_change(body) and inv.status != "draft"
        inv.invoice_date = _parse_date(body.get("invoice_date")) or inv.invoice_date
        inv.due_date = _parse_date(body.get("due_date"))
        inv.subtotal = _decimal(body.get("subtotal"), inv.subtotal)
        inv.tax_total = _decimal(body.get("tax_total"), inv.tax_total)
        inv.total = _decimal(body.get("total"), inv.total)
        if "status" in body:
            inv.status = (body.get("status") or inv.status)[:32]
        if "payment_method" in body:
            inv.payment_method = (body.get("payment_method") or "").strip()[:32]
        if "shift_session_id" in body:
            inv.shift_session = _resolve_shift(cid, body.get("shift_session_id"))
        if "station_id" in body or "station" in body:
            raw = body.get("station_id", body.get("station"))
            if raw in (None, ""):
                inv.station_id = default_station_id_for_document(cid)
            else:
                sid = parse_valid_station_id(cid, raw)
                if sid is None:
                    return JsonResponse(
                        {"detail": "Unknown, inactive, or invalid station_id for this company."},
                        status=400,
                    )
                inv.station_id = sid
        inv.save()
        line_payload = body.get("lines")
        if line_payload is None and "line_items" in body:
            line_payload = body.get("line_items")
        if line_payload is not None:
            inv.lines.all().delete()
            for row in line_payload or []:
                amount = _decimal(row.get("amount"), _decimal(row.get("quantity"), 1) * _decimal(row.get("unit_price"), 0))
                rid, rerr = parse_optional_chart_account_id(
                    cid,
                    row.get("revenue_account_id"),
                    allowed_normalized_types=ALLOWED_INCOME,
                    field_label="revenue_account_id",
                )
                if rerr:
                    return JsonResponse({"detail": rerr}, status=400)
                InvoiceLine.objects.create(
                    invoice=inv,
                    item_id=row.get("item_id") or None,
                    description=row.get("description") or "",
                    quantity=_decimal(row.get("quantity"), 1),
                    unit_price=_decimal(row.get("unit_price"), 0),
                    amount=amount,
                    revenue_account_id=rid,
                )
            _refresh_invoice_totals_from_lines(inv)
        inv.refresh_from_db()
        inv = (
            Invoice.objects.filter(id=inv.id)
            .select_related("customer", "shift_session", "station")
            .prefetch_related("lines", "lines__item", "lines__revenue_account", "payment_allocations")
            .first()
        )
        if not material:
            sync_invoice_gl(
                cid,
                inv,
                old_status=old_status,
                payment_method=(body.get("payment_method") or inv.payment_method or "cash"),
                bank_account_id=body.get("bank_account_id"),
            )
        else:
            ok_post, err_post = reconcile_invoice_after_material_edit(
                cid,
                inv,
                old_status=old_status,
                payment_method=(body.get("payment_method") or inv.payment_method or "cash"),
                bank_account_id=body.get("bank_account_id"),
            )
            if not ok_post:
                return JsonResponse({"detail": err_post}, status=409)
        return JsonResponse(_invoice_to_json(inv, cid))
    if request.method == "DELETE":
        ok, err = cleanup_invoice_posting_effects(cid, inv)
        if not ok:
            return JsonResponse({"detail": err}, status=409)
        inv.delete()
        return HttpResponse(status=204)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def invoice_status(request, invoice_id: int):
    cid = request.company_id
    if request.method != "PUT":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    inv = Invoice.objects.filter(id=invoice_id, company_id=cid).select_related("customer").first()
    if not inv:
        return JsonResponse({"detail": "Invoice not found"}, status=404)
    body, err = parse_json_body(request)
    if err:
        return err
    if "status" in body:
        old_status = inv.status
        inv.status = (body.get("status") or inv.status)[:32]
        inv.save()
        inv.refresh_from_db()
        sync_invoice_gl(
            cid,
            inv,
            old_status=old_status,
            payment_method=(body.get("payment_method") or inv.payment_method or "cash"),
            bank_account_id=body.get("bank_account_id"),
        )
    inv = (
        Invoice.objects.filter(id=invoice_id, company_id=cid)
        .prefetch_related("lines", "lines__item", "lines__revenue_account", "payment_allocations")
        .select_related("customer", "shift_session", "station")
        .first()
    )
    return JsonResponse(_invoice_to_json(inv, cid))
