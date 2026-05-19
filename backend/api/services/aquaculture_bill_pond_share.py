"""
Expand a single vendor bill line into multiple lines when aquaculture_cost_mode is shared.
Mirrors pond-cost shared_equal / shared_manual behaviour on Aquaculture expenses.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.http import JsonResponse

from api.models import AquaculturePond, Item


def _money_q(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def equal_split_amounts(total: Decimal, pond_ids: list[int]) -> list[tuple[int, Decimal]]:
    """Split total into len(pond_ids) currency amounts that sum exactly to total (cent fairness)."""
    n = len(pond_ids)
    total_cents = int(_money_q(total) * 100)
    base = total_cents // n
    rem = total_cents % n
    out: list[tuple[int, Decimal]] = []
    for i, pid in enumerate(pond_ids):
        cents = base + (1 if i < rem else 0)
        out.append((pid, Decimal(cents) / Decimal(100)))
    return out


def _ponds_valid_for_company(company_id: int, pond_ids: list[int]) -> bool:
    if not pond_ids:
        return False
    return (
        AquaculturePond.objects.filter(company_id=company_id, pk__in=pond_ids).count()
        == len(set(pond_ids))
    )


def parse_bill_line_pond_share_allocations(
    row: dict, company_id: int, total_amount: Decimal
) -> tuple[list[tuple[int, Decimal]] | None, str | None]:
    """
    Parse shared split fields on a bill line row.
    Returns (list of (pond_id, amount), error_message).
    """
    eq = row.get("shared_equal_pond_ids")
    raw_shares = row.get("pond_shares")
    if eq is not None and raw_shares is not None:
        return None, "Use either shared_equal_pond_ids or pond_shares, not both."
    if eq is not None:
        if not isinstance(eq, list) or len(eq) < 2:
            return None, "shared_equal_pond_ids must be a list of at least two pond ids."
        try:
            pids = [int(x) for x in eq]
        except (TypeError, ValueError):
            return None, "shared_equal_pond_ids must be integers."
        if len(set(pids)) < 2:
            return None, "shared_equal_pond_ids must name at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, pids):
            return None, "One or more pond ids are invalid for this company."
        return equal_split_amounts(_money_q(total_amount), pids), None
    if raw_shares is not None:
        if not isinstance(raw_shares, list) or len(raw_shares) < 2:
            return None, "pond_shares must be a list with at least two {pond_id, amount} rows."
        pairs: list[tuple[int, Decimal]] = []
        seen: set[int] = set()
        for share_row in raw_shares:
            if not isinstance(share_row, dict):
                return None, "Each pond_shares row must be an object."
            try:
                pid = int(share_row.get("pond_id"))
            except (TypeError, ValueError):
                return None, "pond_id in pond_shares must be an integer."
            if pid in seen:
                return None, "Duplicate pond_id in pond_shares."
            seen.add(pid)
            try:
                amt = Decimal(str(share_row.get("amount")))
            except Exception:
                return None, "Each pond_shares amount must be a number."
            if amt <= 0:
                return None, "Each pond_shares amount must be greater than zero."
            pairs.append((pid, _money_q(amt)))
        if len(seen) < 2:
            return None, "pond_shares must cover at least two distinct ponds."
        if not _ponds_valid_for_company(company_id, list(seen)):
            return None, "One or more pond ids in pond_shares are invalid for this company."
        sm = sum(a for _, a in pairs)
        if _money_q(sm) != _money_q(total_amount):
            return None, "pond_shares must sum exactly to the line amount (two decimal places)."
        return pairs, None
    return None, "Shared pond split requires shared_equal_pond_ids or pond_shares."


def bill_line_cost_mode(row: dict) -> str:
    return str(row.get("aquaculture_cost_mode") or "direct").strip().lower()


def expand_parsed_bill_line_for_pond_share(
    company_id: int, row: dict, pl: dict
) -> tuple[list[dict], JsonResponse | None]:
    """
    When aquaculture_cost_mode is shared_equal or shared_manual, return one parsed line dict
    per pond allocation. Otherwise return the single line unchanged.
    """
    mode = bill_line_cost_mode(row)
    if mode in ("", "direct"):
        return [pl], None

    if mode not in ("shared_equal", "shared_manual"):
        return [], JsonResponse(
            {"detail": f"Unknown aquaculture_cost_mode: {mode}"},
            status=400,
        )

    if pl.get("amount") is None or pl["amount"] <= 0:
        return [], JsonResponse(
            {"detail": "Shared pond split requires a line amount greater than zero."},
            status=400,
        )

    raw_pond = row.get("aquaculture_pond_id")
    if raw_pond not in (None, ""):
        return [], JsonResponse(
            {
                "detail": "Do not set aquaculture_pond_id when using shared pond split; "
                "use shared_equal_pond_ids or pond_shares instead.",
            },
            status=400,
        )

    item_id = pl.get("item_id")
    if item_id:
        item = (
            Item.objects.filter(pk=item_id, company_id=company_id)
            .only("pos_category")
            .first()
        )
        if item and (item.pos_category or "").strip().lower() == "fish":
            return [], JsonResponse(
                {
                    "detail": "Fish-type bill lines cannot use shared pond split; "
                    "tag one pond per line.",
                },
                status=400,
            )

    if pl.get("aquaculture_fish_weight_kg") or pl.get("aquaculture_fish_count"):
        return [], JsonResponse(
            {"detail": "Shared pond split is not allowed on fish-dimension bill lines."},
            status=400,
        )

    pairs, perr = parse_bill_line_pond_share_allocations(row, company_id, pl["amount"])
    if perr:
        return [], JsonResponse({"detail": perr}, status=400)
    assert pairs is not None

    outs: list[dict] = []
    for pid, portion in pairs:
        child = {
            **pl,
            "amount": portion,
            "aquaculture_pond_id": pid,
            "aquaculture_production_cycle_id": None,
        }
        if not item_id:
            child["quantity"] = Decimal("1")
            child["unit_price"] = portion
        else:
            qty = pl.get("quantity") or Decimal("1")
            if qty > 0:
                child["unit_price"] = (portion / qty).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
        outs.append(child)
    return outs, None
