"""
Food-fish sale clearance from medicine/treatment withdrawal periods.

Prefers structured AquacultureExpense.withdrawal_days / clear_to_sell_on.
Falls back to memo "Withdrawal: N d" for older treatment rows.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Q

from api.models import AquacultureExpense

_WITHDRAWAL_MEMO_RE = re.compile(
    r"Withdrawal:\s*(\d+)\s*d\b",
    re.IGNORECASE,
)


def parse_withdrawal_days_from_memo(memo: str | None) -> int | None:
    raw = (memo or "").strip()
    if not raw:
        return None
    m = _WITHDRAWAL_MEMO_RE.search(raw)
    if not m:
        return None
    try:
        days = int(m.group(1))
    except (TypeError, ValueError):
        return None
    return days if days >= 0 else None


def compute_clear_to_sell_on(expense_date: date, withdrawal_days: int | None) -> date | None:
    if withdrawal_days is None:
        return None
    if withdrawal_days < 0:
        return None
    # Day 0 = may sell same day; day N = first sellable calendar day is expense_date + N.
    return expense_date + timedelta(days=int(withdrawal_days))


def resolve_withdrawal_days(
    *,
    expense_date: date,
    withdrawal_days: Any = None,
    memo: str | None = None,
    existing_days: int | None = None,
) -> int | None:
    """Body field wins, then existing structured value, then memo parse."""
    if withdrawal_days not in (None, ""):
        try:
            d = int(withdrawal_days)
        except (TypeError, ValueError):
            return existing_days
        return d if d >= 0 else None
    if existing_days is not None:
        return existing_days
    return parse_withdrawal_days_from_memo(memo)


def apply_withdrawal_to_expense(
    expense: AquacultureExpense,
    *,
    withdrawal_days: Any = None,
    save: bool = True,
) -> AquacultureExpense:
    """
    Set withdrawal_days / clear_to_sell_on on a medicine (or any) expense.
    When withdrawal_days is omitted, derive from existing field or memo.
    """
    days = resolve_withdrawal_days(
        expense_date=expense.expense_date,
        withdrawal_days=withdrawal_days,
        memo=expense.memo,
        existing_days=getattr(expense, "withdrawal_days", None),
    )
    expense.withdrawal_days = days
    expense.clear_to_sell_on = compute_clear_to_sell_on(expense.expense_date, days)
    if save:
        expense.save(update_fields=["withdrawal_days", "clear_to_sell_on", "updated_at"])
    return expense


def _share_pond_ids(expense: AquacultureExpense) -> list[int]:
    if expense.pond_id:
        return [int(expense.pond_id)]
    return list(
        expense.pond_shares.values_list("pond_id", flat=True).distinct()
    )


def pond_sale_clearance(
    company_id: int,
    pond_id: int,
    sale_date: date,
) -> dict:
    """
    Return clearance status for food-fish harvest on a pond as of sale_date.

    blocking: True when any treatment's clear_to_sell_on is after sale_date.
    """
    qs = (
        AquacultureExpense.objects.filter(company_id=company_id)
        .filter(Q(pond_id=pond_id) | Q(pond_id__isnull=True, pond_shares__pond_id=pond_id))
        .filter(
            Q(expense_category="medicine_consumed")
            | Q(expense_category__icontains="medicine")
        )
        .distinct()
        .order_by("-expense_date", "-id")[:200]
    )

    blocking: list[dict] = []
    latest_clear: date | None = None
    treatments_checked = 0

    for x in qs:
        treatments_checked += 1
        days = getattr(x, "withdrawal_days", None)
        clear_on = getattr(x, "clear_to_sell_on", None)
        if days is None and clear_on is None:
            days = parse_withdrawal_days_from_memo(x.memo)
            clear_on = compute_clear_to_sell_on(x.expense_date, days)
        elif clear_on is None and days is not None:
            clear_on = compute_clear_to_sell_on(x.expense_date, days)

        if clear_on is None:
            continue
        if latest_clear is None or clear_on > latest_clear:
            latest_clear = clear_on
        if clear_on > sale_date:
            blocking.append(
                {
                    "expense_id": x.id,
                    "expense_date": x.expense_date.isoformat(),
                    "withdrawal_days": days,
                    "clear_to_sell_on": clear_on.isoformat(),
                    "memo_preview": (x.memo or "")[:160],
                }
            )

    blocking.sort(key=lambda r: r["clear_to_sell_on"], reverse=True)
    max_clear = blocking[0]["clear_to_sell_on"] if blocking else (
        latest_clear.isoformat() if latest_clear else None
    )
    return {
        "pond_id": pond_id,
        "sale_date": sale_date.isoformat(),
        "cleared": len(blocking) == 0,
        "blocking": blocking,
        "earliest_clear_to_sell_on": max_clear if blocking else (
            latest_clear.isoformat() if latest_clear else None
        ),
        "treatments_checked": treatments_checked,
    }


def assert_pond_cleared_for_sale(
    company_id: int,
    pond_id: int,
    sale_date: date,
) -> str | None:
    """Return error detail if sale must be blocked; None if OK."""
    status = pond_sale_clearance(company_id, pond_id, sale_date)
    if status["cleared"]:
        return None
    top = status["blocking"][0]
    return (
        f"Pond is not cleared for food-fish sale on {sale_date.isoformat()}. "
        f"Treatment on {top['expense_date']} has withdrawal until "
        f"{top['clear_to_sell_on']} (earliest sale date). "
        f"Wait for clearance or correct the treatment withdrawal period."
    )


def optional_decimal(raw: Any) -> Decimal | None:
    if raw in (None, ""):
        return None
    try:
        return Decimal(str(raw))
    except Exception:
        return None


def optional_int(raw: Any) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None
