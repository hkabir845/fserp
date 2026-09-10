"""Post loan disbursements and repayments to the same GL as the rest of the ERP."""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from api.models import ChartOfAccount, Loan, LoanDisbursement, LoanInterestAccrual, LoanRepayment, Station
from api.services.loan_islamic import loan_uses_islamic_terminology
from api.services.entity_gl_scoping import validate_loan_interest_entity_tags_for_gl
from api.services.gl_posting import _create_posted_entry

logger = logging.getLogger(__name__)


def _coa_ok(company_id: int, acc: ChartOfAccount | None) -> bool:
    return bool(acc and acc.company_id == company_id and acc.is_active)


def _coa_label(acc: ChartOfAccount | None) -> str:
    """Short code + name for journal descriptions (settlement / bank visibility)."""
    if not acc:
        return ""
    code = (acc.account_code or "").strip()
    name = (acc.account_name or "").strip()
    if code and name:
        return f"{code} — {name}"[:200]
    return (code or name)[:200]


def unsettled_accrued_interest(loan: Loan, *, exclude_repayment_id: int | None = None) -> Decimal:
    """Accrued interest posted to the accrual account that no repayment has cleared yet.

    Accruing interest posts Dr interest expense / Cr accrued interest payable. When the
    payment then arrives, the expense has already been recognised: the payment settles the
    *liability*, it is not a second expense. Debiting the interest account again would
    recognise the same interest twice and leave the accrual balance growing forever.

    Derived rather than stored, so no migration and no state to fall out of step: total
    unreversed accruals for this loan, less interest already paid on it.
    """
    accrued = Decimal("0")
    for a in LoanInterestAccrual.objects.filter(loan_id=loan.id, reversed_at__isnull=True).only(
        "amount"
    ):
        accrued += a.amount or Decimal("0")
    if accrued <= 0:
        return Decimal("0")
    paid_qs = LoanRepayment.objects.filter(loan_id=loan.id, journal_entry__isnull=False)
    if exclude_repayment_id is not None:
        paid_qs = paid_qs.exclude(pk=exclude_repayment_id)
    paid = Decimal("0")
    for r in paid_qs.only("interest_amount"):
        paid += r.interest_amount or Decimal("0")
    return max(Decimal("0"), accrued - paid)


def _loan_gl_station_id(loan: Loan) -> Optional[int]:
    """Active company station for optional segment tagging on auto-posted loan journals."""
    sid = getattr(loan, "station_id", None)
    if not sid:
        return None
    if Station.objects.filter(pk=sid, company_id=loan.company_id, is_active=True).exists():
        return int(sid)
    return None


def post_loan_disbursement(company_id: int, d: LoanDisbursement) -> bool:
    """
    Borrowed: Dr settlement (bank/cash), Cr principal (payable).
    Lent: Dr principal (receivable), Cr settlement.
    """
    loan = d.loan
    if loan.company_id != company_id:
        return False
    amt = d.amount or Decimal("0")
    if amt <= 0:
        return False
    settlement = loan.settlement_account
    principal = loan.principal_account
    if not _coa_ok(company_id, settlement) or not _coa_ok(company_id, principal):
        logger.warning("loan disbursement %s: invalid GL accounts", d.id)
        return False
    entry_number = f"AUTO-LOAN-DISP-{d.id}"
    base = (d.reference or d.memo or loan.loan_no or "").strip()
    settle_lbl = _coa_label(settlement)
    isl = loan_uses_islamic_terminology(loan)
    je_desc = (
        (
            f"Islamic financing disbursement {loan.loan_no} — settlement {settle_lbl}"
            if settle_lbl
            else f"Islamic financing disbursement {loan.loan_no}"
        )
        if isl
        else (
            f"Loan disbursement {loan.loan_no} — payment/settlement {settle_lbl}"
            if settle_lbl
            else f"Loan disbursement {loan.loan_no}"
        )
    )
    memo_prin = (
        (f"Financing principal · {base}" if base else "Financing principal")
        if isl
        else (f"Principal · {base}" if base else "Principal")
    )[:280]
    memo_settle = (
        (f"Payment/settlement {settle_lbl} · {base}" if base else f"Payment/settlement {settle_lbl}")
    )[:280]
    if loan.direction == Loan.DIRECTION_LENT:
        lines = [
            (principal, amt, Decimal("0"), memo_prin),
            (settlement, Decimal("0"), amt, memo_settle),
        ]
    else:
        lines = [
            (settlement, amt, Decimal("0"), memo_settle),
            (principal, Decimal("0"), amt, memo_prin),
        ]
    gst = _loan_gl_station_id(loan)
    je = _create_posted_entry(
        company_id,
        d.disbursement_date,
        entry_number,
        je_desc,
        lines,
        gl_station_id=gst,
    )
    if not je:
        return False
    with transaction.atomic():
        LoanDisbursement.objects.filter(pk=d.pk).update(journal_entry_id=je.id)
    return True


def post_loan_repayment(company_id: int, r: LoanRepayment) -> bool:
    """
    Borrowed repayment (pay lender): Dr principal, Dr interest exp, Cr bank.
    Lent collection: Dr bank, Cr principal, Cr interest income.
    """
    loan = r.loan
    if loan.company_id != company_id:
        return False
    total = r.amount or Decimal("0")
    p = r.principal_amount or Decimal("0")
    i = r.interest_amount or Decimal("0")
    if total <= 0:
        return False
    if (p + i - total).copy_abs() > Decimal("0.02"):
        logger.warning("loan repayment %s: principal+interest != amount", r.id)
        return False
    settlement = loan.settlement_account
    principal = loan.principal_account
    interest_acc = loan.interest_account
    if not _coa_ok(company_id, settlement) or not _coa_ok(company_id, principal):
        return False
    if (
        i > 0
        and not _coa_ok(company_id, interest_acc)
        and not _coa_ok(company_id, loan.interest_accrual_account)
    ):
        logger.warning(
            "loan repayment %s: interest > 0 but no interest_account or accrual account", r.id
        )
        return False
    entry_number = f"AUTO-LOAN-PMT-{r.id}"
    base = (r.reference or r.memo or loan.loan_no or "").strip()
    settle_lbl = _coa_label(settlement)
    isl = loan_uses_islamic_terminology(loan)
    je_desc = (
        (
            f"Islamic financing payment {loan.loan_no} — settlement {settle_lbl}"
            if settle_lbl
            else f"Islamic financing payment {loan.loan_no}"
        )
        if isl
        else (
            f"Loan repayment {loan.loan_no} — payment/settlement {settle_lbl}"
            if settle_lbl
            else f"Loan repayment {loan.loan_no}"
        )
    )
    memo_prin = (
        (f"Financing principal · {base}" if base else "Financing principal")
        if isl
        else (f"Principal · {base}" if base else "Principal")
    )[:280]
    memo_int = (
        (f"Profit / return · {base}" if base else "Profit / return")
        if isl
        else (f"Interest · {base}" if base else "Interest")
    )[:280]
    memo_settle = (
        (f"Payment/settlement {settle_lbl} · {base}" if base else f"Payment/settlement {settle_lbl}")
    )[:280]
    if i > 0 and interest_acc:
        validate_loan_interest_entity_tags_for_gl(loan, company_id)
    # Interest already accrued was expensed when it was accrued, so paying it settles the
    # accrued-interest account, not the P&L account. Only interest beyond the accrued balance
    # is a fresh expense (the ordinary case for a loan that never used the accrual feature).
    accrual_acc = loan.interest_accrual_account
    i_settle = Decimal("0")
    i_expense = i
    if i > 0 and _coa_ok(company_id, accrual_acc):
        i_settle = min(i, unsettled_accrued_interest(loan, exclude_repayment_id=r.id))
        i_expense = i - i_settle
    memo_settle_accr = (
        (f"Accrued profit settled · {base}" if base else "Accrued profit settled")
        if isl
        else (f"Accrued interest settled · {base}" if base else "Accrued interest settled")
    )[:280]

    lines: list = []
    if loan.direction == Loan.DIRECTION_BORROWED:
        if p > 0:
            lines.append((principal, p, Decimal("0"), memo_prin))
        if i_settle > 0:
            lines.append((accrual_acc, i_settle, Decimal("0"), memo_settle_accr))
        if i_expense > 0 and interest_acc:
            lines.append((interest_acc, i_expense, Decimal("0"), memo_int))
        lines.append((settlement, Decimal("0"), total, memo_settle))
    else:
        lines.append((settlement, total, Decimal("0"), memo_settle))
        if p > 0:
            lines.append((principal, Decimal("0"), p, memo_prin))
        if i_settle > 0:
            lines.append((accrual_acc, Decimal("0"), i_settle, memo_settle_accr))
        if i_expense > 0 and interest_acc:
            lines.append((interest_acc, Decimal("0"), i_expense, memo_int))
    gst = _loan_gl_station_id(loan)
    je = _create_posted_entry(
        company_id,
        r.repayment_date,
        entry_number,
        je_desc,
        lines,
        gl_station_id=gst,
    )
    if not je:
        return False
    with transaction.atomic():
        LoanRepayment.objects.filter(pk=r.pk).update(journal_entry_id=je.id)
    return True


def reverse_loan_repayment(company_id: int, r: LoanRepayment, reversal_date) -> bool:
    """
    Opposite of post_loan_repayment; restores principal to outstanding and total_repaid_principal.
    """
    loan = r.loan
    if loan.company_id != company_id or r.reversed_at:
        return False
    if not r.journal_entry_id:
        return False
    total = r.amount or Decimal("0")
    p = r.principal_amount or Decimal("0")
    i = r.interest_amount or Decimal("0")
    if total <= 0:
        return False
    if (p + i - total).copy_abs() > Decimal("0.02"):
        logger.warning("loan repayment reverse %s: principal+interest != amount", r.id)
        return False
    settlement = loan.settlement_account
    principal = loan.principal_account
    interest_acc = loan.interest_account
    if not _coa_ok(company_id, settlement) or not _coa_ok(company_id, principal):
        return False
    if i > 0 and not _coa_ok(company_id, interest_acc):
        logger.warning("loan repayment reverse %s: interest > 0 but no interest_account", r.id)
        return False
    entry_number = f"AUTO-LOAN-PMT-REV-{r.id}"
    settle_lbl = _coa_label(settlement)
    base = f"Rev pmt #{r.id} {loan.loan_no}".strip()
    isl = loan_uses_islamic_terminology(loan)
    je_desc = (
        (
            f"Reverse Islamic financing payment {loan.loan_no} — settlement {settle_lbl}"
            if settle_lbl
            else f"Reverse Islamic financing payment {loan.loan_no}"
        )
        if isl
        else (
            f"Reverse loan repayment {loan.loan_no} — payment/settlement {settle_lbl}"
            if settle_lbl
            else f"Reverse loan repayment {loan.loan_no}"
        )
    )
    memo_prin = ((f"Rev financing principal · {base}") if isl else (f"Rev principal · {base}"))[:280]
    memo_int = ((f"Rev profit / return · {base}") if isl else (f"Rev interest · {base}"))[:280]
    memo_settle = (f"Rev payment/settlement {settle_lbl} · {base}")[:280]
    lines: list = []
    if loan.direction == Loan.DIRECTION_BORROWED:
        lines.append((settlement, total, Decimal("0"), memo_settle))
        if p > 0:
            lines.append((principal, Decimal("0"), p, memo_prin))
        if i > 0 and interest_acc:
            lines.append((interest_acc, Decimal("0"), i, memo_int))
    else:
        if p > 0:
            lines.append((principal, p, Decimal("0"), memo_prin))
        if i > 0 and interest_acc:
            lines.append((interest_acc, i, Decimal("0"), memo_int))
        lines.append((settlement, Decimal("0"), total, memo_settle))
    gst = _loan_gl_station_id(loan)
    je = _create_posted_entry(
        company_id,
        reversal_date,
        entry_number,
        je_desc,
        lines,
        gl_station_id=gst,
    )
    if not je:
        return False
    loan.refresh_from_db()
    new_out = (loan.outstanding_principal or Decimal("0")) + p
    new_rp = (loan.total_repaid_principal or Decimal("0")) - p
    if new_rp < Decimal("0"):
        new_rp = Decimal("0")
    st = "closed" if new_out <= Decimal("0.005") else "active"
    with transaction.atomic():
        LoanRepayment.objects.filter(pk=r.pk).update(
            reversed_at=timezone.now(),
            reversal_journal_entry_id=je.id,
        )
        Loan.objects.filter(pk=loan.pk).update(
            outstanding_principal=new_out,
            total_repaid_principal=new_rp,
            status=st,
        )
    return True


def post_loan_interest_accrual(company_id: int, accrual: LoanInterestAccrual) -> bool:
    """
    Borrowed: Dr interest expense, Cr accrued interest payable (liability).
    Lent: Dr accrued interest receivable (asset), Cr interest income.
    """
    loan = accrual.loan
    if loan.company_id != company_id:
        return False
    amt = accrual.amount or Decimal("0")
    if amt <= 0:
        return False
    interest_acc = loan.interest_account
    accrual_acc = loan.interest_accrual_account
    if not _coa_ok(company_id, interest_acc) or not _coa_ok(company_id, accrual_acc):
        logger.warning("loan accrual %s: missing interest or accrual GL", accrual.id)
        return False
    validate_loan_interest_entity_tags_for_gl(loan, company_id)
    memo = (accrual.memo or loan.loan_no or "")[:280]
    entry_number = f"AUTO-LOAN-ACCR-{accrual.id}"
    if loan.direction == Loan.DIRECTION_BORROWED:
        lines = [
            (interest_acc, amt, Decimal("0"), memo),
            (accrual_acc, Decimal("0"), amt, memo),
        ]
    else:
        lines = [
            (accrual_acc, amt, Decimal("0"), memo),
            (interest_acc, Decimal("0"), amt, memo),
        ]
    isl = loan_uses_islamic_terminology(loan)
    gst = _loan_gl_station_id(loan)
    je = _create_posted_entry(
        company_id,
        accrual.accrual_date,
        entry_number,
        (
            f"Islamic profit accrual {loan.loan_no}"
            if isl
            else f"Loan interest accrual {loan.loan_no}"
        ),
        lines,
        gl_station_id=gst,
    )
    if not je:
        return False
    with transaction.atomic():
        LoanInterestAccrual.objects.filter(pk=accrual.pk).update(journal_entry_id=je.id)
    return True


def reverse_loan_interest_accrual(company_id: int, accrual: LoanInterestAccrual, reversal_date) -> bool:
    """Swap debits/credits of the original accrual entry."""
    loan = accrual.loan
    if loan.company_id != company_id or accrual.reversed_at:
        return False
    if not accrual.journal_entry_id:
        return False
    amt = accrual.amount or Decimal("0")
    if amt <= 0:
        return False
    interest_acc = loan.interest_account
    accrual_acc = loan.interest_accrual_account
    if not _coa_ok(company_id, interest_acc) or not _coa_ok(company_id, accrual_acc):
        return False
    memo = f"Rev accrual {accrual.id} {loan.loan_no}"[:280]
    entry_number = f"AUTO-LOAN-ACCR-REV-{accrual.id}"
    if loan.direction == Loan.DIRECTION_BORROWED:
        lines = [
            (interest_acc, Decimal("0"), amt, memo),
            (accrual_acc, amt, Decimal("0"), memo),
        ]
    else:
        lines = [
            (accrual_acc, Decimal("0"), amt, memo),
            (interest_acc, amt, Decimal("0"), memo),
        ]
    isl = loan_uses_islamic_terminology(loan)
    gst = _loan_gl_station_id(loan)
    je = _create_posted_entry(
        company_id,
        reversal_date,
        entry_number,
        (
            f"Reverse Islamic profit accrual {loan.loan_no}"
            if isl
            else f"Reverse loan interest accrual {loan.loan_no}"
        ),
        lines,
        gl_station_id=gst,
    )
    if not je:
        return False
    with transaction.atomic():
        LoanInterestAccrual.objects.filter(pk=accrual.pk).update(
            reversed_at=timezone.now(),
            reversal_journal_entry_id=je.id,
        )
    return True


def resync_loan_gl_station_tags(company_id: int, loan: Loan) -> int:
    """
    Align station_id on auto-posted loan journal headers and lines with the loan's current site.
    Returns the number of journal entries updated.
    """
    from api.models import JournalEntry, JournalEntryLine

    je_ids: set[int] = set()
    for je_id in loan.disbursements.filter(journal_entry_id__isnull=False).values_list(
        "journal_entry_id", flat=True
    ):
        je_ids.add(int(je_id))
    for je_id in loan.repayments.filter(journal_entry_id__isnull=False).values_list(
        "journal_entry_id", flat=True
    ):
        je_ids.add(int(je_id))
    for je_id in loan.interest_accruals.filter(journal_entry_id__isnull=False).values_list(
        "journal_entry_id", flat=True
    ):
        je_ids.add(int(je_id))
    for je_id in loan.interest_accruals.filter(
        reversal_journal_entry_id__isnull=False
    ).values_list("reversal_journal_entry_id", flat=True):
        je_ids.add(int(je_id))

    if not je_ids:
        return 0

    gst = _loan_gl_station_id(loan)
    with transaction.atomic():
        JournalEntry.objects.filter(company_id=company_id, id__in=je_ids).update(station_id=gst)
        JournalEntryLine.objects.filter(
            journal_entry_id__in=je_ids, journal_entry__company_id=company_id
        ).update(station_id=gst)
    return len(je_ids)
