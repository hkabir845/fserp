"""Fuel meter reading advance with optional rollover at max_reading."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import F

from api.models import Meter


def meter_quantity_from_readings(
    previous: Decimal,
    current: Decimal,
    *,
    max_reading: Decimal | None,
) -> Decimal:
    """
    Volume sold between two meter snapshots.

    When ``max_reading`` is set and ``current < previous``, treat the meter as having
    wrapped past the maximum (mechanical/electronic rollover).
    """
    prev = Decimal(previous)
    cur = Decimal(current)
    if cur >= prev:
        return cur - prev
    max_r = Decimal(max_reading) if max_reading is not None else None
    if max_r is None or max_r <= 0:
        # No rollover configured: negative delta is invalid input.
        return cur - prev
    # Inclusive wrap: reading goes … max_r → 0 → …
    return (max_r - prev) + cur + Decimal("1")


@transaction.atomic
def advance_meter_by_quantity(meter_id: int, quantity: Decimal) -> None:
    """
    Add ``quantity`` to ``Meter.current_reading``, wrapping at ``max_reading`` when set.

    Uses a single UPDATE so concurrent POS sales do not lose increments.
    """
    qty = Decimal(quantity)
    if qty == 0:
        return
    m = Meter.objects.select_for_update().filter(pk=meter_id).only("id", "current_reading", "max_reading").first()
    if not m:
        return
    max_r = m.max_reading
    if max_r is None or max_r <= 0:
        Meter.objects.filter(pk=meter_id).update(current_reading=F("current_reading") + qty)
        return
    # Compute wrap in Python then write absolute value (still under row lock in caller TX).
    new_val = Decimal(m.current_reading or 0) + qty
    span = Decimal(max_r) + Decimal("1")
    new_val = ((new_val % span) + span) % span
    Meter.objects.filter(pk=meter_id).update(current_reading=new_val)
