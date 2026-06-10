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
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, cursor.day if cursor.day <= 28 else 28)
        else:
            next_month = cursor.month + 1
            try:
                cursor = date(cursor.year, next_month, cursor.day)
            except ValueError:
                cursor = date(cursor.year, next_month, 28)
    return rows


def run_exists_for_period(asset: FixedAsset, period_end: date) -> bool:
    """True if a depreciation run already exists for the same calendar month."""
    return FixedAssetDepreciationRun.objects.filter(
        fixed_asset_id=asset.id,
        run_date__year=period_end.year,
        run_date__month=period_end.month,
    ).exists()
