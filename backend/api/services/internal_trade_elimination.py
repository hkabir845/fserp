"""
Consolidation elimination for inter-pond fish trade.

When one pond sells fish to another, the selling pond books revenue (4245) and its cost of sales
(5245), and the buying pond capitalizes what it paid into 1581. Both ponds are right: each is run
as its own profit centre. The *company* is not - nothing left the business, so consolidated revenue
must exclude the internal sale, and the margin the selling pond earned is still sitting unsold
inside the buying pond's biological inventory.

The elimination entry is:

    Dr 4245  internal revenue            (remove the sale)
      Cr 5245  internal cost of sales    (remove the cost)
      Cr 1585  unrealized margin in biological inventory   (the difference)

so company net income falls by exactly the unrealized margin, and biological inventory is written
down by the same amount through the 1585 contra. Assets and equity move together and the balance
sheet still balances.

This is applied at company scope only. Pond-scoped and site-scoped statements keep the internal
amounts, because from a single pond's point of view the sale genuinely happened.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.models import JournalEntryLine

# Internal trade pair seeded by api.services.aquaculture_coa_seed.
CODE_INTERNAL_REVENUE = "4245"
CODE_INTERNAL_COGS = "5245"
CODE_UNREALIZED_MARGIN = "1585"

INTERNAL_TRADE_PL_CODES: frozenset[str] = frozenset(
    {CODE_INTERNAL_REVENUE, CODE_INTERNAL_COGS}
)


def _net_credit(company_id: int, code: str, start: date | None, end: date) -> Decimal:
    """Credit-minus-debit movement on one account (revenue-style sign)."""
    qs = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=end,
        account__account_code=code,
    )
    if start is not None:
        qs = qs.filter(journal_entry__entry_date__gte=start)
    agg = qs.aggregate(
        d=Coalesce(Sum("debit"), Decimal("0")),
        c=Coalesce(Sum("credit"), Decimal("0")),
    )
    return (agg["c"] or Decimal("0")) - (agg["d"] or Decimal("0"))


def internal_trade_elimination(
    company_id: int, *, start: date | None, end: date
) -> dict[str, Decimal]:
    """
    Internal revenue, internal cost and the unrealized margin between them.

    ``start=None`` gives the cumulative position through ``end`` (what the balance sheet needs);
    passing a start date gives the movement in that period (what the income statement needs).
    """
    revenue = _net_credit(company_id, CODE_INTERNAL_REVENUE, start, end)
    # COGS is debit-normal, so flip the sign back to a positive cost.
    cogs = -_net_credit(company_id, CODE_INTERNAL_COGS, start, end)
    return {
        "internal_revenue": revenue,
        "internal_cogs": cogs,
        "unrealized_margin": revenue - cogs,
    }


def has_internal_trade(company_id: int, *, end: date) -> bool:
    """Cheap check so statements skip the elimination block entirely when no pond trades."""
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=end,
        account__account_code__in=list(INTERNAL_TRADE_PL_CODES),
    ).exists()
