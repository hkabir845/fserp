"""
Find operational records that should have auto-posted journal entries but do not.

Used by audit_gl_posting_gaps and backfill_gl_posting_gaps management commands.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFishStockLedger,
    AquacultureLandlordLedgerEntry,
    BankDeposit,
    Bill,
    FundTransfer,
    Invoice,
    JournalEntry,
    Payment,
    PayrollRun,
)
from api.services.gl_posting import bill_eligible_for_posting


def invoice_eligible_for_gl_sale(inv: Invoice | None) -> bool:
    """Posted invoices (not draft/void) with positive total should have AUTO-INV-*-SALE."""
    if not inv:
        return False
    st = (inv.status or "").strip().lower()
    if st in ("draft", "void"):
        return False
    return (inv.total or Decimal("0")) > 0


def _je_exists(company_id: int, entry_number: str) -> bool:
    return JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists()


def _gap(
    *,
    gap_type: str,
    record_id: int,
    entry_number: str,
    label: str,
    amount: str | None = None,
    record_date: str | None = None,
    extra: dict | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "gap_type": gap_type,
        "record_id": record_id,
        "expected_entry_number": entry_number,
        "label": label,
    }
    if amount is not None:
        row["amount"] = amount
    if record_date is not None:
        row["record_date"] = record_date
    if extra:
        row.update(extra)
    return row


def find_vendor_payment_made_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = Payment.objects.filter(
        company_id=company_id, payment_type="made", amount__gt=0
    ).select_related("vendor", "bank_account").order_by("payment_date", "id")
    for p in qs:
        en = f"AUTO-PAY-{p.id}-MADE"
        if _je_exists(company_id, en):
            continue
        vendor_name = ""
        if p.vendor_id:
            v = p.vendor
            vendor_name = (v.display_name or v.company_name or "").strip() if v else ""
        bank_name = (p.bank_account.account_name if p.bank_account_id and p.bank_account else "") or ""
        gaps.append(
            _gap(
                gap_type="vendor_payment_made",
                record_id=p.id,
                entry_number=en,
                label=f"Payment PAY-{p.id} → {vendor_name or 'vendor'}",
                amount=str(p.amount),
                record_date=p.payment_date.isoformat() if p.payment_date else None,
                extra={
                    "vendor_id": p.vendor_id,
                    "bank_account_id": p.bank_account_id,
                    "bank_account_name": bank_name,
                    "payment_method": p.payment_method or "",
                    "vendor_ap_decremented": bool(p.vendor_ap_decremented),
                },
            )
        )
    return gaps


def find_customer_payment_received_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = Payment.objects.filter(
        company_id=company_id, payment_type="received", amount__gt=0
    ).select_related("customer").order_by("payment_date", "id")
    for p in qs:
        en = f"AUTO-PAY-{p.id}-RCV"
        if _je_exists(company_id, en):
            continue
        cust_name = (p.customer.display_name if p.customer_id and p.customer else "") or ""
        gaps.append(
            _gap(
                gap_type="customer_payment_received",
                record_id=p.id,
                entry_number=en,
                label=f"Receipt PAY-{p.id} ← {cust_name or 'customer'}",
                amount=str(p.amount),
                record_date=p.payment_date.isoformat() if p.payment_date else None,
            )
        )
    return gaps


def find_vendor_bill_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = Bill.objects.filter(company_id=company_id).select_related("vendor").order_by(
        "bill_date", "id"
    )
    for b in qs:
        if not bill_eligible_for_posting(b):
            continue
        en = f"AUTO-BILL-{b.id}"
        if _je_exists(company_id, en):
            continue
        vendor_name = ""
        if b.vendor_id and b.vendor:
            vendor_name = (b.vendor.display_name or b.vendor.company_name or "").strip()
        gaps.append(
            _gap(
                gap_type="vendor_bill",
                record_id=b.id,
                entry_number=en,
                label=f"Bill {b.bill_number or b.id} — {vendor_name or 'vendor'}",
                amount=str(b.total or Decimal("0")),
                record_date=b.bill_date.isoformat() if b.bill_date else None,
                extra={
                    "status": b.status,
                    "vendor_ap_incremented": bool(b.vendor_ap_incremented),
                },
            )
        )
    return gaps


def find_invoice_sale_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = Invoice.objects.filter(company_id=company_id).order_by("invoice_date", "id")
    for inv in qs:
        if not invoice_eligible_for_gl_sale(inv):
            continue
        en = f"AUTO-INV-{inv.id}-SALE"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="invoice_sale",
                record_id=inv.id,
                entry_number=en,
                label=f"Invoice {inv.invoice_number or inv.id}",
                amount=str(inv.total or Decimal("0")),
                record_date=inv.invoice_date.isoformat() if inv.invoice_date else None,
                extra={
                    "status": inv.status,
                    "station_id": inv.station_id,
                },
            )
        )
    return gaps


def find_aquaculture_landlord_payment_gaps(company_id: int) -> list[dict]:
    """Cash/bank lease payments: AUTO-LL-PAY-{ledger_row_id}."""
    gaps: list[dict] = []
    qs = (
        AquacultureLandlordLedgerEntry.objects.filter(
            landlord__company_id=company_id,
            kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
            bank_account_id__isnull=False,
            pond_id__isnull=False,
        )
        .select_related("landlord", "pond", "bank_account")
        .order_by("entry_date", "id")
    )
    for ent in qs:
        mag = abs(ent.amount_signed or Decimal("0"))
        if mag <= 0:
            continue
        en = f"AUTO-LL-PAY-{ent.id}"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="aquaculture_landlord_payment",
                record_id=ent.id,
                entry_number=en,
                label=f"Landlord lease payment #{ent.id} — pond {getattr(ent.pond, 'pond_name', ent.pond_id)}",
                amount=str(mag),
                record_date=ent.entry_date.isoformat() if ent.entry_date else None,
                extra={"landlord_id": ent.landlord_id, "pond_id": ent.pond_id},
            )
        )
    return gaps


def find_aquaculture_shop_issue_gaps(company_id: int) -> list[dict]:
    """Premium Agro / shop stock issue to pond: AUTO-AQ-SHOP-{expense_id}-COGS."""
    gaps: list[dict] = []
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        source_station_id__isnull=False,
        amount__gt=0,
    ).select_related("source_station", "pond").order_by("expense_date", "id")
    for exp in qs:
        en = f"AUTO-AQ-SHOP-{exp.id}-COGS"
        if _je_exists(company_id, en):
            continue
        station_name = (
            exp.source_station.station_name if exp.source_station_id and exp.source_station else ""
        )
        gaps.append(
            _gap(
                gap_type="aquaculture_shop_issue",
                record_id=exp.id,
                entry_number=en,
                label=f"Shop issue → pond ({station_name or 'shop'}) expense #{exp.id}",
                amount=str(exp.amount),
                record_date=exp.expense_date.isoformat() if exp.expense_date else None,
                extra={
                    "source_station_id": exp.source_station_id,
                    "pond_id": exp.pond_id,
                    "expense_category": exp.expense_category,
                },
            )
        )
    return gaps


def find_aquaculture_pond_consumption_gaps(company_id: int) -> list[dict]:
    """Pond warehouse feed/medicine consume: AUTO-AQ-POND-{expense_id}-COGS."""
    gaps: list[dict] = []
    inv_exp_ids = set(
        AquacultureExpenseInventoryLine.objects.filter(
            expense__company_id=company_id
        ).values_list("expense_id", flat=True)
    )
    qs = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            id__in=inv_exp_ids,
            source_station_id__isnull=True,
            amount__gt=0,
        )
        .select_related("pond")
        .order_by("expense_date", "id")
    )
    for exp in qs:
        en = f"AUTO-AQ-POND-{exp.id}-COGS"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="aquaculture_pond_consumption",
                record_id=exp.id,
                entry_number=en,
                label=f"Pond inventory consumption #{exp.id} ({exp.expense_category})",
                amount=str(exp.amount),
                record_date=exp.expense_date.isoformat() if exp.expense_date else None,
                extra={"pond_id": exp.pond_id},
            )
        )
    return gaps


def find_aquaculture_manual_expense_gaps(company_id: int) -> list[dict]:
    """Direct cash/bank pond expense (not bill, not inventory): AUTO-AQ-EXP-{expense_id}."""
    gaps: list[dict] = []
    inv_exp_ids = set(
        AquacultureExpenseInventoryLine.objects.filter(
            expense__company_id=company_id
        ).values_list("expense_id", flat=True)
    )
    qs = (
        AquacultureExpense.objects.filter(company_id=company_id, amount__gt=0)
        .exclude(id__in=inv_exp_ids)
        .filter(source_station_id__isnull=True)
        .exclude(funding_account_code="")
        .select_related("pond")
        .order_by("expense_date", "id")
    )
    for exp in qs:
        if not (exp.funding_account_code or "").strip():
            continue
        if exp.pond_id is None:
            continue
        en = f"AUTO-AQ-EXP-{exp.id}"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="aquaculture_manual_expense",
                record_id=exp.id,
                entry_number=en,
                label=f"Pond cash expense #{exp.id} ({exp.expense_category})",
                amount=str(exp.amount),
                record_date=exp.expense_date.isoformat() if exp.expense_date else None,
                extra={
                    "pond_id": exp.pond_id,
                    "funding_account_code": exp.funding_account_code,
                },
            )
        )
    return gaps


def find_aquaculture_fish_stock_ledger_gaps(company_id: int) -> list[dict]:
    """Biological asset write-down/adjustment when post_to_books: AUTO-AQ-BIOSTK-{ledger_id}."""
    gaps: list[dict] = []
    qs = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        post_to_books=True,
        book_value__gt=0,
    ).select_related("pond").order_by("entry_date", "id")
    for row in qs:
        en = f"AUTO-AQ-BIOSTK-{row.id}"
        if row.journal_entry_id or _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="aquaculture_fish_stock_ledger",
                record_id=row.id,
                entry_number=en,
                label=f"Fish stock ledger #{row.id} ({row.entry_kind})",
                amount=str(row.book_value),
                record_date=row.entry_date.isoformat() if row.entry_date else None,
                extra={"pond_id": row.pond_id},
            )
        )
    return gaps


def find_fund_transfer_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = FundTransfer.objects.filter(
        company_id=company_id, is_posted=True, amount__gt=0
    ).select_related("from_bank", "to_bank").order_by("transfer_date", "id")
    for ft in qs:
        en = f"AUTO-FT-{ft.id}"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="fund_transfer",
                record_id=ft.id,
                entry_number=en,
                label=(
                    f"Fund transfer #{ft.id} "
                    f"{getattr(ft.from_bank, 'account_name', '')} → {getattr(ft.to_bank, 'account_name', '')}"
                ),
                amount=str(ft.amount),
                record_date=ft.transfer_date.isoformat() if ft.transfer_date else None,
            )
        )
    return gaps


def find_bank_deposit_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = BankDeposit.objects.filter(company_id=company_id, total_amount__gt=0).order_by(
        "deposit_date", "id"
    )
    for dep in qs:
        en = f"AUTO-DEP-{dep.id}"
        if _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="bank_deposit",
                record_id=dep.id,
                entry_number=en,
                label=f"Bank deposit {dep.deposit_number or dep.id}",
                amount=str(dep.total_amount),
                record_date=dep.deposit_date.isoformat() if dep.deposit_date else None,
            )
        )
    return gaps


def find_payroll_gaps(company_id: int) -> list[dict]:
    gaps: list[dict] = []
    qs = PayrollRun.objects.filter(company_id=company_id, status="posted").order_by(
        "payment_date", "id"
    )
    for pr in qs:
        en = f"AUTO-PAYROLL-{pr.id}"
        if pr.salary_journal_id or _je_exists(company_id, en):
            continue
        gaps.append(
            _gap(
                gap_type="payroll_posted",
                record_id=pr.id,
                entry_number=en,
                label=f"Payroll {pr.payroll_number or pr.id}",
                amount=str(pr.total_net or Decimal("0")),
                record_date=pr.payment_date.isoformat() if pr.payment_date else None,
            )
        )
    return gaps


GAP_FINDERS = {
    "vendor_payment_made": find_vendor_payment_made_gaps,
    "customer_payment_received": find_customer_payment_received_gaps,
    "vendor_bill": find_vendor_bill_gaps,
    "invoice_sale": find_invoice_sale_gaps,
    "aquaculture_landlord_payment": find_aquaculture_landlord_payment_gaps,
    "aquaculture_shop_issue": find_aquaculture_shop_issue_gaps,
    "aquaculture_pond_consumption": find_aquaculture_pond_consumption_gaps,
    "aquaculture_manual_expense": find_aquaculture_manual_expense_gaps,
    "aquaculture_fish_stock_ledger": find_aquaculture_fish_stock_ledger_gaps,
    "fund_transfer": find_fund_transfer_gaps,
    "bank_deposit": find_bank_deposit_gaps,
    "payroll_posted": find_payroll_gaps,
}


def audit_company_gl_gaps(
    company_id: int,
    *,
    gap_types: list[str] | None = None,
) -> dict[str, Any]:
    """Return all missing auto-journal gaps for one company."""
    types = gap_types or list(GAP_FINDERS.keys())
    gaps_by_type: dict[str, list[dict]] = {}
    total = 0
    for gt in types:
        finder = GAP_FINDERS.get(gt)
        if not finder:
            continue
        rows = finder(company_id)
        if rows:
            gaps_by_type[gt] = rows
            total += len(rows)
    return {
        "company_id": company_id,
        "gaps_by_type": gaps_by_type,
        "total_gaps": total,
    }
