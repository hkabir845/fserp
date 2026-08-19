"""
Canonical rounding for FSERP.

Standard business/accounting rule: **money is carried and reported to 2 decimal places,
rounded half away from zero** (ROUND_HALF_UP). Python's Decimal default is ROUND_HALF_EVEN
("banker's rounding"), which rounds 0.005 to 0.00 and 0.015 to 0.02 — legal in some
statistical contexts but not what an invoice, a bill, or a ledger is expected to do, and
not what the frontend (JavaScript toFixed) does. Mixing the two makes the same amount round
differently depending on which code path produced it, which shows up as one-paisa GL
differences that never reconcile.

Use :func:`money` for every currency amount that is stored, posted, or displayed.

Physical measures are deliberately NOT money:

* ``qty``  — stock/document quantities, 2 dp (matches DecimalField display and the UI).
* ``weight`` — kilograms carried at 4 dp; a sack or a harvest lot needs gram resolution.
* ``unit_rate`` — per-unit costs/prices carried at 4 dp *internally* so that
  rate x quantity does not accumulate error; the resulting amount is then ``money()``-ed.
* ``avg_weight`` — kg per fish at 6 dp; a fingerling weighs ~0.0003 kg, so rounding this
  to 2 dp would zero out the entire biomass model.

Round the product, never the rate: ``money(unit_rate(r) * qty(q))``.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

TWO = Decimal("0.01")
FOUR = Decimal("0.0001")
SIX = Decimal("0.000001")
ONE = Decimal("1")

ZERO_MONEY = Decimal("0.00")


def to_decimal(value, default: Decimal = Decimal("0")) -> Decimal:
    """Coerce anything sane (str/int/float/Decimal/None) to Decimal without raising."""
    if value is None or value == "":
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def money(value, default: Decimal = Decimal("0")) -> Decimal:
    """A currency amount: 2 decimal places, half away from zero."""
    try:
        return to_decimal(value, default).quantize(TWO, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return ZERO_MONEY


def money_str(value, default: Decimal = Decimal("0")) -> str:
    """A currency amount as a JSON string, always with exactly 2 decimals."""
    return str(money(value, default))


def qty(value, default: Decimal = Decimal("0")) -> Decimal:
    """A document / stock quantity: 2 decimal places, half away from zero."""
    try:
        return to_decimal(value, default).quantize(TWO, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.00")


def weight(value, default: Decimal = Decimal("0")) -> Decimal:
    """A weight in kg: 4 decimal places (gram resolution)."""
    try:
        return to_decimal(value, default).quantize(FOUR, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.0000")


def unit_rate(value, default: Decimal = Decimal("0")) -> Decimal:
    """A per-unit cost or price carried at 4 dp so rate x quantity does not drift."""
    try:
        return to_decimal(value, default).quantize(FOUR, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.0000")


def avg_weight(value, default: Decimal = Decimal("0")) -> Decimal:
    """Average weight per fish in kg: 6 dp — fingerlings are fractions of a gram."""
    try:
        return to_decimal(value, default).quantize(SIX, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.000000")


def whole(value, default: Decimal = Decimal("0")) -> Decimal:
    """A countable whole number (head count, sacks) as a Decimal, half away from zero."""
    try:
        return to_decimal(value, default).quantize(ONE, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0")


def allocate(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """
    Split ``total`` across ``weights`` so the parts are 2 dp and sum EXACTLY to ``total``.

    The largest-remainder residual lands on the last non-zero part, which is the standard
    way to keep an allocation (cost split, tax split, pond share) from losing or inventing
    a paisa. Returns a list the same length as ``weights``.
    """
    total = money(total)
    ws = [to_decimal(w) for w in weights]
    denom = sum(ws)
    n = len(ws)
    if n == 0:
        return []
    if denom == 0:
        # Nothing to weight by: put it all on the first slot rather than dropping it.
        out = [ZERO_MONEY] * n
        out[0] = total
        return out
    parts: list[Decimal] = []
    running = Decimal("0")
    last_idx = max(i for i, w in enumerate(ws) if w != 0)
    for i, w in enumerate(ws):
        if i == last_idx:
            parts.append(money(total - running))
        else:
            p = money(total * w / denom) if w != 0 else ZERO_MONEY
            running += p
            parts.append(p)
    return parts
