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

from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import Coalesce

from api.models import AquacultureFishSale, AquaculturePond

# How far back an external sale still counts as "market".
MARKET_RATE_LOOKBACK_DAYS = 90

# A sale prices fish of a comparable size when its average weight per fish is within this
# fraction of the movement's. Fingerlings and table fish are both "tilapia" and nowhere near
# the same price per kg, so size is a stronger match than species.
SIZE_BAND_TOLERANCE = Decimal("0.40")

# No channel marker exists on fish sales, so lot size stands in for wholesale: a lot at or
# above this weight is a bulk sale, not a retail one. Replace with an explicit sale_channel
# field when one is added.
WHOLESALE_MIN_LOT_KG = Decimal("50")

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


def _wholesale_only(qs):
    """Bulk lots only — retail-sized sales carry a different price per kg."""
    return qs.filter(weight_kg__gte=WHOLESALE_MIN_LOT_KG)


def _same_size_band(qs, size_kg_per_fish: Decimal | None):
    """Sales whose average fish weight is within SIZE_BAND_TOLERANCE of the movement's."""
    if size_kg_per_fish is None or size_kg_per_fish <= 0:
        return None
    lo = size_kg_per_fish * (Decimal("1") - SIZE_BAND_TOLERANCE)
    hi = size_kg_per_fish * (Decimal("1") + SIZE_BAND_TOLERANCE)
    return (
        qs.filter(fish_count__isnull=False, fish_count__gt=0)
        .annotate(
            avg_size_kg=ExpressionWrapper(
                F("weight_kg") / F("fish_count"),
                output_field=DecimalField(max_digits=20, decimal_places=8),
            )
        )
        .filter(avg_size_kg__gte=lo, avg_size_kg__lte=hi)
    )


def size_label(size_kg_per_fish: Decimal | None) -> str:
    """Readable size for basis notes: grams under a kilo, kilos above."""
    if size_kg_per_fish is None or size_kg_per_fish <= 0:
        return "unknown size"
    if size_kg_per_fish < Decimal("1"):
        grams = (size_kg_per_fish * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return f"~{grams} g/fish"
    return f"~{_q4(size_kg_per_fish).normalize()} kg/fish"


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
    size_kg_per_fish: Decimal | None = None,
    lookback_days: int = MARKET_RATE_LOOKBACK_DAYS,
) -> tuple[Decimal | None, str]:
    """
    Best available market rate per kg, as of a date, for fish of a given species and size.

    Matching narrows on three things — species, size band, and wholesale lots — and gives up
    the least important first. Size outranks species: comparable fish sold in bulk are better
    evidence than the same species at a different stage of growth.

      1. same species · same size band · wholesale lots
      2. same species · same size band · any lot size
      3. same species · any size · wholesale lots
      4. same species · any size · any lot, any date
      5. any species · same size band · wholesale lots
      6. any species · recent wholesale lots

    Returns (rate_or_None, basis_note). A None rate means there is no arm's-length evidence —
    the caller must ask for a price rather than invent one.
    """
    start = as_of - timedelta(days=lookback_days)
    sp = (species or "").strip()
    size = _d(size_kg_per_fish) if size_kg_per_fish is not None else None
    if size is not None and size <= 0:
        size = None
    sized = size_label(size)
    recent = _external_fish_sales(company_id, start=start, end=as_of)
    window = f"the {lookback_days} days to {as_of.isoformat()}"

    def _hit(qs, label: str) -> tuple[Decimal | None, str]:
        if qs is None:
            return None, ""
        rate, weight, n = _weighted_rate(qs)
        if rate is None:
            return None, ""
        return rate, f"{label} — {n} sale(s), {_q4(weight)} kg."

    if sp:
        species_recent = recent.filter(fish_species=sp)
        banded = _same_size_band(species_recent, size)

        rate, note = _hit(
            _wholesale_only(banded) if banded is not None else None,
            f"Wholesale {sp} at {sized} in {window}",
        )
        if rate is not None:
            return rate, note

        rate, note = _hit(banded, f"{sp} at {sized} in {window}, any lot size")
        if rate is not None:
            return rate, note

        rate, note = _hit(
            _wholesale_only(species_recent), f"Wholesale {sp} of any size in {window}"
        )
        if rate is not None:
            return rate, note

        rate, note = _hit(
            _external_fish_sales(company_id, start=date(1900, 1, 1), end=as_of).filter(
                fish_species=sp
            ),
            f"No recent match; all {sp} sales on or before {as_of.isoformat()}",
        )
        if rate is not None:
            return rate, note

    banded_any = _same_size_band(recent, size)
    rate, note = _hit(
        _wholesale_only(banded_any) if banded_any is not None else None,
        f"No {sp or 'species'} history; wholesale fish at {sized} in {window}",
    )
    if rate is not None:
        return rate, note

    rate, note = _hit(
        _wholesale_only(recent), f"No species or size match; wholesale fish of any size in {window}"
    )
    if rate is not None:
        return rate, note

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
    fish_count: int | None = None,
    override_rate_per_kg: Decimal | None = None,
) -> dict:
    """
    Price one inter-pond movement. Returns the rate, the resulting amount, and how it was derived.

    ``override_rate_per_kg`` wins when supplied, so an operator can always overrule the
    computed market rate — the basis note records that they did.
    """
    w = _d(weight_kg)
    size = (
        _d(weight_kg) / Decimal(str(fish_count))
        if fish_count and int(fish_count) > 0 and w > 0
        else None
    )
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).first()
    pond_name = (pond.name or "").strip() if pond else f"Pond #{from_pond_id}"

    if override_rate_per_kg is not None and _d(override_rate_per_kg) > 0:
        rate = _q4(_d(override_rate_per_kg))
        basis = "Rate entered manually; market rate not applied."
        source = "manual"
    else:
        rate, basis = resolve_market_rate_per_kg(
            company_id, species=species, as_of=as_of, size_kg_per_fish=size
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
        "fish_count": int(fish_count) if fish_count else None,
        "size_kg_per_fish": str(_q4(size)) if size is not None else None,
        "size_label": size_label(size),
        "rate_per_kg": str(rate) if rate is not None else None,
        "amount": str(amount),
        "rate_source": source,
        "basis_note": basis,
        "priceable": rate is not None,
    }
