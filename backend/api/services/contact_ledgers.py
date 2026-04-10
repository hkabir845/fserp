"""Subledger-style activity for customers (AR) and vendors (AP) from invoices/bills and payments."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Prefetch

from api.models import (
    Bill,
    Customer,
    Employee,
    EmployeeLedgerEntry,
    Invoice,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    Vendor,
)
from api.services.gl_posting import _is_walkin_customer


def _d(val) -> Decimal:
    if val is None:
        return Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def _parse_date_param(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s).split("T")[0])
    except Exception:
        return None


@dataclass
class _Row:
    sort_date: date
    seq: int  # 0=opening, 1=invoice/bill, 2=payment
    sort_id: int
    kind: str
    reference: str
    description: str
    debit: Decimal
    credit: Decimal
    related_id: Optional[int] = None
    allocations: Optional[list[dict[str, Any]]] = None


def _apply_period(
    rows: list[_Row],
    start: Optional[date],
    end: Optional[date],
) -> tuple[list[_Row], Decimal, Decimal, Decimal]:
    """Return (visible rows, balance_before_period, closing_balance_all_time, closing_visible)."""
    rows_sorted = sorted(rows, key=lambda r: (r.sort_date, r.seq, r.sort_id))
    running = Decimal("0")
    balance_before = Decimal("0")
    closing_all = Decimal("0")
    for r in rows_sorted:
        running += r.debit - r.credit
        if start and r.sort_date < start:
            balance_before = running
        closing_all = running

    visible: list[_Row] = []
    run2 = balance_before
    closing_vis = balance_before
    for r in rows_sorted:
        if start and r.sort_date < start:
            continue
        if end and r.sort_date > end:
            continue
        run2 += r.debit - r.credit
        closing_vis = run2
        visible.append(r)
    return visible, balance_before, closing_all, closing_vis


def build_customer_ledger(
    company_id: int,
    customer_id: int,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> dict[str, Any]:
    customer = Customer.objects.filter(pk=customer_id, company_id=company_id).first()
    if not customer:
        return {"detail": "Customer not found"}

    if _is_walkin_customer(customer):
        return {
            "entity": "customer",
            "entity_id": customer.id,
            "display_name": customer.display_name or customer.company_name or "",
            "note": "Walk-in customers do not use an accounts receivable subledger.",
            "opening_balance": str(_d(customer.opening_balance)),
            "opening_balance_date": customer.opening_balance_date.isoformat()
            if customer.opening_balance_date
            else None,
            "period_start_balance": "0",
            "closing_balance": "0",
            "stored_current_balance": str(_d(customer.current_balance)),
            "transactions": [],
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        }

    rows: list[_Row] = []
    ob = _d(customer.opening_balance)
    obd = customer.opening_balance_date
    if ob != 0:
        rows.append(
            _Row(
                sort_date=obd or date(1970, 1, 1),
                seq=0,
                sort_id=0,
                kind="opening",
                reference="Opening",
                description="Opening balance",
                debit=ob if ob > 0 else Decimal("0"),
                credit=-ob if ob < 0 else Decimal("0"),
                related_id=None,
            )
        )

    for inv in (
        Invoice.objects.filter(company_id=company_id, customer_id=customer_id)
        .exclude(status="draft")
        .order_by("invoice_date", "id")
    ):
        t = _d(inv.total)
        if t <= 0:
            continue
        rows.append(
            _Row(
                sort_date=inv.invoice_date,
                seq=1,
                sort_id=inv.id,
                kind="invoice",
                reference=inv.invoice_number or f"INV-{inv.id}",
                description=f"Invoice {inv.invoice_number or inv.id} ({inv.status})",
                debit=t,
                credit=Decimal("0"),
                related_id=inv.id,
            )
        )

    pay_qs = (
        Payment.objects.filter(
            company_id=company_id, customer_id=customer_id, payment_type="received"
        )
        .prefetch_related(
            Prefetch(
                "invoice_allocations",
                queryset=PaymentInvoiceAllocation.objects.select_related("invoice"),
            )
        )
        .order_by("payment_date", "id")
    )
    for pay in pay_qs:
        amt = _d(pay.amount)
        if amt <= 0:
            continue
        allocs: list[dict[str, Any]] = []
        for a in pay.invoice_allocations.all():
            inv = a.invoice
            allocs.append(
                {
                    "invoice_id": a.invoice_id,
                    "invoice_number": inv.invoice_number if inv else str(a.invoice_id),
                    "amount": str(_d(a.amount)),
                }
            )
        memo = (pay.memo or pay.reference or "").strip()
        rows.append(
            _Row(
                sort_date=pay.payment_date,
                seq=2,
                sort_id=pay.id,
                kind="payment",
                reference=pay.reference or f"PAY-{pay.id}",
                description=f"Payment received{f' — {memo}' if memo else ''}",
                debit=Decimal("0"),
                credit=amt,
                related_id=pay.id,
                allocations=allocs or None,
            )
        )

    visible, period_start, closing_all, closing_vis = _apply_period(rows, start_date, end_date)

    def row_to_json(r: _Row, bal: Decimal) -> dict[str, Any]:
        out: dict[str, Any] = {
            "date": r.sort_date.isoformat(),
            "type": r.kind,
            "reference": r.reference,
            "description": r.description,
            "debit": str(r.debit),
            "credit": str(r.credit),
            "balance": str(bal),
            "related_id": r.related_id,
        }
        if r.allocations:
            out["allocations"] = r.allocations
        return out

    running = period_start
    tx_json: list[dict[str, Any]] = []
    for r in sorted(visible, key=lambda x: (x.sort_date, x.seq, x.sort_id)):
        running += r.debit - r.credit
        tx_json.append(row_to_json(r, running))

    return {
        "entity": "customer",
        "entity_id": customer.id,
        "display_name": customer.display_name or customer.company_name or "",
        "balance_note": "Running balance: amount the customer owes you (accounts receivable).",
        "opening_balance": str(ob),
        "opening_balance_date": obd.isoformat() if obd else None,
        "period_start_balance": str(period_start),
        "closing_balance": str(closing_vis),
        "closing_balance_all_time": str(closing_all),
        "stored_current_balance": str(_d(customer.current_balance)),
        "transactions": tx_json,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
    }


def build_vendor_ledger(
    company_id: int,
    vendor_id: int,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> dict[str, Any]:
    vendor = Vendor.objects.filter(pk=vendor_id, company_id=company_id).first()
    if not vendor:
        return {"detail": "Vendor not found"}

    rows: list[_Row] = []
    ob = _d(vendor.opening_balance)
    obd = vendor.opening_balance_date
    if ob != 0:
        rows.append(
            _Row(
                sort_date=obd or date(1970, 1, 1),
                seq=0,
                sort_id=0,
                kind="opening",
                reference="Opening",
                description="Opening balance (amount you owe vendor)",
                debit=ob if ob > 0 else Decimal("0"),
                credit=-ob if ob < 0 else Decimal("0"),
                related_id=None,
            )
        )

    for bill in (
        Bill.objects.filter(company_id=company_id, vendor_id=vendor_id)
        .exclude(status="draft")
        .order_by("bill_date", "id")
    ):
        t = _d(bill.total)
        if t <= 0:
            continue
        memo = (bill.memo or "").strip()[:200]
        rows.append(
            _Row(
                sort_date=bill.bill_date,
                seq=1,
                sort_id=bill.id,
                kind="bill",
                reference=bill.bill_number or f"BILL-{bill.id}",
                description=f"Bill {bill.bill_number or bill.id} ({bill.status}){f' — {memo}' if memo else ''}",
                debit=t,
                credit=Decimal("0"),
                related_id=bill.id,
            )
        )

    pay_qs = (
        Payment.objects.filter(company_id=company_id, vendor_id=vendor_id, payment_type="made")
        .prefetch_related(
            Prefetch(
                "bill_allocations",
                queryset=PaymentBillAllocation.objects.select_related("bill"),
            )
        )
        .order_by("payment_date", "id")
    )
    for pay in pay_qs:
        amt = _d(pay.amount)
        if amt <= 0:
            continue
        allocs: list[dict[str, Any]] = []
        for a in pay.bill_allocations.all():
            b = a.bill
            allocs.append(
                {
                    "bill_id": a.bill_id,
                    "bill_number": b.bill_number if b else str(a.bill_id),
                    "amount": str(_d(a.amount)),
                }
            )
        memo = (pay.memo or pay.reference or "").strip()
        rows.append(
            _Row(
                sort_date=pay.payment_date,
                seq=2,
                sort_id=pay.id,
                kind="payment_made",
                reference=pay.reference or f"PAY-{pay.id}",
                description=f"Payment made{f' — {memo}' if memo else ''}",
                debit=Decimal("0"),
                credit=amt,
                related_id=pay.id,
                allocations=allocs or None,
            )
        )

    visible, period_start, closing_all, closing_vis = _apply_period(rows, start_date, end_date)

    def row_to_json(r: _Row, bal: Decimal) -> dict[str, Any]:
        out: dict[str, Any] = {
            "date": r.sort_date.isoformat(),
            "type": r.kind,
            "reference": r.reference,
            "description": r.description,
            "debit": str(r.debit),
            "credit": str(r.credit),
            "balance": str(bal),
            "related_id": r.related_id,
        }
        if r.allocations:
            out["allocations"] = r.allocations
        return out

    running = period_start
    tx_json: list[dict[str, Any]] = []
    for r in sorted(visible, key=lambda x: (x.sort_date, x.seq, x.sort_id)):
        running += r.debit - r.credit
        tx_json.append(row_to_json(r, running))

    return {
        "entity": "vendor",
        "entity_id": vendor.id,
        "display_name": vendor.display_name or vendor.company_name or "",
        "balance_note": "Running balance: amount you owe this vendor (accounts payable).",
        "opening_balance": str(ob),
        "opening_balance_date": obd.isoformat() if obd else None,
        "period_start_balance": str(period_start),
        "closing_balance": str(closing_vis),
        "closing_balance_all_time": str(closing_all),
        "stored_current_balance": str(_d(vendor.current_balance)),
        "transactions": tx_json,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
    }


def ledger_query_dates(request) -> tuple[Optional[date], Optional[date]]:
    return _parse_date_param(request.GET.get("start_date")), _parse_date_param(
        request.GET.get("end_date")
    )


def build_employee_ledger(
    company_id: int,
    employee_id: int,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> dict[str, Any]:
    emp = Employee.objects.filter(pk=employee_id, company_id=company_id).first()
    if not emp:
        return {"detail": "Employee not found"}

    rows: list[_Row] = []
    ob = _d(emp.opening_balance)
    obd = emp.opening_balance_date
    if ob != 0:
        rows.append(
            _Row(
                sort_date=obd or date(1970, 1, 1),
                seq=0,
                sort_id=0,
                kind="opening",
                reference="Opening",
                description="Opening balance (net payable to employee)",
                debit=ob if ob > 0 else Decimal("0"),
                credit=-ob if ob < 0 else Decimal("0"),
                related_id=None,
            )
        )

    for entry in EmployeeLedgerEntry.objects.filter(employee_id=employee_id).order_by(
        "entry_date", "id"
    ):
        rows.append(
            _Row(
                sort_date=entry.entry_date,
                seq=1,
                sort_id=entry.id,
                kind=entry.entry_type or "entry",
                reference=entry.reference or f"HR-{entry.id}",
                description=(entry.memo or entry.entry_type or "Entry").strip()[:500],
                debit=_d(entry.debit),
                credit=_d(entry.credit),
                related_id=entry.id,
            )
        )

    visible, period_start, closing_all, closing_vis = _apply_period(rows, start_date, end_date)

    def row_to_json(r: _Row, bal: Decimal) -> dict[str, Any]:
        return {
            "date": r.sort_date.isoformat(),
            "type": r.kind,
            "reference": r.reference,
            "description": r.description,
            "debit": str(r.debit),
            "credit": str(r.credit),
            "balance": str(bal),
            "related_id": r.related_id,
        }

    running = period_start
    tx_json: list[dict[str, Any]] = []
    for r in sorted(visible, key=lambda x: (x.sort_date, x.seq, x.sort_id)):
        running += r.debit - r.credit
        tx_json.append(row_to_json(r, running))

    return {
        "entity": "employee",
        "entity_id": emp.id,
        "display_name": f"{emp.first_name} {emp.last_name}".strip(),
        "balance_note": "Running balance: net amount the company owes the employee (positive) or employee owes the company (negative).",
        "opening_balance": str(ob),
        "opening_balance_date": obd.isoformat() if obd else None,
        "period_start_balance": str(period_start),
        "closing_balance": str(closing_vis),
        "closing_balance_all_time": str(closing_all),
        "stored_current_balance": str(_d(emp.current_balance)),
        "transactions": tx_json,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
    }
