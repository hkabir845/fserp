"""Cashier POS API: fuel sale (POST /cashier/sale), general sale (POST /cashier/pos). Uses Django only."""
import logging
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.utils.auth import auth_required
from api.utils.pos_payment import is_on_account_payment, normalize_pos_payment_method
from api.views.common import require_company_id, parse_json_body
from api.models import (
    BankAccount,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    Meter,
    Nozzle,
    ShiftSession,
    Tank,
)
from api.services.gl_posting import _is_walkin_customer, sync_invoice_gl
from api.services.shift_sales import record_invoice_on_shift

logger = logging.getLogger(__name__)


def _get_or_create_walkin_customer(company_id: int) -> Customer:
    """Get or create a 'Walk-in' customer for cash sales."""
    c = Customer.objects.filter(
        company_id=company_id,
        display_name__iexact="Walk-in",
        is_active=True,
    ).first()
    if c:
        return c
    c = Customer(
        company_id=company_id,
        display_name="Walk-in",
        customer_number="WALK-IN",
        is_active=True,
    )
    c.save()
    return c


def _coerce_optional_bank_account_id(
    company_id: int, body: dict
) -> tuple[int | None, JsonResponse | None]:
    """
    When set, sale GL debits this register's linked chart account (cash/bank in the books).
    Omit or null to use default cash / undeposited / card-clearing rules from gl_posting.
    """
    raw = body.get("bank_account_id")
    if raw is None or raw == "":
        return None, None
    try:
        bid = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse({"detail": "Invalid bank_account_id"}, status=400)
    if not BankAccount.objects.filter(
        id=bid, company_id=company_id, is_active=True
    ).exists():
        return None, JsonResponse(
            {"detail": "Unknown or inactive bank_account_id for this company"},
            status=400,
        )
    return bid, None


def _shift_for_sale(company_id: int, body: dict, station_id: int | None) -> ShiftSession | None:
    sid = body.get("shift_session_id")
    if sid is not None:
        try:
            q = ShiftSession.objects.filter(
                id=int(sid), company_id=company_id, closed_at__isnull=True
            ).first()
            if q:
                return q
        except (TypeError, ValueError):
            pass
    if station_id:
        q = ShiftSession.objects.filter(
            company_id=company_id, station_id=station_id, closed_at__isnull=True
        ).first()
        if q:
            return q
    return ShiftSession.objects.filter(
        company_id=company_id, closed_at__isnull=True
    ).first()


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def cashier_sale(request):
    """POST /api/cashier/sale - record a fuel sale (nozzle, quantity, amount)."""
    body, err = parse_json_body(request)
    if err:
        return err
    nozzle_id = body.get("nozzle_id")
    quantity = body.get("quantity")
    amount = body.get("amount")
    customer_id = body.get("customer_id")
    payment_method_raw = body.get("payment_method")
    pm_norm = normalize_pos_payment_method(payment_method_raw)
    on_account = is_on_account_payment(payment_method_raw)
    if not nozzle_id or quantity is None:
        return JsonResponse(
            {"detail": "nozzle_id and quantity are required"},
            status=400,
        )
    try:
        qty = Decimal(str(quantity))
        amt = Decimal(str(amount)) if amount is not None else qty
    except Exception:
        return JsonResponse({"detail": "Invalid quantity or amount"}, status=400)
    if qty <= 0:
        return JsonResponse({"detail": "Quantity must be positive"}, status=400)

    company_id = request.company_id
    nozzle = (
        Nozzle.objects.filter(id=nozzle_id, company_id=company_id)
        .select_related("meter", "tank", "product")
        .first()
    )
    if not nozzle:
        return JsonResponse({"detail": "Nozzle not found"}, status=404)
    meter = nozzle.meter
    tank = nozzle.tank
    product = nozzle.product
    if not product:
        return JsonResponse({"detail": "Nozzle has no product"}, status=400)

    customer = None
    if customer_id:
        customer = Customer.objects.filter(
            id=customer_id, company_id=company_id, is_active=True
        ).first()
    bank_account_id = None
    if on_account:
        if not customer:
            return JsonResponse(
                {
                    "detail": "On-account (A/R) sales require a named customer. Select a customer other than Walk-in."
                },
                status=400,
            )
        if _is_walkin_customer(customer):
            return JsonResponse(
                {
                    "detail": "On-account sales cannot use the Walk-in customer. Select a credit / house-account customer."
                },
                status=400,
            )
    else:
        if not customer:
            customer = _get_or_create_walkin_customer(company_id)
        bank_account_id, berr = _coerce_optional_bank_account_id(company_id, body)
        if berr:
            return berr

    unit_price = product.unit_price or 0
    line_amount = (qty * unit_price).quantize(Decimal("0.01"))
    station_id = tank.station_id if tank else None
    shift = _shift_for_sale(company_id, body, station_id)
    pm = pm_norm[:32]
    inv_status = "sent" if on_account else "paid"
    due_date = (
        timezone.localdate() + timedelta(days=30) if on_account else None
    )

    try:
        with transaction.atomic():
            inv = Invoice(
                company_id=company_id,
                customer=customer,
                shift_session=shift,
                invoice_number="INV-POS-TMP",
                invoice_date=timezone.localdate(),
                due_date=due_date,
                status=inv_status,
                subtotal=line_amount,
                tax_total=Decimal("0"),
                total=line_amount,
                payment_method=pm,
            )
            inv.save()
            inv.invoice_number = f"INV-POS-{inv.id}"
            inv.save(update_fields=["invoice_number"])

            InvoiceLine.objects.create(
                invoice=inv,
                item=product,
                description=product.name,
                quantity=qty,
                unit_price=unit_price,
                amount=line_amount,
            )

            if meter:
                Meter.objects.filter(pk=meter.pk).update(
                    current_reading=meter.current_reading + qty
                )
            if tank:
                new_stock = tank.current_stock - qty
                if new_stock < 0:
                    new_stock = Decimal("0")
                Tank.objects.filter(pk=tank.pk).update(current_stock=new_stock)

            inv = Invoice.objects.filter(id=inv.id).select_related("customer").first()
            sync_invoice_gl(
                company_id,
                inv,
                payment_method=pm_norm,
                bank_account_id=bank_account_id,
            )
            record_invoice_on_shift(
                company_id, shift.id if shift else None, line_amount, pm_norm
            )

        detail = (
            "Sale recorded on account (open A/R). Record payment in Payments / Received when the customer pays."
            if on_account
            else "Sale recorded"
        )
        payload = {
            "detail": detail,
            "invoice_id": inv.id,
            "invoice_number": inv.invoice_number,
        }
        if on_account:
            payload["invoice_status"] = "sent"
            payload["billing"] = "accounts_receivable"
        return JsonResponse(payload, status=201)
    except Exception as e:
        logger.exception("cashier_sale failed")
        return JsonResponse(
            {"detail": "Failed to record sale", "error": str(e)},
            status=500,
        )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def cashier_pos(request):
    """POST /api/cashier/pos - record a general POS sale (items in cart)."""
    body, err = parse_json_body(request)
    if err:
        return err
    items = body.get("items") or []
    customer_id = body.get("customer_id")
    payment_method_raw = body.get("payment_method")
    pm_norm = normalize_pos_payment_method(payment_method_raw)
    on_account = is_on_account_payment(payment_method_raw)
    if not items or not isinstance(items, list):
        return JsonResponse({"detail": "items array is required"}, status=400)

    company_id = request.company_id

    lines_data = []
    for row in items:
        item_id = row.get("item_id")
        qty = row.get("quantity")
        unit_price = row.get("unit_price")
        discount_percent = row.get("discount_percent") or 0
        if not item_id or qty is None:
            continue
        try:
            q = Decimal(str(qty))
            if q <= 0:
                continue
        except Exception:
            continue
        item = Item.objects.filter(id=item_id, company_id=company_id).first()
        if not item:
            continue
        up = unit_price
        if up is not None:
            try:
                up = Decimal(str(up))
            except Exception:
                up = item.unit_price or Decimal("0")
        else:
            up = item.unit_price or Decimal("0")
        try:
            d = Decimal(str(discount_percent))
            d = max(Decimal("0"), min(Decimal("100"), d))
        except Exception:
            d = Decimal("0")
        line_amount = (q * up * (1 - d / 100)).quantize(Decimal("0.01"))
        lines_data.append(
            {"item": item, "quantity": q, "unit_price": up, "discount_percent": d, "amount": line_amount}
        )

    if not lines_data:
        return JsonResponse({"detail": "No valid items"}, status=400)

    customer = None
    if customer_id:
        customer = Customer.objects.filter(
            id=customer_id, company_id=company_id, is_active=True
        ).first()
    bank_account_id = None
    if on_account:
        if not customer:
            return JsonResponse(
                {
                    "detail": "On-account (A/R) sales require a named customer. Select a customer other than Walk-in."
                },
                status=400,
            )
        if _is_walkin_customer(customer):
            return JsonResponse(
                {
                    "detail": "On-account sales cannot use the Walk-in customer. Select a credit / house-account customer."
                },
                status=400,
            )
    else:
        if not customer:
            customer = _get_or_create_walkin_customer(company_id)
        bank_account_id, berr = _coerce_optional_bank_account_id(company_id, body)
        if berr:
            return berr

    subtotal = sum(d["amount"] for d in lines_data)
    total = subtotal.quantize(Decimal("0.01"))
    shift = _shift_for_sale(company_id, body, None)
    pm = pm_norm[:32]
    inv_status = "sent" if on_account else "paid"
    due_date = (
        timezone.localdate() + timedelta(days=30) if on_account else None
    )

    try:
        with transaction.atomic():
            inv = Invoice(
                company_id=company_id,
                customer=customer,
                shift_session=shift,
                invoice_number="INV-POS-TMP",
                invoice_date=timezone.localdate(),
                due_date=due_date,
                status=inv_status,
                subtotal=subtotal,
                tax_total=Decimal("0"),
                total=total,
                payment_method=pm,
            )
            inv.save()
            inv.invoice_number = f"INV-POS-{inv.id}"
            inv.save(update_fields=["invoice_number"])

            for d in lines_data:
                InvoiceLine.objects.create(
                    invoice=inv,
                    item=d["item"],
                    description=d["item"].name,
                    quantity=d["quantity"],
                    unit_price=d["unit_price"],
                    amount=d["amount"],
                )
                if d["item"].quantity_on_hand is not None:
                    new_qty = d["item"].quantity_on_hand - d["quantity"]
                    if new_qty < 0:
                        new_qty = Decimal("0")
                    Item.objects.filter(pk=d["item"].pk).update(quantity_on_hand=new_qty)

            inv = Invoice.objects.filter(id=inv.id).select_related("customer").first()
            sync_invoice_gl(
                company_id,
                inv,
                payment_method=pm_norm,
                bank_account_id=bank_account_id,
            )
            record_invoice_on_shift(
                company_id, shift.id if shift else None, total, pm_norm
            )

        detail = (
            "Sale recorded on account (open A/R). Record payment in Payments / Received when the customer pays."
            if on_account
            else "Sale recorded"
        )
        payload = {
            "detail": detail,
            "invoice_id": inv.id,
            "invoice_number": inv.invoice_number,
        }
        if on_account:
            payload["invoice_status"] = "sent"
            payload["billing"] = "accounts_receivable"
        return JsonResponse(payload, status=201)
    except Exception as e:
        logger.exception("cashier_pos failed")
        return JsonResponse(
            {"detail": "Failed to record sale", "error": str(e)},
            status=500,
        )
