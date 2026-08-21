"""Straight-line depreciation calculations for the fixed asset register."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from api.models import FixedAsset, FixedAssetDepreciationRun


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def book_value(asset: FixedAsset) -> Decimal:
    cost = asset.acquisition_cost or Decimal("0")
    accum = asset.accumulated_depreciation or Decimal("0")
    return _q2(max(cost - accum, Decimal("0")))


def depreciable_remaining(asset: FixedAsset) -> Decimal:
    salvage = asset.salvage_value or Decimal("0")
    return _q2(max(book_value(asset) - salvage, Decimal("0")))


def standard_monthly_amount(asset: FixedAsset) -> Decimal:
    months = int(asset.useful_life_months or 0)
    if months <= 0:
        return Decimal("0")
    base = (asset.acquisition_cost or Decimal("0")) - (asset.salvage_value or Decimal("0"))
    if base <= 0:
        return Decimal("0")
    return _q2(base / Decimal(months))


def amount_for_next_run(asset: FixedAsset) -> Decimal:
    """Next depreciation amount capped by remaining depreciable book value."""
    remaining = depreciable_remaining(asset)
    if remaining <= 0:
        return Decimal("0")
    monthly = standard_monthly_amount(asset)
    if monthly <= 0:
        return Decimal("0")
    return _q2(min(monthly, remaining))


def _step_one_month(d: date) -> date:
    """Same day next month, clamped to the 28th so short months never raise."""
    if d.month == 12:
        return date(d.year + 1, 1, d.day if d.day <= 28 else 28)
    try:
        return date(d.year, d.month + 1, d.day)
    except ValueError:
        return date(d.year, d.month + 1, 28)


def depreciation_schedule(asset: FixedAsset, max_rows: int = 120) -> list[dict[str, Any]]:
    """
    Project remaining straight-line runs from current accumulated depreciation.
    Does not include historical runs already posted.
    """
    rows: list[dict[str, Any]] = []
    sim_accum = asset.accumulated_depreciation or Decimal("0")
    cost = asset.acquisition_cost or Decimal("0")
    salvage = asset.salvage_value or Decimal("0")
    monthly = standard_monthly_amount(asset)
    if monthly <= 0 or cost <= 0:
        return rows

    start = asset.last_depreciation_date or asset.in_service_date or asset.acquisition_date
    if not start:
        start = date.today()
    if asset.last_depreciation_date:
        # That month is already depreciated; projecting it again showed a duplicate first row
        # (and posting would refuse it — run_exists_for_period guards the calendar month).
        start = _step_one_month(start)

    cursor = start
    for n in range(max_rows):
        book = cost - sim_accum
        dep_remaining = book - salvage
        if dep_remaining <= Decimal("0.005"):
            break
        amt = _q2(min(monthly, dep_remaining))
        rows.append(
            {
                "period_index": n + 1,
                "run_date": cursor.isoformat(),
                "amount": str(amt),
                "book_value_before": str(_q2(book)),
                "book_value_after": str(_q2(book - amt)),
            }
        )
        sim_accum += amt
        cursor = _step_one_month(cursor)
    return rows


def run_exists_for_period(asset: FixedAsset, period_end: date) -> bool:
    """True if a depreciation run already exists for the same calendar month."""
    return FixedAssetDepreciationRun.objects.filter(
        fixed_asset_id=asset.id,
        run_date__year=period_end.year,
        run_date__month=period_end.month,
    ).exists()
