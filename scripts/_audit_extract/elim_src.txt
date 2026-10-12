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

**Realization.** The margin is eliminated only while the fish are still inside the group. Once
the buying pond sells them on to a real customer, that profit is genuinely earned and has to
flow back into consolidated income — otherwise company profit stays understated by the internal
margin for ever, and the 1585 contra keeps writing down biological inventory that is no longer
there.

There is no fish-lot tracking, so "how much of what we bought internally is still swimming" is
an estimate. The convention here is deliberately prudent and monotone: for each buying pond,

    unrealized fraction = min(1, biomass still on hand / biomass bought internally)

While the pond still holds at least as much as it bought internally, none of the margin is
treated as realized. As it sells down past that quantity, the margin is released in proportion.
Erring towards "still unrealized" keeps consolidated profit understated rather than overstated,
which is the direction prudence requires.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

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


def _internal_kg_bought_by_pond(company_id: int, end: date) -> dict[int, Decimal]:
    """Cumulative biomass each pond has bought from another pond, through ``end``."""
    from api.models import AquacultureFishPondTransferLine, AquacultureFishSale

    out: dict[int, Decimal] = {}

    def _add(pond_id, kg):
        if not pond_id:
            return
        out[int(pond_id)] = out.get(int(pond_id), Decimal("0")) + (kg or Decimal("0"))

    # Current path: a pond sells to the buying pond's POS customer. The counterparty lives on
    # the linked invoice, not on the sale row, and the pond it stands for is found either by
    # the explicit internal_pond link or by being that pond's pos_customer.
    from api.models import AquaculturePond

    pond_by_customer: dict[int, int] = {
        int(c): int(p)
        for c, p in AquaculturePond.objects.filter(
            company_id=company_id, pos_customer__isnull=False
        ).values_list("pos_customer_id", "id")
    }
    for cust_id, linked_pond_id, kg in AquacultureFishSale.objects.filter(
        company_id=company_id, sale_date__lte=end, invoice__customer__isnull=False
    ).values_list(
        "invoice__customer_id", "invoice__customer__internal_pond_id", "weight_kg"
    ):
        buyer_pond_id = linked_pond_id or pond_by_customer.get(int(cust_id))
        _add(buyer_pond_id, kg)

    # Retired path: historical inter-pond transfer documents still carry 4245/5245 postings.
    for buyer_pond_id, kg in AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        transfer__transfer_date__lte=end,
    ).values_list("to_pond_id", "weight_kg"):
        _add(buyer_pond_id, kg)

    return out


def _pond_biomass_on_hand_kg(company_id: int, pond_id: int) -> Decimal:
    """Live biomass still in a pond, or zero when it cannot be determined."""
    try:
        from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
    except Exception:  # pragma: no cover - defensive: reporting must not crash on this
        return Decimal("0")
    try:
        rows = compute_fish_stock_position_rows(company_id, pond_id=pond_id)
    except Exception:  # pragma: no cover
        return Decimal("0")
    total = Decimal("0")
    for r in rows or []:
        try:
            total += Decimal(str(r.get("implied_net_weight_kg") or 0))
        except Exception:  # pragma: no cover
            continue
    return max(total, Decimal("0"))


def unrealized_fraction(company_id: int, end: date) -> Decimal:
    """How much of the cumulative internal margin is still inside the group at ``end``.

    Weighted across buying ponds by the biomass each of them bought internally, so a pond that
    bought most of the internally traded fish dominates the answer. Returns 1 (nothing realized)
    when there is nothing to go on, which is the prudent default.
    """
    bought = _internal_kg_bought_by_pond(company_id, end)
    total_bought = sum(bought.values(), Decimal("0"))
    if total_bought <= 0:
        return Decimal("1")
    still_held = Decimal("0")
    for pond_id, kg in bought.items():
        on_hand = _pond_biomass_on_hand_kg(company_id, pond_id)
        still_held += min(kg, on_hand)
    frac = still_held / total_bought
    if frac < 0:
        return Decimal("0")
    if frac > 1:
        return Decimal("1")
    return frac


def cumulative_unrealized_margin(company_id: int, end: date) -> Decimal:
    """The part of the lifetime internal margin that is still locked inside group inventory."""
    gross = _net_credit(company_id, CODE_INTERNAL_REVENUE, None, end) + _net_credit(
        company_id, CODE_INTERNAL_COGS, None, end
    )
    if gross == 0:
        return Decimal("0")
    return (gross * unrealized_fraction(company_id, end)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def internal_trade_elimination(
    company_id: int, *, start: date | None, end: date
) -> dict[str, Decimal]:
    """
    Internal revenue and cost, the margin between them, and how much of it is still unrealized.

    ``start=None`` gives the cumulative position through ``end`` — what the balance sheet needs:
    ``unrealized_margin`` is the part of the lifetime internal margin still sitting inside group
    inventory, which is exactly the 1585 contra.

    Passing a start date gives the movement in that period — what the income statement needs.
    There, ``unrealized_margin`` is the **change** in cumulative unrealized margin over the
    period, because that is the amount consolidated profit must be reduced by:

        NI_consolidated = NI_all − (U(end) − U(start))

    and ``realized_margin`` is the part of this period's internal margin that the buying pond
    has since sold on, which flows back into consolidated income.
    """
    revenue = _net_credit(company_id, CODE_INTERNAL_REVENUE, start, end)
    # COGS is debit-normal, so flip the sign back to a positive cost.
    cogs = -_net_credit(company_id, CODE_INTERNAL_COGS, start, end)
    gross_margin = revenue - cogs

    u_end = cumulative_unrealized_margin(company_id, end)
    if start is None:
        unrealized = u_end
    else:
        u_start = cumulative_unrealized_margin(company_id, start - timedelta(days=1))
        unrealized = u_end - u_start
    return {
        "internal_revenue": revenue,
        "internal_cogs": cogs,
        "gross_margin": gross_margin,
        "unrealized_margin": unrealized,
        "realized_margin": gross_margin - unrealized,
    }


def has_internal_trade(company_id: int, *, end: date) -> bool:
    """Cheap check so statements skip the elimination block entirely when no pond trades."""
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=end,
        account__account_code__in=list(INTERNAL_TRADE_PL_CODES),
    ).exists()
