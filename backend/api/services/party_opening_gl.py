"""Optional G/L posting for customer A/R and vendor A/P opening balances at go-live."""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction

from api.models import Customer, Employee, JournalEntry, Vendor
from api.services.gl_posting import CODE_AP, CODE_AR, CODE_SALARY_PAYABLE, _coa, _create_posted_entry
from api.services.loan_counterparty_opening import resolve_opening_balance_equity

logger = logging.getLogger(__name__)

CODE_EMP_ADVANCE = "1150"


def _journal_fields(entity) -> dict:
    locked = bool(entity.opening_balance_journal_id)
    je_num = ""
    if entity.opening_balance_journal_id and entity.opening_balance_journal:
        je_num = (entity.opening_balance_journal.entry_number or "").strip()
    return {
        "opening_balance_locked": locked,
        "opening_balance_journal_id": entity.opening_balance_journal_id,
        "opening_balance_journal_number": je_num,
    }


def customer_opening_fields_for_api(cust: Customer) -> dict:
    return _journal_fields(cust)


def vendor_opening_fields_for_api(vend: Vendor) -> dict:
    return _journal_fields(vend)


def employee_opening_fields_for_api(emp: Employee) -> dict:
    return _journal_fields(emp)


def _delete_opening_journal(company_id: int, entry_number: str) -> int:
    deleted, _ = JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).delete()
    return deleted


def _remove_opening_gl(company_id: int, model, pk: int, entry_number: str) -> None:
    _delete_opening_journal(company_id, entry_number)
    model.objects.filter(pk=pk).update(opening_balance_journal_id=None)


def post_customer_opening_gl(company_id: int, cust: Customer, *, post_to_gl: bool = True) -> bool:
    """Positive A/R: Dr 1100, Cr opening equity. Negative: Dr equity, Cr 1100."""
    entry_number = f"AUTO-CUST-OB-{cust.id}"
    amt = cust.opening_balance or Decimal("0")
    if abs(amt) <= Decimal("0.005"):
        if cust.opening_balance_journal_id:
            _remove_opening_gl(company_id, Customer, cust.id, entry_number)
            cust.opening_balance_journal_id = None
        return True
    if not cust.opening_balance_date:
        return False
    if not post_to_gl:
        return True
    if cust.opening_balance_journal_id:
        return True

    ar = _coa(company_id, CODE_AR)
    equity = resolve_opening_balance_equity(company_id)
    if not ar or not equity:
        logger.warning(
            "company %s customer %s: missing 1100 or opening balance equity for opening G/L",
            company_id,
            cust.id,
        )
        return False

    mag = abs(amt).quantize(Decimal("0.01"))
    name = (cust.company_name or cust.display_name or f"Customer #{cust.id}").strip()[:120]
    memo = f"Customer A/R opening — {name}"[:280]
    if amt > 0:
        lines = [(ar, mag, Decimal("0"), memo), (equity, Decimal("0"), mag, memo)]
        desc = f"Customer opening receivable — {name}"[:500]
    else:
        lines = [(equity, mag, Decimal("0"), memo), (ar, Decimal("0"), mag, memo)]
        desc = f"Customer opening credit — {name}"[:500]

    with transaction.atomic():
        _delete_opening_journal(company_id, entry_number)
        je = _create_posted_entry(company_id, cust.opening_balance_date, entry_number, desc, lines)
        if not je:
            return False
        Customer.objects.filter(pk=cust.pk, company_id=company_id).update(opening_balance_journal_id=je.id)
    cust.opening_balance_journal_id = je.id
    return True


def post_vendor_opening_gl(company_id: int, vend: Vendor, *, post_to_gl: bool = True) -> bool:
    """Positive A/P (we owe): Dr opening equity, Cr 2000. Negative: Dr 2000, Cr equity."""
    entry_number = f"AUTO-VEND-OB-{vend.id}"
    amt = vend.opening_balance or Decimal("0")
    if abs(amt) <= Decimal("0.005"):
        if vend.opening_balance_journal_id:
            _remove_opening_gl(company_id, Vendor, vend.id, entry_number)
            vend.opening_balance_journal_id = None
        return True
    if not vend.opening_balance_date:
        return False
    if not post_to_gl:
        return True
    if vend.opening_balance_journal_id:
        return True

    ap = _coa(company_id, CODE_AP)
    equity = resolve_opening_balance_equity(company_id)
    if not ap or not equity:
        logger.warning(
            "company %s vendor %s: missing 2000 or opening balance equity for opening G/L",
            company_id,
            vend.id,
        )
        return False

    mag = abs(amt).quantize(Decimal("0.01"))
    name = (vend.company_name or vend.display_name or f"Vendor #{vend.id}").strip()[:120]
    memo = f"Vendor A/P opening — {name}"[:280]
    if amt > 0:
        lines = [(equity, mag, Decimal("0"), memo), (ap, Decimal("0"), mag, memo)]
        desc = f"Vendor opening payable — {name}"[:500]
    else:
        lines = [(ap, mag, Decimal("0"), memo), (equity, Decimal("0"), mag, memo)]
        desc = f"Vendor opening credit — {name}"[:500]

    with transaction.atomic():
        _delete_opening_journal(company_id, entry_number)
        je = _create_posted_entry(company_id, vend.opening_balance_date, entry_number, desc, lines)
        if not je:
            return False
        Vendor.objects.filter(pk=vend.pk, company_id=company_id).update(opening_balance_journal_id=je.id)
    vend.opening_balance_journal_id = je.id
    return True


def apply_customer_opening_gl(
    company_id: int,
    cust: Customer,
    *,
    post_to_gl: bool = True,
) -> str | None:
    if not post_customer_opening_gl(company_id, cust, post_to_gl=post_to_gl):
        if post_to_gl and abs(cust.opening_balance or Decimal("0")) > Decimal("0.005"):
            return (
                "Could not post customer opening to the general ledger. "
                "Ensure accounts 1100 and 3200 exist, or set post_opening_to_gl to false."
            )
    return None


def apply_vendor_opening_gl(
    company_id: int,
    vend: Vendor,
    *,
    post_to_gl: bool = True,
) -> str | None:
    if not post_vendor_opening_gl(company_id, vend, post_to_gl=post_to_gl):
        if post_to_gl and abs(vend.opening_balance or Decimal("0")) > Decimal("0.005"):
            return (
                "Could not post vendor opening to the general ledger. "
                "Ensure accounts 2000 and 3200 exist, or set post_opening_to_gl to false."
            )
    return None


def post_employee_opening_gl(company_id: int, emp: Employee, *, post_to_gl: bool = True) -> bool:
    """Positive (we owe): Dr equity, Cr 2200. Negative (advance): Dr 1150, Cr equity."""
    entry_number = f"AUTO-EMP-OB-{emp.id}"
    amt = emp.opening_balance or Decimal("0")
    if abs(amt) <= Decimal("0.005"):
        if emp.opening_balance_journal_id:
            _remove_opening_gl(company_id, Employee, emp.id, entry_number)
            emp.opening_balance_journal_id = None
        return True
    if not emp.opening_balance_date:
        return False
    if not post_to_gl:
        return True
    if emp.opening_balance_journal_id:
        return True

    payable = _coa(company_id, CODE_SALARY_PAYABLE)
    advance = _coa(company_id, CODE_EMP_ADVANCE)
    equity = resolve_opening_balance_equity(company_id)
    if not equity or (amt > 0 and not payable) or (amt < 0 and not advance):
        logger.warning(
            "company %s employee %s: missing 2200/1150 or opening balance equity for opening G/L",
            company_id,
            emp.id,
        )
        return False

    mag = abs(amt).quantize(Decimal("0.01"))
    name = f"{emp.first_name} {emp.last_name}".strip() or f"Employee #{emp.id}"
    name = name[:120]
    memo = f"Employee opening — {name}"[:280]
    if amt > 0:
        lines = [(equity, mag, Decimal("0"), memo), (payable, Decimal("0"), mag, memo)]
        desc = f"Employee opening payable — {name}"[:500]
    else:
        lines = [(advance, mag, Decimal("0"), memo), (equity, Decimal("0"), mag, memo)]
        desc = f"Employee opening advance — {name}"[:500]

    with transaction.atomic():
        _delete_opening_journal(company_id, entry_number)
        je = _create_posted_entry(company_id, emp.opening_balance_date, entry_number, desc, lines)
        if not je:
            return False
        Employee.objects.filter(pk=emp.pk, company_id=company_id).update(opening_balance_journal_id=je.id)
    emp.opening_balance_journal_id = je.id
    return True


def apply_employee_opening_gl(
    company_id: int,
    emp: Employee,
    *,
    post_to_gl: bool = True,
) -> str | None:
    if not post_employee_opening_gl(company_id, emp, post_to_gl=post_to_gl):
        if post_to_gl and abs(emp.opening_balance or Decimal("0")) > Decimal("0.005"):
            return (
                "Could not post employee opening to the general ledger. "
                "Ensure accounts 2200, 1150, and 3200 exist, or set post_opening_to_gl to false."
            )
    return None
