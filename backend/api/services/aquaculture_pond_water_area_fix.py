"""Correct pond water areas that were stored with one extra trailing zero (×10).

Live Adib rows (2026-09): Digonto Pond 4000→400, Ashari-2 13200→1320,
Mynuddin Nursing 8000→800. Leasing area was already right, so this is not an
acre↔decimal conversion — just an extra 0 on water_area_decimal.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from api.services.aquaculture_units import quantize_pond_area_decimal

# Normalized pond name (hyphens/spaces collapsed) → correct Bangladesh water decimals.
# Exact name match only — "Mynuddin Nursing Pond - 2" must not take the 800 figure.
CANONICAL_WATER_AREA_BY_NAME: dict[str, Decimal] = {
    "digonta": Decimal("400.00"),
    "digonto": Decimal("400.00"),
    "digonta pond": Decimal("400.00"),
    "digonto pond": Decimal("400.00"),
    "ashari 2": Decimal("1320.00"),
    "ashari 2 pond": Decimal("1320.00"),
    "mynuddin nursing": Decimal("800.00"),
    "mynuddin nursing pond": Decimal("800.00"),
}

_EXTRA_ZERO = Decimal("10")


def normalize_pond_area_name(name: str | None) -> str:
    raw = (name or "").replace("-", " ").replace("_", " ").strip().lower()
    return " ".join(raw.split())


def canonical_water_area_decimal(name: str | None) -> Decimal | None:
    key = normalize_pond_area_name(name)
    target = CANONICAL_WATER_AREA_BY_NAME.get(key)
    return quantize_pond_area_decimal(target) if target is not None else None


def is_extra_zero_water_area(current: Decimal | None, target: Decimal | None) -> bool:
    """True when stored water is exactly 10× the known-correct decimal area."""
    if current is None or target is None or target <= 0:
        return False
    cur = quantize_pond_area_decimal(current)
    tgt = quantize_pond_area_decimal(target)
    if cur is None or tgt is None:
        return False
    return cur == quantize_pond_area_decimal(tgt * _EXTRA_ZERO)


def apply_extra_zero_water_area_corrections(*, company_id: int | None = None) -> list[dict]:
    """
    Set water_area_decimal to the canonical value when the row still has the extra zero.

    Idempotent: already-correct rows are left alone. Returns one dict per update.
    """
    from api.models import AquaculturePond

    qs = AquaculturePond.objects.all().order_by("id")
    if company_id is not None:
        qs = qs.filter(company_id=company_id)

    updated: list[dict] = []
    with transaction.atomic():
        for pond in qs.select_for_update():
            target = canonical_water_area_decimal(pond.name)
            if target is None:
                continue
            if not is_extra_zero_water_area(pond.water_area_decimal, target):
                continue
            old = pond.water_area_decimal
            pond.water_area_decimal = target
            pond.save(update_fields=["water_area_decimal", "updated_at"])
            updated.append(
                {
                    "id": pond.id,
                    "company_id": pond.company_id,
                    "name": pond.name,
                    "old_water_area_decimal": old,
                    "water_area_decimal": target,
                }
            )
    return updated
