"""Move one year's profit into retained earnings.

Income and expense stay in Σ-P&L until this close. Typing that same profit into
3100.opening_balance counts it a second time. When the opening matches the profit
being closed, the opening is cleared and the closing journal is the only copy.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.exceptions import GlPostingError
from api.models import ChartOfAccount, FiscalYearClose, JournalEntryLine
from api.services.gl_posting import _create_posted_entry, _ensure_core_posting_account
from api.services.reporting import _pl_amount_from_movement, _pl_bucket

CODE_RETAINED = "3100"


def _money(value: Decimal) -> Decimal:
    return (value or Decimal("0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _year_movement(company_id: int, account_id: int, start: date, end: date) -> tuple[Decimal, Decimal]:
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
        account_id=account_id,
    ).aggregate(
        td=Coalesce(Sum("debit"), Decimal("0")),
        tc=Coalesce(Sum("credit"), Decimal("0")),
    )
    return agg["td"], agg["tc"]


@transaction.atomic
def close_fiscal_year(company_id: int, fiscal_year: int) -> FiscalYearClose:
    if fiscal_year < 1900 or fiscal_year > 2500:
        raise GlPostingError("Fiscal year is out of range.")
    existing = FiscalYearClose.objects.filter(
        company_id=company_id, fiscal_year=fiscal_year
    ).first()
    if existing and existing.journal_entry_id:
        return existing

    start = date(fiscal_year, 1, 1)
    end = date(fiscal_year, 12, 31)
    retained = _ensure_core_posting_account(company_id, CODE_RETAINED)
    if retained is None:
        from api.models import ChartOfAccount as COA

        retained = COA.objects.create(
            company_id=company_id,
            account_code=CODE_RETAINED,
            account_name="Retained Earnings",
            account_type="equity",
            account_sub_type="retained_earnings",
            is_active=True,
        )

    lines: list[tuple] = []
    net = Decimal("0")
    for coa in ChartOfAccount.objects.filter(company_id=company_id).order_by("account_code"):
        bucket = _pl_bucket(coa)
        if bucket is None:
            continue
        debit, credit = _year_movement(company_id, coa.id, start, end)
        bal = _money(_pl_amount_from_movement(coa, debit, credit))
        if bal == 0:
            continue
        if bucket == "income":
            lines.append((coa, bal, Decimal("0"), f"Close {fiscal_year} {coa.account_code}"))
            net += bal
        else:
            lines.append((coa, Decimal("0"), bal, f"Close {fiscal_year} {coa.account_code}"))
            net -= bal
    net = _money(net)
    if not lines:
        raise GlPostingError(f"No profit or loss to close for {fiscal_year}.")
    if net > 0:
        lines.append((retained, Decimal("0"), net, f"Net income {fiscal_year} to retained earnings"))
    elif net < 0:
        lines.append((retained, -net, Decimal("0"), f"Net loss {fiscal_year} to retained earnings"))
    else:
        # Income and expense cancel. The closing lines already zero the P&L accounts.
        pass

    absorbed = Decimal("0")
    opening = _money(retained.opening_balance or Decimal("0"))
    if opening != 0 and abs(opening - net) <= Decimal("0.02"):
        absorbed = opening
        retained.opening_balance = Decimal("0")
        retained.save(update_fields=["opening_balance"])

    je = _create_posted_entry(
        company_id,
        end,
        f"AUTO-CLOSE-{fiscal_year}",
        f"Year-end close {fiscal_year} to retained earnings",
        lines,
    )
    if je is None:
        raise GlPostingError("Year-end close journal did not post.")
    row, _created = FiscalYearClose.objects.update_or_create(
        company_id=company_id,
        fiscal_year=fiscal_year,
        defaults={
            "close_date": end,
            "net_income": net,
            "opening_absorbed": absorbed,
            "journal_entry_id": je.id,
        },
    )
    return row
