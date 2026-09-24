"""
Interim pricing for fish moving between ponds: cost per kg plus a fixed margin.

Each pond is run as its own entity / profit centre, so a nursing pond that raises fingerlings
and sells them to a grow-out pond should earn the value it created instead of passing cost
along when operators explicitly reprice (``reprice=True``):

    sale rate per kg = cost per kg + Company.aquaculture_internal_transfer_margin_per_kg

If a historical line has **no sale price**, the default is simpler: **sale = cost**
(``fill_missing_sale_at_cost`` / ``apply_internal_prices_to_transfer`` with ``reprice=False``).
That is what GL sync uses so unpriced moves still invoice at cost.

This applies to **inter-pond trades only**. A genuine sale to an outside customer keeps
whatever that customer actually paid — nothing here touches ``AquacultureFishSale`` pricing
for external harvests.

Set the company margin to 0 when repricing to move fish at cost, which reproduces the old
behaviour exactly.
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


def _sale_at_cost_fields(line: AquacultureFishPondTransferLine) -> tuple[Decimal | None, Decimal, str]:
    """Sale price = book cost (used when no sale price was set)."""
    cost = _money_q(_d(line.cost_amount))
    kg = _d(line.weight_kg)
    if kg > 0 and cost > 0:
        rate = _rate_q(cost / kg)
        basis = f"No sale price set — sold at cost {rate}/kg on {_rate_q(kg)} kg."
    else:
        rate = None
        basis = "No sale price set — sold at cost."
    return rate, cost, basis


def fill_missing_sale_at_cost(transfer) -> int:
    """
    If a line has no sale price, treat cost as the sale price and persist it.

    Existing sale amounts are left alone. Returns how many lines were filled.
    """
    changed = 0
    for line in transfer.lines.all():
        if _money_q(_d(line.sale_amount)) > 0:
            continue
        cost = _money_q(_d(line.cost_amount))
        if cost <= 0:
            continue
        rate, amount, basis = _sale_at_cost_fields(line)
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


def apply_internal_prices_to_transfer(
    company_id: int,
    transfer,
    *,
    reprice: bool = False,
) -> int:
    """
    Ensure every line carries a sale price the buying pond pays.

    - ``reprice=False`` (default): only fill missing/zero ``sale_amount`` — sold **at cost**.
      Lines that already have a sale price are not changed.
    - ``reprice=True``: recompute every line as cost/kg + company inter-pond margin
      (nursing reconcile, convert-to-documents, new trade UI).

    Call after line costs are settled and before GL sync. Returns how many lines changed.
    """
    if not reprice:
        return fill_missing_sale_at_cost(transfer)

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
