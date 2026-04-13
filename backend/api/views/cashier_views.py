"""Cashier POS API: fuel sale (POST /cashier/sale), unified POS (POST /cashier/pos). Uses Django only."""
import logging
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.db.models import F
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


def _parse_general_lines(company_id: int, items: list) -> list:
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
            {
                "item": item,
                "quantity": q,
                "unit_price": up,
                "discount_percent": d,
                "amount": line_amount,
            }
        )
    return lines_data


def _parse_fuel_lines(
    company_id: int, fuel_lines: list
) -> tuple[list | None, JsonResponse | None]:
    """Parse fuel_lines; unknown nozzle returns 404."""
    result = []
    for row in fuel_lines:
        nozzle_id = row.get("nozzle_id")
        quantity = row.get("quantity")
        if not nozzle_id or quantity is None:
            continue
        try:
            qty = Decimal(str(quantity))
        except Exception:
            continue
        if qty <= 0:
            continue
        nozzle = (
            Nozzle.objects.filter(id=nozzle_id, company_id=company_id)
            .select_related("meter", "tank", "product")
            .first()
        )
        if not nozzle:
            return None, JsonResponse({"detail": "Nozzle not found"}, status=404)
        product = nozzle.product
        if not product:
            return None, JsonResponse({"detail": "Nozzle has no product"}, status=400)
        unit_price = product.unit_price or Decimal("0")
        line_amount = (qty * unit_price).quantize(Decimal("0.01"))
        result.append(
            {
                "nozzle": nozzle,
                "meter": nozzle.meter,
                "tank": nozzle.tank,
                "product": product,
                "quantity": qty,
                "unit_price": unit_price,
                "amount": line_amount,
            }
        )
    return result, None


def _resolve_pos_customer_and_bank(
    company_id: int, body: dict, customer_id, on_account: bool
) -> tuple[Customer | None, int | None, JsonResponse | None]:
    customer = None
    if customer_id:
        customer = Customer.objects.filter(
            id=customer_id, company_id=company_id, is_active=True
        ).first()
    bank_account_id = None
    if on_account:
        if not customer:
            return None, None, JsonResponse(
                {
                    "detail": "On-account (A/R) sales require a named customer. Select a customer other than Walk-in."
                },
                status=400,
            )
        if _is_walkin_customer(customer):
            return None, None, JsonResponse(
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
            return None, None, berr
    return customer, bank_account_id, None


def _cashier_pos_unified(company_id: int, body: dict) -> JsonResponse:
    """Create one invoice from general item lines and/or fuel nozzle lines."""
    items_raw = body.get("items")
    fuel_raw = body.get("fuel_lines")

    if items_raw is not None and not isinstance(items_raw, list):
        return JsonResponse({"detail": "items must be an array"}, status=400)
    if fuel_raw is not None and not isinstance(fuel_raw, list):
        return JsonResponse({"detail": "fuel_lines must be an array"}, status=400)

    items = list(items_raw) if isinstance(items_raw, list) else []
    fuel_lines_in = list(fuel_raw) if isinstance(fuel_raw, list) else []

    lines_data = _parse_general_lines(company_id, items)
    fuel_entries, ferr = _parse_fuel_lines(company_id, fuel_lines_in)
    if ferr:
        return ferr

    if not lines_data and not fuel_entries:
        return JsonResponse(
            {"detail": "No valid items or fuel lines"},
            status=400,
        )

    customer_id = body.get("customer_id")
    payment_method_raw = body.get("payment_method")
    pm_norm = normalize_pos_payment_method(payment_method_raw)
    on_account = is_on_account_payment(payment_method_raw)

    customer, bank_account_id, cerr = _resolve_pos_customer_and_bank(
        company_id, body, customer_id, on_account
    )
    if cerr:
        return cerr

    station_id = None
    if fuel_entries:
        t0 = fuel_entries[0]["tank"]
        station_id = t0.station_id if t0 else None

    subtotal = sum(d["amount"] for d in lines_data) + sum(
        fe["amount"] for fe in fuel_entries
    )
    total = subtotal.quantize(Decimal("0.01"))
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
                subtotal=subtotal,
                tax_total=Decimal("0"),
                total=total,
                payment_method=pm,
            )
            inv.save()
            inv.invoice_number = f"INV-POS-{inv.id}"
            inv.save(update_fields=["invoice_number"])

            for fe in fuel_entries:
                product = fe["product"]
                qty = fe["quantity"]
                meter = fe["meter"]
                tank = fe["tank"]
                unit_price = fe["unit_price"]
                line_amount = fe["amount"]
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
                        current_reading=F("current_reading") + qty
                    )
                if tank:
                    tk = Tank.objects.select_for_update().get(pk=tank.pk)
                    new_stock = tk.current_stock - qty
                    if new_stock < 0:
                        new_stock = Decimal("0")
                    Tank.objects.filter(pk=tank.pk).update(current_stock=new_stock)

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
        logger.exception("cashier_pos_unified failed")
        return JsonResponse(
            {"detail": "Failed to record sale", "error": str(e)},
            status=500,
        )


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
    if not nozzle_id or quantity is None:
        return JsonResponse(
            {"detail": "nozzle_id and quantity are required"},
            status=400,
        )
    try:
        qty = Decimal(str(quantity))
        if amount is not None:
            Decimal(str(amount))
    except Exception:
        return JsonResponse({"detail": "Invalid quantity or amount"}, status=400)
    if qty <= 0:
        return JsonResponse({"detail": "Quantity must be positive"}, status=400)

    company_id = request.company_id
    unified_body = {
        **body,
        "items": [],
        "fuel_lines": [
            {
                "nozzle_id": nozzle_id,
                "quantity": str(qty),
                **({"amount": amount} if amount is not None else {}),
            }
        ],
    }
    return _cashier_pos_unified(company_id, unified_body)


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@require_company_id
def cashier_pos(request):
    """POST /api/cashier/pos - record POS sale: general items, fuel lines, or both."""
    body, err = parse_json_body(request)
    if err:
        return err
    return _cashier_pos_unified(request.company_id, body)
