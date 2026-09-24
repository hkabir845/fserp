"""Match a bank or cash statement to posted ledger lines on that account."""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.exceptions import GlPostingError
from api.models import BankStatement, BankStatementLine, ChartOfAccount, JournalEntryLine
from api.services.coa_constants import is_cash_or_bank_account
from api.services.reporting import _ending_balance


def _money(value) -> Decimal:
    return (Decimal(str(value or "0"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _line_signed(ln: JournalEntryLine) -> Decimal:
    return _money((ln.debit or Decimal("0")) - (ln.credit or Decimal("0")))


@transaction.atomic
def create_bank_statement(
    company_id: int,
    account_id: int,
    statement_date,
    ending_balance,
    lines: list[dict],
) -> BankStatement:
    account = ChartOfAccount.objects.filter(pk=account_id, company_id=company_id).first()
    if account is None:
        raise GlPostingError("Bank account not found.")
    if not is_cash_or_bank_account(
        account.account_type, account.account_sub_type, account.account_code
    ):
        raise GlPostingError("Reconciliation is only for a cash or bank account.")
    stmt = BankStatement.objects.create(
        company_id=company_id,
        account=account,
        statement_date=statement_date,
        ending_balance=_money(ending_balance),
    )
    rows = []
    for raw in lines:
        rows.append(
            BankStatementLine(
                statement=stmt,
                line_date=raw["line_date"],
                description=(raw.get("description") or "")[:300],
                amount=_money(raw.get("amount")),
            )
        )
    if rows:
        BankStatementLine.objects.bulk_create(rows)
    auto_match_statement(stmt)
    return stmt


def auto_match_statement(stmt: BankStatement) -> int:
    """Match statement lines to unmatched ledger lines by amount and a nearby date."""
    matched = 0
    used: set[int] = set(
        BankStatementLine.objects.filter(
            statement__company_id=stmt.company_id,
            statement__account_id=stmt.account_id,
            matched_journal_line_id__isnull=False,
        ).values_list("matched_journal_line_id", flat=True)
    )
    open_lines = list(
        stmt.lines.filter(matched_journal_line_id__isnull=True).order_by("line_date", "id")
    )
    candidates = list(
        JournalEntryLine.objects.filter(
            account_id=stmt.account_id,
            journal_entry__company_id=stmt.company_id,
            journal_entry__is_posted=True,
            journal_entry__entry_date__lte=stmt.statement_date,
        )
        .select_related("journal_entry")
        .order_by("journal_entry__entry_date", "id")
    )
    for row in open_lines:
        window_start = row.line_date - timedelta(days=3)
        window_end = row.line_date + timedelta(days=3)
        hit = None
        for cand in candidates:
            if cand.id in used:
                continue
            posted = cand.journal_entry.entry_date
            if posted < window_start or posted > window_end:
                continue
            if _line_signed(cand) == row.amount:
                hit = cand
                break
        if hit is None:
            continue
        row.matched_journal_line_id = hit.id
        row.save(update_fields=["matched_journal_line"])
        used.add(hit.id)
        matched += 1
    return matched


def reconciliation_report(stmt: BankStatement) -> dict:
    gl_balance = _ending_balance(stmt.account, stmt.company_id, stmt.statement_date)
    lines = list(stmt.lines.all())
    unmatched_stmt = [ln for ln in lines if ln.matched_journal_line_id is None]
    matched_ids = {ln.matched_journal_line_id for ln in lines if ln.matched_journal_line_id}
    gl_lines = JournalEntryLine.objects.filter(
        account_id=stmt.account_id,
        journal_entry__company_id=stmt.company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=stmt.statement_date,
    ).select_related("journal_entry")
    unmatched_gl = [ln for ln in gl_lines if ln.id not in matched_ids]
    statement_total = _money(stmt.ending_balance)
    difference = _money(statement_total - gl_balance)
    return {
        "statement_id": stmt.id,
        "account_id": stmt.account_id,
        "account_code": stmt.account.account_code,
        "statement_date": stmt.statement_date.isoformat(),
        "statement_ending_balance": str(statement_total),
        "gl_balance": str(_money(gl_balance)),
        "difference": str(difference),
        "matched_count": len(lines) - len(unmatched_stmt),
        "unmatched_statement_lines": [
            {
                "id": ln.id,
                "line_date": ln.line_date.isoformat(),
                "description": ln.description,
                "amount": str(ln.amount),
            }
            for ln in unmatched_stmt
        ],
        "unmatched_ledger_lines": [
            {
                "journal_line_id": ln.id,
                "entry_date": ln.journal_entry.entry_date.isoformat(),
                "entry_number": ln.journal_entry.entry_number,
                "amount": str(_line_signed(ln)),
                "description": ln.description,
            }
            for ln in unmatched_gl
        ],
    }


def gl_cash_movement(company_id: int, account_id: int, as_of) -> Decimal:
    agg = JournalEntryLine.objects.filter(
        account_id=account_id,
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=as_of,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    return _money((agg["td"] or Decimal("0")) - (agg["tc"] or Decimal("0")))
