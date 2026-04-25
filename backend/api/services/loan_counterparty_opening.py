"""Post loan counterparty opening balances to Opening Balance Equity and loan principal GL lines."""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from api.models import ChartOfAccount, LoanCounterparty
from api.services.gl_posting import _create_posted_entry

logger = logging.getLogger(__name__)

CODE_LENT_PRINCIPAL = "1160"  # Loans Receivable — from 0016 migration
CODE_BORROWED_PRINCIPAL = "2410"  # Loans Payable
CODE_OPENING_BALANCE_EQUITY = "3200"


def _coa(company_id: int, code: str) -> ChartOfAccount | None:
    return (
        ChartOfAccount.objects.filter(company_id=company_id, account_code=code, is_active=True)
        .order_by("id")
        .first()
    )


def resolve_opening_balance_equity(company_id: int) -> ChartOfAccount | None:
    a = (
        ChartOfAccount.objects.filter(
            company_id=company_id, is_active=True, account_sub_type="opening_balance_equity"
        )
        .order_by("id")
        .first()
    )
    if a:
        return a
    return _coa(company_id, CODE_OPENING_BALANCE_EQUITY)


def resolve_default_loan_principal(company_id: int, receivable: bool) -> ChartOfAccount | None:
    """receivable=True -> money owed to the company (1160). False -> the company owes (2410)."""
    code = CODE_LENT_PRINCIPAL if receivable else CODE_BORROWED_PRINCIPAL
    return _coa(company_id, code)


def post_loan_counterparty_opening(company_id: int, c: LoanCounterparty, *, post_to_gl: bool = True) -> bool:
    """
    Receivable: Dr Loan Rcv, Cr OBE. Payable: Dr OBE, Cr Loan Pay.
    Idempotent: entry_number AUTO-LOAN-CP-OB-{c.id} — reuses if exists.
    Returns True if journal exists or is created; False on skip / failure.
    """
    if c.opening_balance_journal_id:
        return True

    amt = c.opening_balance or Decimal("0")
    t = c.opening_balance_type or LoanCounterparty.OPENING_ZERO
    if t == LoanCounterparty.OPENING_ZERO or amt <= Decimal("0.005"):
        return True
    if t not in (LoanCounterparty.OPENING_RECEIVABLE, LoanCounterparty.OPENING_PAYABLE):
        return True

    ob_date = c.opening_balance_as_of
    if not ob_date:
        logger.warning("counterparty %s: opening balance but no as_of date", c.id)
        return False

    if not post_to_gl:
        return True

    principal = c.opening_principal_account
    if (
        not principal
        or principal.company_id != company_id
        or not principal.is_active
    ):
        logger.warning("counterparty %s: missing opening_principal_account for GL", c.id)
        return False
    if c.opening_equity_account_id:
        eq = c.opening_equity_account
        if not eq or eq.company_id != company_id or not eq.is_active:
            return False
        equity = eq
    else:
        equity = resolve_opening_balance_equity(company_id)
    if not equity:
        logger.warning("company %s: no Opening Balance Equity (3200) line for counterparty %s", company_id, c.id)
        return False

    is_recv = t == LoanCounterparty.OPENING_RECEIVABLE
    memo_p = f"Opening loan balance — {c.name}"[:280]
    memo_e = f"Opening balance offset — {c.name}"[:280]
    if is_recv:
        lines = [
            (principal, amt, Decimal("0"), memo_p),
            (equity, Decimal("0"), amt, memo_e),
        ]
        desc = f"Loan receivable opening — {c.name}"[:500]
    else:
        lines = [
            (equity, amt, Decimal("0"), memo_e),
            (principal, Decimal("0"), amt, memo_p),
        ]
        desc = f"Loan payable opening — {c.name}"[:500]

    entry_number = f"AUTO-LOAN-CP-OB-{c.id}"
    with transaction.atomic():
        je = _create_posted_entry(company_id, ob_date, entry_number, desc, lines)
        if not je:
            return False
        LoanCounterparty.objects.filter(pk=c.pk, company_id=company_id).update(
            opening_balance_journal=je
        )
    c.opening_balance_journal_id = je.id
    return True
