"""
Market rate per kg for fish moving between ponds.

Ponds trade with each other at market rate, so the selling pond earns the margin it created
rather than passing cost along. The rate must come from *arm's-length* sales only: internal
pond-to-pond invoices are excluded, otherwise each season's internal price would feed on the
last one and drift away from what the fish are actually worth.

Every resolved rate carries a basis note naming the sales it came from, so a transfer price is
always explainable to whoever signs off on it.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.models import AquacultureFishSale, AquaculturePond

# How far back an external sale still counts as "market".
MARKET_RATE_LOOKBACK_DAYS = 90

# Income types that represent a genuine sale of fish (not scrap, feed, or service revenue).
_FISH_SALE_INCOME_TYPES: tuple[str, ...] = (
    "fish_harvest_sale",
    "fingerling_sale",
    "processing_value_add",
)


def _q4(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _internal_customer_ids(company_id: int) -> list[int]:
    """POS customers standing for a pond — their invoices are internal, not market evidence."""
    from api.models import Customer

    return list(
        Customer.objects.filter(company_id=company_id, is_internal=True).values_list(
            "id", flat=True
        )
    )


def _external_fish_sales(company_id: int, *, start: date, end: date):
    """Real outside fish sales in the window, excluding anything billed to an internal party."""
    qs = AquacultureFishSale.objects.filter(
        company_id=company_id,
        sale_date__gte=start,
        sale_date__lte=end,
        weight_kg__gt=0,
        total_amount__gt=0,
        income_type__in=_FISH_SALE_INCOME_TYPES,
    )
    internal_ids = _internal_customer_ids(company_id)
    if internal_ids:
        qs = qs.exclude(invoice__customer_id__in=internal_ids)
    return qs


def _weighted_rate(qs) -> tuple[Decimal | None, Decimal, int]:
    """Weighted average price per kg over a queryset of sales: total value / total weight."""
    agg = qs.aggregate(
        w=Coalesce(Sum("weight_kg"), Decimal("0")),
        v=Coalesce(Sum("total_amount"), Decimal("0")),
    )
    weight = _d(agg["w"])
    value = _d(agg["v"])
    count = qs.count()
    if weight <= 0 or value <= 0:
        return None, weight, count
    return _q4(value / weight), weight, count


def resolve_market_rate_per_kg(
    company_id: int,
    *,
    species: str,
    as_of: date,
    lookback_days: int = MARKET_RATE_LOOKBACK_DAYS,
) -> tuple[Decimal | None, str]:
    """
    Best available market rate per kg for a species, as of a date.

    Widens the search in steps and says which step produced the number:
      1. same species, recent external sales
      2. same species, any date
      3. any species, recent external sales
    Returns (rate_or_None, basis_note). A None rate means there is no arm's-length evidence yet —
    the caller must ask the user for a price rather than invent one.
    """
    start = as_of - timedelta(days=lookback_days)
    sp = (species or "").strip()

    if sp:
        rate, weight, n = _weighted_rate(
            _external_fish_sales(company_id, start=start, end=as_of).filter(fish_species=sp)
        )
        if rate is not None:
            return rate, (
                f"Weighted average of {n} external {sp} sale(s) totalling {_q4(weight)} kg "
                f"in the {lookback_days} days to {as_of.isoformat()}."
            )

        rate, weight, n = _weighted_rate(
            _external_fish_sales(company_id, start=date(1900, 1, 1), end=as_of).filter(
                fish_species=sp
            )
        )
        if rate is not None:
            return rate, (
                f"No {sp} sale in the last {lookback_days} days; weighted average of all {n} "
                f"external {sp} sale(s) on or before {as_of.isoformat()} ({_q4(weight)} kg)."
            )

    rate, weight, n = _weighted_rate(
        _external_fish_sales(company_id, start=start, end=as_of)
    )
    if rate is not None:
        return rate, (
            f"No {sp or 'matching'} species history; weighted average of {n} external fish sale(s) "
            f"of all species in the {lookback_days} days to {as_of.isoformat()} ({_q4(weight)} kg)."
        )

    return None, (
        "No arm's-length fish sale on record to price against — enter the rate per kg manually."
    )


def quote_inter_pond_transfer(
    company_id: int,
    *,
    from_pond_id: int,
    species: str,
    as_of: date,
    weight_kg: Decimal,
    override_rate_per_kg: Decimal | None = None,
) -> dict:
    """
    Price one inter-pond movement. Returns the rate, the resulting amount, and how it was derived.

    ``override_rate_per_kg`` wins when supplied, so an operator can always overrule the
    computed market rate — the basis note records that they did.
    """
    w = _d(weight_kg)
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).first()
    pond_name = (pond.name or "").strip() if pond else f"Pond #{from_pond_id}"

    if override_rate_per_kg is not None and _d(override_rate_per_kg) > 0:
        rate = _q4(_d(override_rate_per_kg))
        basis = "Rate entered manually; market rate not applied."
        source = "manual"
    else:
        rate, basis = resolve_market_rate_per_kg(
            company_id, species=species, as_of=as_of
        )
        source = "market" if rate is not None else "unavailable"

    amount = (
        (rate * w).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if rate is not None and w > 0
        else Decimal("0.00")
    )
    return {
        "from_pond_id": from_pond_id,
        "from_pond_name": pond_name,
        "species": (species or "").strip(),
        "as_of": as_of.isoformat(),
        "weight_kg": str(_q4(w)),
        "rate_per_kg": str(rate) if rate is not None else None,
        "amount": str(amount),
        "rate_source": source,
        "basis_note": basis,
        "priceable": rate is not None,
    }
