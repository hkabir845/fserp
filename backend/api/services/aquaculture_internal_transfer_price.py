"""
Interim pricing for fish moving between ponds: cost per kg plus a fixed margin.

Each pond is run as its own profit centre, so a nursing pond that raises fingerlings and hands
them to a grow-out pond should earn the value it created instead of passing its cost along. Until
live market rates are trusted (``aquaculture_transfer_price.resolve_market_rate_per_kg`` is the
target for that), the internal price is simply:

    sale rate per kg = cost per kg + Company.aquaculture_internal_transfer_margin_per_kg

so a line costing 100/kg sells to the buying pond at 120/kg with the default margin of 20.

This applies to **inter-pond transfers only**. A genuine sale to an outside customer keeps
whatever that customer actually paid — nothing here touches ``AquacultureFishSale``.

Set the company margin to 0 to move fish at cost, which reproduces the old behaviour exactly.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from api.models import AquacultureFishPondTransferLine, Company

DEFAULT_INTERNAL_MARGIN_PER_KG = Decimal("20")


def _d(value) -> Decimal:
    if value is None or (isinstance(value, str) and not str(value).strip()):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _rate_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def internal_transfer_margin_per_kg(company_id: int) -> Decimal:
    """The company's inter-pond margin per kg; never negative."""
    raw = (
        Company.objects.filter(pk=company_id)
        .values_list("aquaculture_internal_transfer_margin_per_kg", flat=True)
        .first()
    )
    if raw is None:
        return DEFAULT_INTERNAL_MARGIN_PER_KG
    margin = _d(raw)
    return margin if margin > 0 else Decimal("0")


def quote_internal_transfer_line(
    company_id: int,
    *,
    cost_amount,
    weight_kg,
    override_rate_per_kg=None,
) -> tuple[Decimal | None, Decimal, str]:
    """
    Price one transfer line. Returns (rate_per_kg, sale_amount, basis_note).

    ``override_rate_per_kg`` wins when given, so an operator can always overrule the rule and the
    basis note records that they did. With no weight there is nothing to price and the line falls
    back to its cost.
    """
    kg = _d(weight_kg)
    cost = _money_q(_d(cost_amount))
    if kg <= 0:
        return None, cost, "No weight on this line — moved at cost."

    override = _d(override_rate_per_kg) if override_rate_per_kg is not None else Decimal("0")
    if override > 0:
        rate = _rate_q(override)
        amount = _money_q(rate * kg)
        return rate, amount, f"Rate {rate}/kg entered by hand; company margin not applied."

    margin = internal_transfer_margin_per_kg(company_id)
    cost_per_kg = _rate_q(cost / kg) if cost > 0 else Decimal("0")
    rate = _rate_q(cost_per_kg + margin)
    if rate <= 0:
        return None, cost, "No cost and no margin — moved at cost."

    amount = _money_q(rate * kg)
    if cost > 0:
        basis = (
            f"Cost {cost_per_kg}/kg + inter-pond margin {_rate_q(margin)}/kg = {rate}/kg "
            f"on {_rate_q(kg)} kg."
        )
    else:
        basis = (
            f"No book cost on this line yet; priced at the inter-pond margin alone "
            f"({_rate_q(margin)}/kg) on {_rate_q(kg)} kg."
        )
    return rate, amount, basis


def apply_internal_prices_to_transfer(company_id: int, transfer) -> int:
    """
    (Re)price every line of a transfer from its current ``cost_amount``.

    Call after the line costs are settled (``resync_nursing_pond_transfer_costs``) and before the
    GL sync, so the journal posts the price the buying pond actually pays. Returns how many lines
    changed.
    """
    changed = 0
    for line in transfer.lines.all():
        rate, amount, basis = quote_internal_transfer_line(
            company_id,
            cost_amount=line.cost_amount,
            weight_kg=line.weight_kg,
        )
        if (
            line.sale_rate_per_kg == rate
            and _money_q(_d(line.sale_amount)) == _money_q(amount)
            and (line.price_basis or "") == basis
        ):
            continue
        AquacultureFishPondTransferLine.objects.filter(pk=line.pk).update(
            sale_rate_per_kg=rate,
            sale_amount=amount,
            price_basis=basis[:2000],
        )
        line.sale_rate_per_kg = rate
        line.sale_amount = amount
        line.price_basis = basis
        changed += 1
    return changed


def transfer_margin_total(transfer) -> Decimal:
    """Margin the selling pond earns across this transfer: sale value less cost moved."""
    total = Decimal("0")
    for line in transfer.lines.all():
        total += _money_q(_d(line.sale_amount)) - _money_q(_d(line.cost_amount))
    return _money_q(total)
