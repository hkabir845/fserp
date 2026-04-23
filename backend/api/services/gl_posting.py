"""
Automatic GL posting for invoices, POS sales, payments, bills, and fund transfers.

Uses fuel-station template account codes when present; skips posting if required
accounts are missing (operations still succeed).
"""
from __future__ import annotations

import logging
import uuid
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from api.models import (
    BankAccount,
    Bill,
    BillLine,
    ChartOfAccount,
    Customer,
    FundTransfer,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    Payment,
    PayrollRun,
    Tank,
    TankDip,
    Vendor,
)
from api.exceptions import StockBusinessError
from api.services.item_catalog import item_tracks_physical_stock
from api.utils.customer_display import customer_display_name
from api.services.coa_constants import normalize_chart_account_type

logger = logging.getLogger(__name__)


def _gl_invoice_customer_label(inv: Invoice) -> str:
    return customer_display_name(getattr(inv, "customer", None))


def _gl_invoice_line_memo(inv: Invoice, prefix: str = "") -> str:
    """Line memo on auto-posted invoice journals (max 300 chars)."""
    inv_ref = (inv.invoice_number or f"INV-{inv.id}").strip()
    cust = _gl_invoice_customer_label(inv)
    core = f"{inv_ref} — {cust}" if cust else inv_ref
    s = f"{prefix.strip()} {core}".strip() if prefix else core
    return s[:300]


def _gl_invoice_journal_description(inv: Invoice, title: str) -> str:
    """JournalEntry.description for invoice-related auto entries (max 500)."""
    inv_ref = inv.invoice_number or f"INV-{inv.id}"
    cust = _gl_invoice_customer_label(inv)
    if cust:
        return f"{title} {inv_ref} — {cust}"[:500]
    return f"{title} {inv_ref}"[:500]

# Default codes aligned with api.chart_templates.fuel_station
CODE_CASH = "1010"
CODE_UNDEPOSITED = "1020"
CODE_BANK_OP = "1030"
CODE_AR = "1100"
CODE_CARD_CLEARING = "1120"
CODE_AP = "2000"
CODE_VAT = "2100"
CODE_FUEL_REV = "4100"
CODE_SHOP_REV = "4200"
CODE_OTHER_REV = "4230"
CODE_OFFICE_EXP = "6900"
CODE_DONATION_SOCIAL = "6910"
CODE_COGS_FUEL = "5100"
CODE_COGS_SHOP = "5120"
CODE_SHRINK_FUEL = "5200"
CODE_INV_FUEL = "1200"
CODE_INV_SHOP = "1220"
# Payroll (fuel_station template; optional — posting skips if 6400 missing)
CODE_SALARY_EXP = "6400"
CODE_SALARY_PAYABLE = "2200"
CODE_STAT_DED = "2210"


def _coa(company_id: int, code: str) -> Optional[ChartOfAccount]:
    return (
        ChartOfAccount.objects.filter(
            company_id=company_id, account_code=code, is_active=True
        )
        .first()
    )


def _is_walkin_customer(customer: Optional[Customer]) -> bool:
    if not customer:
        return True
    name = (customer.display_name or "").strip().lower()
    return name == "walk-in"


def _debit_account_for_paid_sale(
    company_id: int, payment_method: str, bank_account_id: Optional[int]
) -> Optional[ChartOfAccount]:
    pm = (payment_method or "cash").strip().lower()
    if pm in ("card", "credit_card", "debit_card"):
        a = _coa(company_id, CODE_CARD_CLEARING)
        if a:
            return a
    if bank_account_id:
        bank = (
            BankAccount.objects.filter(id=bank_account_id, company_id=company_id)
            .select_related("chart_account")
            .first()
        )
        if bank and bank.chart_account_id:
            return bank.chart_account
    if pm in ("bank", "transfer", "wire"):
        a = _coa(company_id, CODE_BANK_OP)
        if a:
            return a
    return _coa(company_id, CODE_CASH) or _coa(company_id, CODE_UNDEPOSITED)


def post_pos_cash_donation_journal(
    company_id: int,
    *,
    amount: Decimal,
    entry_date,
    memo: str,
    bank_account_id: Optional[int],
) -> tuple[Optional[JournalEntry], str]:
    """
    Record cash (or register-linked) payout for donation / social support from POS.
    Dr Donation & Social Support (6910), Cr same cash/clearing GL as POS uses for cash (1010 by default).
    """
    if amount is None or amount <= 0:
        return None, "Amount must be positive"
    exp = _coa(company_id, CODE_DONATION_SOCIAL)
    if not exp:
        return None, "Chart account 6910 Donation & Social Support is missing. Sync the chart of accounts or run master push for COA defaults."
    cash = _debit_account_for_paid_sale(company_id, "cash", bank_account_id)
    if not cash:
        return None, "No cash-on-hand (1010) or register-linked GL. Add account 1010 or link a register to a chart line."
    line_memo = (memo or "POS — donation & social support")[:300]
    entry_num = f"AUTO-POS-DON-{uuid.uuid4().hex[:12].upper()}"
    desc = f"Donation & social support — {line_memo}"[:500]
    lines = [
        (exp, amount, Decimal("0"), line_memo),
        (cash, Decimal("0"), amount, line_memo),
    ]
    je = _create_posted_entry(company_id, entry_date, entry_num, desc, lines)
    if not je:
        return None, "Could not post journal. Please try again."
    return je, ""


def _is_fuel_item(item) -> bool:
    if not item:
        return False
    unit = (item.unit or "").lower()
    pos_cat = (item.pos_category or "").lower()
    cat = (item.category or "").lower()
    name = (getattr(item, "name", None) or "").lower()
    if unit in ("l", "liter", "litre", "gal", "gallon") or "fuel" in pos_cat or "fuel" in cat:
        return True
    # Items often default to unit "piece" / category empty — treat common wet-stock names as fuel
    fuel_name_tokens = (
        "diesel",
        "petrol",
        "gasoline",
        "gasohol",
        "octane",
        "premium",
        "mogas",
        "kerosene",
        "e85",
        "biodiesel",
        "lpg",
        "cng",
    )
    return any(tok in name for tok in fuel_name_tokens)


def _inventory_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    if _is_fuel_item(item):
        return _coa(company_id, CODE_INV_FUEL)
    return _coa(company_id, CODE_INV_SHOP) or _coa(company_id, CODE_INV_FUEL)


def _cogs_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    if _is_fuel_item(item):
        return _coa(company_id, CODE_COGS_FUEL)
    return _coa(company_id, CODE_COGS_SHOP) or _coa(company_id, CODE_COGS_FUEL)


def item_inventory_unit_cost(item: Optional[Item]) -> Decimal:
    """
    Per-unit cost for inventory / wet-stock GL (liters, pieces, etc.).
    Prefer Item.cost; if unset, fall back to unit_price so reports and dip GL are not all zero.
    """
    if not item:
        return Decimal("0")
    c = item.cost or Decimal("0")
    if c > 0:
        return c
    return item.unit_price or Decimal("0")


def delete_tank_dip_variance_journal(company_id: int, dip_id: int) -> int:
    """Remove AUTO-TANKDIP-{id}-VAR if present (e.g. before delete or re-post)."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-TANKDIP-{dip_id}-VAR",
    ).delete()
    return deleted


def _wet_stock_variance_accounts(
    company_id: int,
) -> tuple[Optional[ChartOfAccount], Optional[ChartOfAccount], Optional[ChartOfAccount]]:
    """
    GL buckets for underground / tank wet stock (all tank dips use these).

    Fuel in tanks is inventory (asset 1200) at cost whether or not the Item row
    is tagged as "fuel" in POS metadata (diesel/petrol SKUs often stay unit=piece).
    """
    inv_acc = _coa(company_id, CODE_INV_FUEL)
    cogs_acc = _coa(company_id, CODE_COGS_FUEL)
    shrink_acc = _coa(company_id, CODE_SHRINK_FUEL) or cogs_acc
    return inv_acc, cogs_acc, shrink_acc


def _tank_dip_variance_journal_skip_reason(company_id: int, dip: TankDip) -> Optional[str]:
    """Why variance GL would not be created (no writes). None = would post."""
    if dip.book_stock_before is None:
        return "no_book_snapshot"
    book = dip.book_stock_before or Decimal("0")
    measured = dip.volume or Decimal("0")
    var_liters = measured - book
    if var_liters == 0:
        return "no_variance"
    prod = dip.tank.product if dip.tank_id else None
    rate = item_inventory_unit_cost(prod)
    if rate <= 0:
        return "item_cost_and_price_zero"
    amount = (abs(var_liters) * rate).quantize(Decimal("0.01"))
    if amount <= 0:
        return "rounded_zero"
    inv_acc, cogs_acc, _ = _wet_stock_variance_accounts(company_id)
    if not inv_acc or not cogs_acc:
        return "missing_inventory_or_cogs_account"
    return None


def tank_dip_variance_gl_status(company_id: int, dip: TankDip) -> dict:
    """For API: posted journal vs skip reason (read-only)."""
    en = f"AUTO-TANKDIP-{dip.id}-VAR"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        return {"posted": True, "entry_number": en, "skip_reason": None}
    return {
        "posted": False,
        "entry_number": None,
        "skip_reason": _tank_dip_variance_journal_skip_reason(company_id, dip),
    }


def sync_tank_dip_variance_journal(company_id: int, dip_id: int) -> dict:
    """
    Align GL inventory $ with physical dip vs book-at-dip, at inventory unit cost.

    - Gain (stick > book): Dr Fuel inventory, Cr COGS — reduces COGS expense (pick-up / count gain).
    - Loss (stick < book): Dr Shrinkage (5200) or COGS, Cr Fuel inventory — wet loss expense.

    Always uses wet-stock fuel accounts (1200 / 5100 / 5200) so diesel, petrol, octane, etc.
    post consistently regardless of Item.unit / pos_category.

    Idempotent per dip: replaces AUTO-TANKDIP-{id}-VAR. Skips if book snapshot missing, zero variance,
    zero cost rate, or required COA missing.
    """
    dip = (
        TankDip.objects.filter(id=dip_id, company_id=company_id)
        .select_related("tank", "tank__product")
        .first()
    )
    if not dip:
        return {"status": "skipped", "reason": "dip_not_found"}
    delete_tank_dip_variance_journal(company_id, dip_id)

    skip = _tank_dip_variance_journal_skip_reason(company_id, dip)
    if skip:
        return {"status": "skipped", "reason": skip}

    book = dip.book_stock_before or Decimal("0")
    measured = dip.volume or Decimal("0")
    var_liters = measured - book
    prod = dip.tank.product if dip.tank_id else None
    rate = item_inventory_unit_cost(prod)
    amount = (abs(var_liters) * rate).quantize(Decimal("0.01"))

    inv_acc, cogs_acc, shrink_acc = _wet_stock_variance_accounts(company_id)
    if not inv_acc or not cogs_acc:
        return {"status": "skipped", "reason": "missing_inventory_or_cogs_account"}

    tank_name = (dip.tank.tank_name or f"Tank {dip.tank_id}")[:80]
    memo_base = f"Dip #{dip.id} {tank_name} — physical vs book ({format(var_liters, 'f')} L @ cost)"
    desc = f"Tank dip variance {tank_name} ({dip.dip_date})"[:500]
    entry_number = f"AUTO-TANKDIP-{dip_id}-VAR"

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    if var_liters > 0:
        # Count gain: increase inventory asset, credit COGS (lowers expense vs sales)
        lines.append((inv_acc, amount, Decimal("0"), memo_base[:300]))
        lines.append((cogs_acc, Decimal("0"), amount, memo_base[:300]))
    else:
        # Loss: shrinkage expense, reduce inventory
        loss_acc = shrink_acc or cogs_acc
        lines.append((loss_acc, amount, Decimal("0"), memo_base[:300]))
        lines.append((inv_acc, Decimal("0"), amount, memo_base[:300]))

    je = _create_posted_entry(
        company_id,
        dip.dip_date,
        entry_number,
        desc,
        lines,
    )
    if je:
        return {"status": "posted", "entry_number": entry_number, "amount": float(amount)}
    return {"status": "skipped", "reason": "journal_create_failed"}


def bulk_sync_tank_dip_variance_journals(company_id: int) -> dict[str, Any]:
    """
    Re-run ``sync_tank_dip_variance_journal`` for every dip in the company (by dip_date, id).

    Use after changing Item unit, **cost**, or **unit_price** so ``AUTO-TANKDIP-{id}-VAR`` amounts
    match current valuation. Fuel inventory (1200) is moved by these entries (gain/loss vs COGS
    or shrinkage); skipped dips keep their prior state (e.g. no variance, no cost).
    """
    reason_counts: Counter[str] = Counter()
    posted = 0
    dip_ids = list(
        TankDip.objects.filter(company_id=company_id)
        .order_by("dip_date", "id")
        .values_list("id", flat=True)
    )
    for did in dip_ids:
        r = sync_tank_dip_variance_journal(company_id, did)
        if r.get("status") == "posted":
            posted += 1
        else:
            reason_counts[str(r.get("reason", "unknown"))] += 1
    return {
        "company_id": company_id,
        "dips_processed": len(dip_ids),
        "posted": posted,
        "skipped": len(dip_ids) - posted,
        "skipped_by_reason": dict(reason_counts),
    }


def _revenue_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    if item:
        unit = (item.unit or "").lower()
        pos_cat = (item.pos_category or "").lower()
        cat = (item.category or "").lower()
        if _is_fuel_item(item):
            return _coa(company_id, CODE_FUEL_REV) or _coa(company_id, CODE_OTHER_REV)
        if pos_cat in ("shop", "c-store", "convenience", "general"):
            return _coa(company_id, CODE_SHOP_REV) or _coa(company_id, CODE_OTHER_REV)
    return _coa(company_id, CODE_SHOP_REV) or _coa(company_id, CODE_OTHER_REV) or _coa(
        company_id, CODE_FUEL_REV
    )


def _build_revenue_splits(company_id: int, inv: Invoice) -> dict[int, Decimal]:
    amounts: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    lines = list(
        InvoiceLine.objects.filter(invoice_id=inv.id).select_related("item")
    )
    if not lines:
        acc = _revenue_account_for_item(company_id, None)
        if acc:
            amounts[acc.id] = inv.subtotal
        return dict(amounts)
    for line in lines:
        acc = _revenue_account_for_item(company_id, line.item)
        if acc:
            amounts[acc.id] += line.amount or Decimal("0")
    total_lines = sum(amounts.values(), Decimal("0"))
    if total_lines <= 0 and inv.subtotal > 0:
        acc = _revenue_account_for_item(company_id, None)
        if acc:
            amounts[acc.id] = inv.subtotal
        return dict(amounts)
    # Scale to match invoice.subtotal if rounding drift
    if inv.subtotal and total_lines and abs(total_lines - inv.subtotal) > Decimal("0.02"):
        factor = inv.subtotal / total_lines
        scaled: dict[int, Decimal] = {}
        for aid, amt in amounts.items():
            scaled[aid] = (amt * factor).quantize(Decimal("0.01"))
        amounts = defaultdict(lambda: Decimal("0"), scaled)
    return dict(amounts)


def _create_posted_entry(
    company_id: int,
    entry_date,
    entry_number: str,
    description: str,
    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]],
) -> Optional[JournalEntry]:
    total_debit = sum(d for _, d, _, _ in lines)
    total_credit = sum(c for _, _, c, _ in lines)
    if total_debit != total_credit or total_debit <= 0:
        logger.warning(
            "skip journal %s: unbalanced or zero (debit=%s credit=%s)",
            entry_number,
            total_debit,
            total_credit,
        )
        return None
    with transaction.atomic():
        if JournalEntry.objects.filter(
            company_id=company_id, entry_number=entry_number
        ).exists():
            return JournalEntry.objects.filter(
                company_id=company_id, entry_number=entry_number
            ).first()
        je = JournalEntry(
            company_id=company_id,
            entry_number=entry_number,
            entry_date=entry_date,
            description=description[:500],
            is_posted=True,
            posted_at=timezone.now(),
        )
        je.save()
        for acc, debit, credit, desc in lines:
            JournalEntryLine.objects.create(
                journal_entry=je,
                account=acc,
                debit=debit,
                credit=credit,
                description=desc[:300],
            )
        return je


def post_invoice_cogs_journal(company_id: int, inv: Invoice) -> bool:
    """
    Dr COGS / Cr inventory at average cost (item.cost x qty) for perpetual-inventory items.

    Skips service and non-inventory lines (no inventory asset to relieve). Idempotent:
    AUTO-INV-{id}-COGS.
    """
    if inv.status == "draft" or inv.total <= 0:
        return False
    entry_number = f"AUTO-INV-{inv.id}-COGS"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True

    buckets: dict[tuple[int, int], Decimal] = {}
    total_cogs = Decimal("0")
    for line in InvoiceLine.objects.filter(invoice_id=inv.id).select_related("item"):
        it = line.item
        if not it:
            continue
        if not item_tracks_physical_stock(it):
            continue
        cost = it.cost or Decimal("0")
        if cost <= 0:
            continue
        qty = line.quantity or Decimal("0")
        amt = (qty * cost).quantize(Decimal("0.01"))
        if amt <= 0:
            continue
        inv_acc = _inventory_account_for_item(company_id, it)
        cogs_acc = _cogs_account_for_item(company_id, it)
        if not inv_acc or not cogs_acc:
            continue
        key = (cogs_acc.id, inv_acc.id)
        buckets[key] = buckets.get(key, Decimal("0")) + amt
        total_cogs += amt

    if total_cogs <= 0:
        return False

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    for (cogs_id, inv_id), amt in buckets.items():
        cogs = ChartOfAccount.objects.filter(
            id=cogs_id, company_id=company_id, is_active=True
        ).first()
        inv_a = ChartOfAccount.objects.filter(
            id=inv_id, company_id=company_id, is_active=True
        ).first()
        if not cogs or not inv_a:
            continue
        lines.append(
            (cogs, amt, Decimal("0"), _gl_invoice_line_memo(inv, "COGS"))
        )
        lines.append(
            (inv_a, Decimal("0"), amt, _gl_invoice_line_memo(inv, "COGS"))
        )

    if not lines:
        return False
    debit = sum(d for _, d, _, _ in lines)
    credit = sum(c for _, _, c, _ in lines)
    if debit != credit:
        return False

    return (
        _create_posted_entry(
            company_id,
            inv.invoice_date,
            entry_number,
            _gl_invoice_journal_description(inv, "COGS"),
            lines,
        )
        is not None
    )


def delete_auto_fund_transfer_journal(company_id: int, transfer_id: int) -> int:
    """Remove GL entry for a fund transfer when unposting the transfer."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-FT-{transfer_id}",
    ).delete()
    return deleted


def post_invoice_sale_journal(
    company_id: int,
    inv: Invoice,
    *,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> bool:
    """
    Post revenue recognition for invoice (cash sale or AR).
    Idempotent via entry_number AUTO-INV-{id}-SALE.
    """
    if inv.status == "draft" or inv.total <= 0:
        return False
    entry_number = f"AUTO-INV-{inv.id}-SALE"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True

    vat_acc = _coa(company_id, CODE_VAT)
    rev_splits = _build_revenue_splits(company_id, inv)
    if not rev_splits:
        logger.warning("post_invoice_sale_journal: no revenue accounts for company %s", company_id)
        return False

    tax = inv.tax_total or Decimal("0")
    total = inv.total

    debit_acc: Optional[ChartOfAccount] = None
    if inv.status == "paid":
        debit_acc = _debit_account_for_paid_sale(
            company_id, payment_method, bank_account_id
        )
    elif inv.status in ("sent", "partial", "overdue"):
        debit_acc = _coa(company_id, CODE_AR)
    else:
        return False

    if not debit_acc:
        logger.warning(
            "post_invoice_sale_journal: missing debit account for inv %s status %s",
            inv.id,
            inv.status,
        )
        return False

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (debit_acc, total, Decimal("0"), _gl_invoice_line_memo(inv))
    ]
    for acc_id, amt in rev_splits.items():
        acc = ChartOfAccount.objects.filter(
            id=acc_id, company_id=company_id, is_active=True
        ).first()
        if not acc or amt <= 0:
            continue
        lines.append(
            (acc, Decimal("0"), amt, _gl_invoice_line_memo(inv))
        )
    if tax > 0 and vat_acc:
        lines.append(
            (vat_acc, Decimal("0"), tax, _gl_invoice_line_memo(inv, "VAT"))
        )

    credit_sum = sum(x[2] for x in lines[1:])
    debit_sum = lines[0][1]
    if credit_sum != debit_sum:
        # Adjust largest revenue line
        diff = debit_sum - credit_sum
        if len(lines) > 1:
            for i in range(1, len(lines)):
                acc, d, c, desc = lines[i]
                if c > 0:
                    lines[i] = (acc, d, (c + diff).quantize(Decimal("0.01")), desc)
                    break
        credit_sum = sum(x[2] for x in lines[1:])
    if debit_sum != credit_sum:
        logger.warning(
            "post_invoice_sale_journal: still unbalanced inv %s debit=%s credit=%s",
            inv.id,
            debit_sum,
            credit_sum,
        )
        return False

    je = _create_posted_entry(
        company_id,
        inv.invoice_date,
        entry_number,
        _gl_invoice_journal_description(inv, "Invoice"),
        lines,
    )
    if je:
        post_invoice_cogs_journal(company_id, inv)
    if je and inv.status in ("sent", "partial", "overdue") and not _is_walkin_customer(
        inv.customer
    ):
        Customer.objects.filter(pk=inv.customer_id).update(
            current_balance=F("current_balance") + total
        )
    return je is not None


def invoice_sale_used_ar(company_id: int, invoice_id: int) -> bool:
    ar = _coa(company_id, CODE_AR)
    if not ar:
        return False
    je = (
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-INV-{invoice_id}-SALE"
        )
        .prefetch_related("lines")
        .first()
    )
    if not je:
        return False
    return any(
        line.account_id == ar.id and (line.debit or 0) > 0 for line in je.lines.all()
    )


def post_invoice_receipt_journal(
    company_id: int,
    inv: Invoice,
    *,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> bool:
    """Dr Cash/Bank, Cr AR for remaining AR after payment allocations. AUTO-INV-{id}-RCPT."""
    if inv.status != "paid":
        return False
    if not invoice_sale_used_ar(company_id, inv.id):
        return False
    sale_ref = f"AUTO-INV-{inv.id}-SALE"
    if not JournalEntry.objects.filter(
        company_id=company_id, entry_number=sale_ref
    ).exists():
        return False
    entry_number = f"AUTO-INV-{inv.id}-RCPT"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True

    from api.services.payment_allocation import total_allocated_to_invoice

    allocated = total_allocated_to_invoice(company_id, inv.id)
    amt = (inv.total or Decimal("0")) - allocated
    if amt <= 0:
        return True

    ar = _coa(company_id, CODE_AR)
    cash_bank = _debit_account_for_paid_sale(
        company_id, payment_method, bank_account_id
    )
    if not ar or not cash_bank:
        return False

    rcpt = _gl_invoice_line_memo(inv, "Receipt")
    lines = [
        (cash_bank, amt, Decimal("0"), rcpt),
        (ar, Decimal("0"), amt, rcpt),
    ]
    je = _create_posted_entry(
        company_id,
        inv.invoice_date,
        entry_number,
        _gl_invoice_journal_description(inv, "Payment for"),
        lines,
    )
    if je and not _is_walkin_customer(inv.customer):
        Customer.objects.filter(pk=inv.customer_id).update(
            current_balance=F("current_balance") - amt
        )
    return je is not None


def post_payment_received_journal(company_id: int, p: Payment) -> bool:
    """Dr Bank, Cr AR. AUTO-PAY-{id}-RCV."""
    if p.payment_type != "received" or p.amount <= 0:
        return False
    entry_number = f"AUTO-PAY-{p.id}-RCV"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True
    ar = _coa(company_id, CODE_AR)
    if not ar:
        return False
    # Match POS / invoice receipt: cash → 1010 (Cash on Hand), not 1030 (bank) first.
    pm = (getattr(p, "payment_method", None) or "cash").strip().lower() or "cash"
    cash_bank = _debit_account_for_paid_sale(company_id, pm, p.bank_account_id)
    if not cash_bank:
        return False
    lines = [
        (cash_bank, p.amount, Decimal("0"), p.reference or f"PAY-{p.id}"),
        (ar, Decimal("0"), p.amount, p.reference or f"PAY-{p.id}"),
    ]
    je = _create_posted_entry(
        company_id,
        p.payment_date,
        entry_number,
        f"Payment received #{p.id}",
        lines,
    )
    if je and p.customer_id and not _is_walkin_customer(
        Customer.objects.filter(pk=p.customer_id).first()
    ):
        Customer.objects.filter(pk=p.customer_id).update(
            current_balance=F("current_balance") - p.amount
        )
    return je is not None


def reverse_payment_received_posting(company_id: int, p: Payment) -> tuple[bool, str]:
    """
    Remove AUTO-PAY-{id}-RCV and restore customer AR subledger (inverse of post_payment_received_journal).
    Does not delete the Payment row.
    """
    if p.payment_type != Payment.PAYMENT_TYPE_RECEIVED:
        return False, "not a received payment"
    entry_number = f"AUTO-PAY-{p.id}-RCV"
    je = JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).first()
    had_je = je is not None
    if je:
        je.delete()
    cust = Customer.objects.filter(pk=p.customer_id).first() if p.customer_id else None
    if had_je and p.customer_id and not _is_walkin_customer(cust):
        Customer.objects.filter(pk=p.customer_id).update(
            current_balance=F("current_balance") + (p.amount or Decimal("0"))
        )
    return True, ""


def reverse_payment_made_posting(company_id: int, p: Payment) -> tuple[bool, str]:
    """
    Remove AUTO-PAY-{id}-MADE and restore vendor A/P subledger when it was decremented.
    Does not delete the Payment row.
    """
    if p.payment_type != Payment.PAYMENT_TYPE_MADE:
        return False, "not a made payment"
    entry_number = f"AUTO-PAY-{p.id}-MADE"
    je = JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).first()
    had_je = je is not None
    if je:
        je.delete()
    if p.vendor_id and (p.vendor_ap_decremented or had_je):
        Vendor.objects.filter(pk=p.vendor_id).update(
            current_balance=F("current_balance") + (p.amount or Decimal("0"))
        )
        Payment.objects.filter(pk=p.pk).update(vendor_ap_decremented=False)
    return True, ""


def post_payment_made_journal(company_id: int, p: Payment) -> bool:
    """Dr AP, Cr Bank. AUTO-PAY-{id}-MADE."""
    if p.payment_type != "made" or p.amount <= 0:
        return False
    entry_number = f"AUTO-PAY-{p.id}-MADE"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        with transaction.atomic():
            lp = Payment.objects.select_for_update().filter(pk=p.pk).first()
            if (
                lp
                and lp.vendor_id
                and lp.payment_type == Payment.PAYMENT_TYPE_MADE
                and not lp.vendor_ap_decremented
            ):
                Vendor.objects.filter(pk=lp.vendor_id).update(
                    current_balance=F("current_balance") - lp.amount
                )
                Payment.objects.filter(pk=lp.pk).update(vendor_ap_decremented=True)
        return True
    ap = _coa(company_id, CODE_AP)
    pm = (getattr(p, "payment_method", None) or "cash").strip().lower() or "cash"
    cash_bank = _debit_account_for_paid_sale(company_id, pm, p.bank_account_id)

    je = None
    if ap and cash_bank:
        lines = [
            (ap, p.amount, Decimal("0"), p.reference or f"PAY-{p.id}"),
            (cash_bank, Decimal("0"), p.amount, p.reference or f"PAY-{p.id}"),
        ]
        je = _create_posted_entry(
            company_id,
            p.payment_date,
            entry_number,
            f"Payment made #{p.id}",
            lines,
        )

    vendor_decremented = False
    with transaction.atomic():
        lp = Payment.objects.select_for_update().filter(pk=p.pk).first()
        if (
            lp
            and lp.vendor_id
            and lp.payment_type == Payment.PAYMENT_TYPE_MADE
            and not lp.vendor_ap_decremented
        ):
            Vendor.objects.filter(pk=lp.vendor_id).update(
                current_balance=F("current_balance") - lp.amount
            )
            Payment.objects.filter(pk=lp.pk).update(vendor_ap_decremented=True)
            vendor_decremented = True

    return je is not None or vendor_decremented


def _normalize_label(s: str) -> str:
    """Lowercase, collapse whitespace (matches 'Diesel Tank 1' vs 'Diesel  Tank  1')."""
    return " ".join((s or "").strip().lower().split())


def _pick_tank_for_bill_line(line: BillLine, item: Item, tanks_qs):
    """
    Prefer line.tank_id when valid; else tank whose name starts with / contains the product name
    (e.g. Diesel -> Diesel Tank 1); else first tank by tank_name then id.
    """
    if line.tank_id:
        t = tanks_qs.filter(pk=line.tank_id).first()
        if t:
            return t
    name = _normalize_label(item.name or "")
    ordered = list(tanks_qs.order_by("tank_name", "id"))
    if not ordered:
        return None
    if name:
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            if tn.startswith(name):
                return t
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            if name in tn:
                return t
        words = [w for w in name.replace("-", " ").split() if len(w) > 1]
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            for w in words:
                if w in tn:
                    return t
    return ordered[0]


def _item_receives_physical_stock(item: Optional[Item]) -> bool:
    """
    True if a vendor bill line or POS line should move physical stock (tank and/or QOH).

    Delegates to item_catalog.item_tracks_physical_stock: **inventory** only, plus legacy
    fuel heuristics for old rows; **service** and **non_inventory** never.
    """
    return item_tracks_physical_stock(item)


def _tanks_for_stock_receipt(company_id: int, item: Item):
    """Active tanks for this product; if none and item is fuel-like, include inactive (so receipt still lands)."""
    qs = Tank.objects.filter(
        company_id=company_id, product_id=item.id, is_active=True
    )
    if qs.exists():
        return qs
    if _item_receives_physical_stock(item):
        return Tank.objects.filter(company_id=company_id, product_id=item.id).order_by(
            "-is_active", "tank_name", "id"
        )
    return Tank.objects.none()


def _sync_item_qoh_from_tanks(company_id: int, item_id: int) -> None:
    """Align Item.quantity_on_hand with tank totals (active tanks if any; else all tanks)."""
    active = Tank.objects.filter(
        company_id=company_id, product_id=item_id, is_active=True
    )
    if active.exists():
        agg = active.aggregate(s=Sum("current_stock"))["s"]
    else:
        agg = Tank.objects.filter(company_id=company_id, product_id=item_id).aggregate(
            s=Sum("current_stock")
        )["s"]
    total = agg if agg is not None else Decimal("0")
    Item.objects.filter(pk=item_id, company_id=company_id).update(quantity_on_hand=total)


def receipt_inventory_from_posted_bill(
    bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> int:
    """
    When a vendor bill is posted, increase stock for inventory / fuel lines.
    Fuel (items linked to tanks): add quantity to the line's tank (explicit id or best match by name),
    then sync Item.quantity_on_hand from tank totals. Non-tank inventory: Item.quantity_on_hand only.
    Returns the number of bill lines that applied a stock movement.
    """
    from api.services.inventory_validation import lock_tanks_and_assert_receipt_capacity

    lock_tanks_and_assert_receipt_capacity(
        bill, acknowledge_tank_overfill=acknowledge_tank_overfill
    )
    applied_lines = 0
    company_id = bill.company_id
    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item", "tank"):
        item = line.item
        if not item:
            continue
        qty = line.quantity if line.quantity is not None else Decimal("0")
        if qty <= 0:
            continue
        if not _item_receives_physical_stock(item):
            continue
        applied_lines += 1
        tanks_qs = _tanks_for_stock_receipt(company_id, item)
        if tanks_qs.exists():
            tank = _pick_tank_for_bill_line(line, item, tanks_qs)
            if tank:
                Tank.objects.filter(pk=tank.pk).update(current_stock=F("current_stock") + qty)
                _sync_item_qoh_from_tanks(company_id, item.id)
        else:
            Item.objects.filter(pk=item.pk).update(quantity_on_hand=F("quantity_on_hand") + qty)
    return applied_lines


def reverse_receipt_inventory_from_posted_bill(bill: Bill) -> None:
    """Undo receipt_inventory_from_posted_bill for current line rows (mirror receipt logic)."""
    company_id = bill.company_id
    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item", "tank"):
        item = line.item
        if not item:
            continue
        qty = line.quantity if line.quantity is not None else Decimal("0")
        if qty <= 0:
            continue
        if not _item_receives_physical_stock(item):
            continue
        tanks_qs = _tanks_for_stock_receipt(company_id, item)
        if tanks_qs.exists():
            tank = _pick_tank_for_bill_line(line, item, tanks_qs)
            if tank:
                Tank.objects.filter(pk=tank.pk).update(current_stock=F("current_stock") - qty)
                _sync_item_qoh_from_tanks(company_id, item.id)
        else:
            Item.objects.filter(pk=item.pk).update(quantity_on_hand=F("quantity_on_hand") - qty)


def undo_bill_stock_receipt(bill: Bill) -> None:
    """
    If stock was received for this bill, reverse tank/QOH movements and clear the flag.
    Call before replacing bill lines so a new receipt can be applied.
    """
    with transaction.atomic():
        locked = (
            Bill.objects.select_for_update()
            .filter(pk=bill.pk)
            .only("id", "stock_receipt_applied")
            .first()
        )
        if not locked or not locked.stock_receipt_applied:
            return
        reverse_receipt_inventory_from_posted_bill(bill)
        Bill.objects.filter(pk=bill.pk).update(stock_receipt_applied=False)


def try_apply_bill_stock_receipt(
    bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> None:
    """
    Apply inventory receipt once per bill (idempotent). Uses row lock so concurrent calls
    do not double-post stock.
    """
    with transaction.atomic():
        locked = (
            Bill.objects.select_for_update()
            .filter(pk=bill.pk)
            .only("id", "stock_receipt_applied")
            .first()
        )
        if not locked or locked.stock_receipt_applied:
            return
        n = receipt_inventory_from_posted_bill(
            bill, acknowledge_tank_overfill=acknowledge_tank_overfill
        )
        if n > 0:
            Bill.objects.filter(pk=bill.pk).update(stock_receipt_applied=True)


def _build_bill_journal_lines(
    company_id: int, bill: Bill
) -> Optional[list[tuple[ChartOfAccount, Decimal, Decimal, str]]]:
    """
    Build balanced GL lines for a vendor bill.
    Inventory lines debit Inventory Fuel (1200) / Inventory Shop (1220) per item; any
    remainder (tax, non-inventory lines, missing COA) debits office expense; credit AP.
    """
    ap = _coa(company_id, CODE_AP)
    exp = _coa(company_id, CODE_OFFICE_EXP) or ChartOfAccount.objects.filter(
        company_id=company_id, account_type="expense", is_active=True
    ).first()
    if not ap or not exp:
        return None

    total = bill.total
    inv_amounts: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    other_debit = Decimal("0")

    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item"):
        amt = line.amount if line.amount is not None else Decimal("0")
        if amt <= 0:
            continue
        item = line.item
        if not item:
            other_debit += amt
            continue
        if _item_receives_physical_stock(item):
            inv_acc = _inventory_account_for_item(company_id, item)
            if inv_acc:
                inv_amounts[inv_acc.id] += amt
            else:
                other_debit += amt
        else:
            other_debit += amt

    sum_lines = sum(inv_amounts.values(), Decimal("0")) + other_debit
    remainder = total - sum_lines
    if remainder > 0:
        other_debit += remainder
    elif remainder < 0:
        need = -remainder
        for acc_id in sorted(inv_amounts.keys(), key=lambda k: inv_amounts[k], reverse=True):
            if need <= 0:
                break
            avail = inv_amounts[acc_id]
            if avail <= 0:
                continue
            take = min(need, avail)
            inv_amounts[acc_id] -= take
            need -= take
        if need > 0:
            logger.warning(
                "bill %s: line amounts exceed total by %s after inventory trim",
                bill.id,
                need,
            )
            return None

    if not any(amt > 0 for amt in inv_amounts.values()):
        return [
            (exp, total, Decimal("0"), bill.bill_number),
            (ap, Decimal("0"), total, bill.bill_number),
        ]

    je_lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    for acc_id, amt in sorted(inv_amounts.items()):
        if amt <= 0:
            continue
        acc = ChartOfAccount.objects.filter(
            pk=acc_id, company_id=company_id, is_active=True
        ).first()
        if acc:
            je_lines.append((acc, amt, Decimal("0"), bill.bill_number))
    if other_debit > 0:
        je_lines.append((exp, other_debit, Decimal("0"), bill.bill_number))
    je_lines.append((ap, Decimal("0"), total, bill.bill_number))

    td = sum(d for _, d, _, _ in je_lines)
    tc = sum(c for _, _, c, _ in je_lines)
    if td != tc or td <= 0:
        logger.warning(
            "skip bill %s journal: unbalanced (debit=%s credit=%s)",
            bill.id,
            td,
            tc,
        )
        return None
    return je_lines


def bill_eligible_for_posting(bill: Optional[Bill]) -> bool:
    """
    Posted vendor bills that should drive GL (when COA allows), vendor A/P, and inventory/tanks.
    Draft, void, non-positive totals, or unknown statuses are excluded.
    """
    if not bill:
        return False
    total = bill.total if bill.total is not None else Decimal("0")
    if total <= 0:
        return False
    st = (bill.status or "").strip().lower()
    return st in ("open", "paid", "partial", "overdue")


def _ensure_vendor_ap_for_posted_bill(company_id: int, bill: Bill) -> None:
    """
    Add bill total to vendor.current_balance once (idempotent via vendor_ap_incremented).
    Runs for every posted bill so A/P stays in sync even when AUTO-BILL GL entry cannot be built.
    """
    with transaction.atomic():
        b = Bill.objects.select_for_update().filter(pk=bill.pk, company_id=company_id).first()
        if not b or not bill_eligible_for_posting(b):
            return
        if not b.vendor_id or b.vendor_ap_incremented:
            return
        amt = b.total if b.total is not None else Decimal("0")
        if amt <= 0:
            return
        Vendor.objects.filter(pk=b.vendor_id).update(current_balance=F("current_balance") + amt)
        Bill.objects.filter(pk=b.pk).update(vendor_ap_incremented=True)


def cleanup_vendor_bill_posting_effects(company_id: int, bill: Bill) -> None:
    """
    Before deleting a bill: reverse tank/item receipt, remove AUTO-BILL journal, roll back vendor A/P bump.
    Caller must ensure no payment allocations remain on the bill.
    """
    with transaction.atomic():
        b = Bill.objects.select_for_update().filter(pk=bill.pk, company_id=company_id).first()
        if not b:
            return
        undo_bill_stock_receipt(b)
        b.refresh_from_db(fields=["vendor_ap_incremented", "vendor_id", "total"])
        if b.vendor_ap_incremented and b.vendor_id:
            amt = b.total if b.total is not None else Decimal("0")
            if amt > 0:
                Vendor.objects.filter(pk=b.vendor_id).update(
                    current_balance=F("current_balance") - amt
                )
            Bill.objects.filter(pk=b.pk).update(vendor_ap_incremented=False)
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-BILL-{b.id}"
        ).delete()


def sync_posted_vendor_bill(
    company_id: int, bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> bool:
    """
    Single integration point: reload bill from DB, then GL (if possible), vendor A/P, and inventory/tanks.
    """
    fresh = Bill.objects.filter(pk=bill.pk, company_id=company_id).first()
    if not fresh:
        return False
    return post_bill_journal(
        company_id, fresh, acknowledge_tank_overfill=acknowledge_tank_overfill
    )


def post_bill_journal(
    company_id: int, bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> bool:
    """
    Post vendor bill: AUTO-BILL-{id} when chart of accounts allows; always (when posted) vendor A/P
    and one-time inventory/tank receipt for qualifying lines.
    """
    bill = Bill.objects.filter(pk=bill.pk, company_id=company_id).first()
    if not bill or not bill_eligible_for_posting(bill):
        return False
    entry_number = f"AUTO-BILL-{bill.id}"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        _ensure_vendor_ap_for_posted_bill(company_id, bill)
        try:
            try_apply_bill_stock_receipt(
                bill, acknowledge_tank_overfill=acknowledge_tank_overfill
            )
        except StockBusinessError:
            raise
        except Exception:
            logger.exception(
                "try_apply_bill_stock_receipt failed for bill %s (journal already exists)",
                bill.id,
            )
        return True

    lines = _build_bill_journal_lines(company_id, bill)
    je = None
    if lines:
        je = _create_posted_entry(
            company_id,
            bill.bill_date,
            entry_number,
            f"Bill {bill.bill_number}",
            lines,
        )

    _ensure_vendor_ap_for_posted_bill(company_id, bill)

    try:
        try_apply_bill_stock_receipt(
            bill, acknowledge_tank_overfill=acknowledge_tank_overfill
        )
    except StockBusinessError:
        raise
    except Exception:
        logger.exception(
            "try_apply_bill_stock_receipt failed for bill %s (after journal attempt)",
            bill.id,
        )
    return je is not None


def post_fund_transfer_journal(company_id: int, ft: FundTransfer) -> bool:
    """Dr destination bank GL, Cr source bank GL. AUTO-FT-{id}."""
    if not ft.is_posted:
        return False
    entry_number = f"AUTO-FT-{ft.id}"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True
    from_acc = (
        ft.from_bank.chart_account
        if ft.from_bank and ft.from_bank.chart_account_id
        else None
    )
    to_acc = (
        ft.to_bank.chart_account
        if ft.to_bank and ft.to_bank.chart_account_id
        else None
    )
    if not from_acc or not to_acc:
        return False
    amt = ft.amount
    lines = [
        (to_acc, amt, Decimal("0"), ft.reference or f"FT-{ft.id}"),
        (from_acc, Decimal("0"), amt, ft.reference or f"FT-{ft.id}"),
    ]
    return (
        _create_posted_entry(
            company_id,
            ft.transfer_date,
            entry_number,
            f"Fund transfer #{ft.id}",
            lines,
        )
        is not None
    )


def sync_invoice_gl(
    company_id: int,
    inv: Invoice,
    *,
    old_status: Optional[str] = None,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> None:
    """Create posted journals for invoice lifecycle (sale + optional AR receipt)."""
    inv.refresh_from_db()
    post_invoice_sale_journal(
        company_id,
        inv,
        payment_method=payment_method,
        bank_account_id=bank_account_id,
    )
    if (
        old_status
        and old_status != "paid"
        and inv.status == "paid"
        and invoice_sale_used_ar(company_id, inv.id)
    ):
        post_invoice_receipt_journal(
            company_id,
            inv,
            payment_method=payment_method,
            bank_account_id=bank_account_id,
        )


def _payment_received_clearing_buckets(
    company_id: int, payment_id: int
) -> Optional[dict[int, tuple[ChartOfAccount, Decimal]]]:
    """Debit-side lines from AUTO-PAY-{id}-RCV (cash / undeposited / card clearing), keyed by chart account id."""
    en = f"AUTO-PAY-{payment_id}-RCV"
    je = (
        JournalEntry.objects.filter(company_id=company_id, entry_number=en)
        .prefetch_related("lines__account")
        .first()
    )
    if not je:
        return None
    buckets: dict[int, tuple[ChartOfAccount, Decimal]] = {}
    for ln in je.lines.all():
        d = ln.debit or Decimal("0")
        if d <= 0:
            continue
        aid = ln.account_id
        acc = ln.account
        if aid not in buckets:
            buckets[aid] = (acc, Decimal("0"))
        a0, s0 = buckets[aid]
        buckets[aid] = (a0, s0 + d)
    return buckets if buckets else None


def post_bank_deposit_journal(
    company_id: int,
    deposit_id: int,
    dest_bank: BankAccount,
    payments: list[Payment],
    deposit_date: date,
    memo: str,
) -> bool:
    """
    Move funds from receipt clearing accounts into the destination bank GL account.

    Dr Bank (register's chart account), Cr clearing account(s) from each payment's
    AUTO-PAY-*-RCV journal. Idempotent: AUTO-DEP-{deposit_id}.
    """
    if not payments:
        return False
    entry_number = f"AUTO-DEP-{deposit_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return True
    dest = dest_bank.chart_account
    if not dest:
        logger.warning(
            "post_bank_deposit_journal: bank account %s has no linked chart account",
            dest_bank.id,
        )
        return False

    credits: dict[int, tuple[ChartOfAccount, Decimal]] = {}
    total_dr = Decimal("0")
    for p in payments:
        buckets = _payment_received_clearing_buckets(company_id, p.id)
        if not buckets:
            logger.warning(
                "post_bank_deposit_journal: missing AUTO-PAY-%s-RCV for payment %s",
                p.id,
                p.id,
            )
            return False
        pay_amt = (p.amount or Decimal("0")).quantize(Decimal("0.01"))
        if pay_amt <= 0:
            return False
        je_total = sum(s for _, s in buckets.values())
        if je_total <= 0:
            return False
        scale = pay_amt / je_total
        for aid, (acc, dsum) in buckets.items():
            part = (dsum * scale).quantize(Decimal("0.01"))
            if aid not in credits:
                credits[aid] = (acc, Decimal("0"))
            a0, s0 = credits[aid]
            credits[aid] = (a0, s0 + part)
        total_dr += pay_amt

    line_desc = (memo or f"Bank deposit #{deposit_id}")[:300]
    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (dest, total_dr, Decimal("0"), line_desc)
    ]
    credit_sum = Decimal("0")
    for acc, camt in credits.values():
        camt = camt.quantize(Decimal("0.01"))
        lines.append((acc, Decimal("0"), camt, line_desc))
        credit_sum += camt

    if abs(credit_sum - total_dr) > Decimal("0.05"):
        logger.warning(
            "post_bank_deposit_journal: credits %s != debits %s for deposit %s",
            credit_sum,
            total_dr,
            deposit_id,
        )
        return False

    je = _create_posted_entry(
        company_id,
        deposit_date,
        entry_number,
        f"Bank deposit #{deposit_id}",
        lines,
    )
    return je is not None


def _payroll_deduction_credit_account(company_id: int) -> Optional[ChartOfAccount]:
    """Statutory or generic payroll liability for withheld amounts."""
    a = _coa(company_id, CODE_STAT_DED)
    if a:
        return a
    return _coa(company_id, CODE_SALARY_PAYABLE)


def _payroll_net_pay_credit_account(
    company_id: int,
    bank_account_id: Optional[int],
    pay_from_chart_account_id: Optional[int],
) -> tuple[Optional[ChartOfAccount], Optional[str]]:
    """
    GL account to credit for net pay. Bank register wins if both are sent.
    """
    if bank_account_id:
        bank = (
            BankAccount.objects.filter(
                id=bank_account_id, company_id=company_id, is_active=True
            )
            .select_related("chart_account")
            .first()
        )
        if not bank or not bank.chart_account_id:
            return None, (
                "Bank account is missing or not linked to a chart of accounts line. "
                "Link it in Banking, or pick a bank/cash GL account below."
            )
        return bank.chart_account, None

    if pay_from_chart_account_id:
        coa = (
            ChartOfAccount.objects.filter(
                id=pay_from_chart_account_id,
                company_id=company_id,
                is_active=True,
            )
            .first()
        )
        if not coa:
            return None, "Selected GL account was not found or is inactive."
        t = normalize_chart_account_type(coa.account_type)
        if t not in ("asset", "bank_account"):
            return None, (
                "Net pay must be credited to a bank or cash asset account "
                f"(e.g. {CODE_BANK_OP} or {CODE_CASH}). "
                f"Account {coa.account_code} is not valid for net pay; salary expense still uses {CODE_SALARY_EXP}."
            )
        return coa, None

    pay = _coa(company_id, CODE_BANK_OP) or _coa(company_id, CODE_CASH)
    if not pay:
        return None, f"Add chart {CODE_BANK_OP} / {CODE_CASH} or select a register / GL account above for net pay."
    return pay, None


def post_payroll_salary(
    company_id: int,
    pr: PayrollRun,
    bank_account_id: Optional[int] = None,
    pay_from_chart_account_id: Optional[int] = None,
):
    """
    Book net salary paid from a bank (or default cash/bank account).

    Dr 6400 (Salaries & Wages) = gross
    Cr 2210/2200 = total_deductions (when > 0)
    Cr selected bank register, chosen GL account, or default 1030/1010 = net pay to employees

    If both bank_account_id and pay_from_chart_account_id are provided, the bank register is used.
    Idempotent entry: AUTO-PAYROLL-{id}. Returns (JournalEntry|None, error message).
    """
    pr = PayrollRun.objects.filter(id=pr.id, company_id=company_id).first()
    if not pr:
        return None, "Payroll run not found"
    if pr.salary_journal_id:
        return pr.salary_journal, ""

    gross = (pr.total_gross or Decimal("0")).quantize(Decimal("0.01"))
    ded = (pr.total_deductions or Decimal("0")).quantize(Decimal("0.01"))
    net = (pr.total_net or Decimal("0")).quantize(Decimal("0.01"))
    if gross <= 0:
        return None, "Set payroll totals first (gross must be positive)."
    if abs(gross - ded - net) > Decimal("0.02"):
        return (
            None,
            f"Gross ({gross}) must equal deductions ({ded}) + net pay ({net})",
        )

    expense = _coa(company_id, CODE_SALARY_EXP)
    if not expense:
        return None, f"Add chart account {CODE_SALARY_EXP} (Salaries & Wages) to post salary."

    pay_account, pay_err = _payroll_net_pay_credit_account(
        company_id, bank_account_id, pay_from_chart_account_id
    )
    if pay_err or not pay_account:
        return None, pay_err or "Could not resolve account for net pay"

    if ded > 0 and not _payroll_deduction_credit_account(company_id):
        return None, f"For deductions, add {CODE_STAT_DED} or {CODE_SALARY_PAYABLE} in the chart of accounts."

    ref = f"{pr.payroll_number or f'PR-{pr.id}'}"[:300]
    en = f"AUTO-PAYROLL-{pr.id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        je = JournalEntry.objects.filter(company_id=company_id, entry_number=en).first()
        if je and not pr.salary_journal_id:
            PayrollRun.objects.filter(pk=pr.pk).update(salary_journal=je, status="paid")
        return je, ""

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (expense, gross, Decimal("0"), f"Gross pay — {ref}"),
    ]
    if ded > 0:
        dacc = _payroll_deduction_credit_account(company_id)
        if not dacc:
            return None, "Deductions account not configured"
        lines.append((dacc, Decimal("0"), ded, f"Deductions / withholdings — {ref}"))

    lines.append((pay_account, Decimal("0"), net, f"Net pay — {ref}"))

    je = _create_posted_entry(
        company_id,
        pr.payment_date,
        en,
        f"Salary pay {pr.payroll_number or en}",
        lines,
    )
    if not je:
        return None, "Failed to post journal (unbalanced or invalid)"
    with transaction.atomic():
        PayrollRun.objects.filter(pk=pr.pk).update(salary_journal=je, status="paid")
    return je, ""
