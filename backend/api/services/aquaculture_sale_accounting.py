"""
Book aquaculture pond harvest lines into the standard Invoice + GL pipeline.

Creates a company invoice (one line, no inventory item), links AquacultureFishSale.invoice,
and runs sync_invoice_gl so AUTO-INV-{id}-SALE posts to aquaculture revenue COA (4240–4244).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Sum

from api.models import AquacultureFishSale, ChartOfAccount, Customer, Invoice, InvoiceLine
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_constants import (
    INCOME_TYPE_LABELS,
    coa_account_code_for_aquaculture_income_type,
    fish_species_display_label,
)
from api.services.gl_posting import sync_invoice_gl
from api.services.invoice_station import resolve_station_id_for_new_invoice
def _get_or_create_walkin_customer(company_id: int) -> Customer:
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


def _is_walkin_customer(cust: Customer | None) -> bool:
    if not cust:
        return True
    return (cust.display_name or "").strip().lower() == "walk-in"


def _build_sale_line_description(sale: AquacultureFishSale) -> str:
    pond = (sale.pond.name or "").strip() if getattr(sale, "pond_id", None) else ""
    income_l = INCOME_TYPE_LABELS.get(sale.income_type, sale.income_type)
    species = fish_species_display_label(sale.fish_species, sale.fish_species_other)
    parts = ["Aquaculture pond sale", income_l]
    if pond:
        parts.append(pond)
    if species and sale.fish_species != "not_applicable":
        parts.append(species)
    buyer = (sale.buyer_name or "").strip()
    if buyer:
        parts.append(f"Buyer: {buyer}")
    s = " — ".join(parts)
    return s[:300]


def _refresh_invoice_totals(inv: Invoice) -> None:
    sub = inv.lines.aggregate(s=Sum("amount"))["s"] or Decimal("0")
    tax = inv.tax_total if inv.tax_total is not None else Decimal("0")
    inv.subtotal = sub.quantize(Decimal("0.01"))
    inv.total = (sub + tax).quantize(Decimal("0.01"))
    inv.save(update_fields=["subtotal", "total", "updated_at"])


def finalize_aquaculture_fish_sale_to_invoice(
    company_id: int,
    sale_id: int,
    body: dict[str, Any],
) -> tuple[AquacultureFishSale | None, dict | None, str | None]:
    """
    Returns (sale, invoice_json_dict, error_detail).
    On success error_detail is None; invoice_json_dict matches invoice list shape loosely.
    """
    record_as = (body.get("record_as") or "cash_paid").strip().lower()
    if record_as not in ("cash_paid", "on_account"):
        return None, None, "record_as must be cash_paid or on_account"

    with transaction.atomic():
        sale = (
            AquacultureFishSale.objects.select_for_update()
            .select_related("pond", "production_cycle")
            .filter(pk=sale_id, company_id=company_id)
            .first()
        )
        if not sale:
            return None, None, "Sale not found"
        if sale.invoice_id:
            inv = (
                Invoice.objects.select_related("customer")
                .filter(pk=sale.invoice_id, company_id=company_id)
                .first()
            )
            if inv:
                return sale, _invoice_min_json(inv, company_id), None
            return None, None, "Linked invoice record is missing; contact support to repair this sale."

        amt = (sale.total_amount or Decimal("0")).quantize(Decimal("0.01"))
        if amt <= 0:
            return None, None, "total_amount must be greater than zero to post"

        ensure_aquaculture_chart_accounts(company_id)
        rev_code = coa_account_code_for_aquaculture_income_type(sale.income_type)
        if not ChartOfAccount.objects.filter(
            company_id=company_id, account_code=rev_code, is_active=True
        ).exists():
            return (
                None,
                None,
                f"Missing chart account {rev_code} for this income type. Open Company settings and ensure "
                "aquaculture accounts are seeded, or add the account manually.",
            )

        cust_id_raw = body.get("customer_id")
        customer: Customer | None = None
        if cust_id_raw not in (None, ""):
            try:
                cid = int(cust_id_raw)
            except (TypeError, ValueError):
                return None, None, "customer_id must be an integer"
            customer = Customer.objects.filter(id=cid, company_id=company_id).first()
            if not customer:
                return None, None, "Customer not found"

        if record_as == "on_account":
            if customer is None and getattr(sale.pond, "pos_customer_id", None):
                customer = Customer.objects.filter(
                    id=sale.pond.pos_customer_id, company_id=company_id
                ).first()
            if customer is None:
                return None, None, "On-account sales require customer_id or a pond-linked POS customer."
            if _is_walkin_customer(customer):
                return None, None, "On-account sales cannot use the Walk-in customer; pick a credit customer or link the pond to a customer."
        else:
            if customer is None:
                customer = _get_or_create_walkin_customer(company_id)

        assert customer is not None
        station_raw = body.get("station_id", body.get("station"))
        station_id, s_err = resolve_station_id_for_new_invoice(
            company_id, station_raw, int(customer.id)
        )
        if s_err:
            return None, None, s_err
        assert station_id is not None

        inv_num = f"INV-AQ-{sale.id}"
        if Invoice.objects.filter(company_id=company_id, invoice_number=inv_num).exists():
            return None, None, "Invoice number collision; contact support (INV-AQ-*)"

        pm = (body.get("payment_method") or ("cash" if record_as == "cash_paid" else "")).strip()[:32]
        bank_account_id = body.get("bank_account_id")
        try:
            bank_account_id = int(bank_account_id) if bank_account_id not in (None, "", 0) else None
        except (TypeError, ValueError):
            bank_account_id = None

        if record_as == "cash_paid":
            status = "paid"
            due_date = None
        else:
            status = "sent"
            due_raw = body.get("due_date")
            if due_raw:
                try:
                    due_date = date.fromisoformat(str(due_raw).split("T")[0])
                except Exception:
                    due_date = sale.sale_date + timedelta(days=30)
            else:
                due_date = sale.sale_date + timedelta(days=30)

        inv = Invoice(
            company_id=company_id,
            customer_id=customer.id,
            shift_session=None,
            station_id=station_id,
            invoice_number=inv_num,
            invoice_date=sale.sale_date,
            due_date=due_date,
            status=status,
            subtotal=amt,
            tax_total=Decimal("0"),
            total=amt,
            payment_method=pm,
        )
        inv.save()

        desc = _build_sale_line_description(sale)
        InvoiceLine.objects.create(
            invoice=inv,
            item_id=None,
            description=desc,
            quantity=Decimal("1"),
            unit_price=amt,
            amount=amt,
        )
        _refresh_invoice_totals(inv)

        sale.invoice = inv
        sale.save(update_fields=["invoice", "updated_at"])

        inv.refresh_from_db()
        sync_invoice_gl(
            company_id,
            inv,
            payment_method=pm or "cash",
            bank_account_id=bank_account_id,
        )

        sale.refresh_from_db()
        return sale, _invoice_min_json(inv, company_id), None


def _invoice_min_json(inv: Invoice, company_id: int) -> dict:
    from api.utils.customer_display import customer_display_name

    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
        "status": inv.status,
        "total": str(inv.total),
        "customer_id": inv.customer_id,
        "customer_name": customer_display_name(getattr(inv, "customer", None)),
        "station_id": inv.station_id,
        "source": "aquaculture_pond_sale",
    }
