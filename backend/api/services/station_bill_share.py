"""
Expand a vendor bill line across multiple stations (equal or manual split).
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.http import JsonResponse

from api.models import Station
from api.services.aquaculture_bill_pond_share import equal_split_amounts, _money_q


def _stations_valid_for_company(company_id: int, station_ids: list[int]) -> bool:
    if not station_ids:
        return False
    return (
        Station.objects.filter(company_id=company_id, pk__in=station_ids, is_active=True).count()
        == len(set(station_ids))
    )


def parse_bill_line_station_share_allocations(
    row: dict, company_id: int, total_amount: Decimal
) -> tuple[list[tuple[int, Decimal]] | None, str | None]:
    eq = row.get("shared_equal_station_ids")
    raw_shares = row.get("station_shares")
    if eq is not None and raw_shares is not None:
        return None, "Use either shared_equal_station_ids or station_shares, not both."
    if eq is not None:
        if not isinstance(eq, list) or len(eq) < 2:
            return None, "shared_equal_station_ids must be a list of at least two station ids."
        try:
            sids = [int(x) for x in eq]
        except (TypeError, ValueError):
            return None, "shared_equal_station_ids must be integers."
        if len(set(sids)) < 2:
            return None, "shared_equal_station_ids must name at least two distinct stations."
        if not _stations_valid_for_company(company_id, sids):
            return None, "One or more station ids are invalid or inactive for this company."
        return equal_split_amounts(_money_q(total_amount), sids), None
    if raw_shares is not None:
        if not isinstance(raw_shares, list) or len(raw_shares) < 2:
            return None, "station_shares must be a list with at least two {station_id, amount} rows."
        pairs: list[tuple[int, Decimal]] = []
        seen: set[int] = set()
        for share_row in raw_shares:
            if not isinstance(share_row, dict):
                return None, "Each station_shares row must be an object."
            try:
                sid = int(share_row.get("station_id"))
            except (TypeError, ValueError):
                return None, "station_id in station_shares must be an integer."
            if sid in seen:
                return None, "Duplicate station_id in station_shares."
            seen.add(sid)
            try:
                amt = Decimal(str(share_row.get("amount")))
            except Exception:
                return None, "Each station_shares amount must be a number."
            if amt <= 0:
                return None, "Each station_shares amount must be greater than zero."
            pairs.append((sid, _money_q(amt)))
        if len(seen) < 2:
            return None, "station_shares must cover at least two distinct stations."
        if not _stations_valid_for_company(company_id, list(seen)):
            return None, "One or more station ids in station_shares are invalid for this company."
        sm = sum(a for _, a in pairs)
        if _money_q(sm) != _money_q(total_amount):
            return None, "station_shares must sum exactly to the line amount (two decimal places)."
        return pairs, None
    return None, "Shared station split requires shared_equal_station_ids or station_shares."


def station_bill_line_cost_mode(row: dict) -> str:
    return str(row.get("station_cost_mode") or "direct").strip().lower()


def parse_optional_line_receipt_station_id(
    company_id: int, row: dict
) -> tuple[int | None, str | None]:
    raw = row.get("line_receipt_station_id")
    if raw in (None, ""):
        return None, None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None, "line_receipt_station_id must be an integer."
    if not Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return None, "Unknown or inactive line_receipt_station_id for this company."
    return sid, None


def expand_parsed_bill_line_for_station_share(
    company_id: int, row: dict, pl: dict
) -> tuple[list[dict], JsonResponse | None]:
    mode = station_bill_line_cost_mode(row)
    if mode in ("", "direct"):
        return [pl], None

    if mode not in ("shared_equal", "shared_manual"):
        return [], JsonResponse(
            {"detail": f"Unknown station_cost_mode: {mode}"},
            status=400,
        )

    if pl.get("aquaculture_pond_id"):
        return [], JsonResponse(
            {
                "detail": "Station shared split cannot be used on lines tagged to a pond.",
            },
            status=400,
        )

    if pl.get("amount") is None or pl["amount"] <= 0:
        return [], JsonResponse(
            {"detail": "Shared station split requires a line amount greater than zero."},
            status=400,
        )

    raw_st = row.get("line_receipt_station_id")
    if raw_st not in (None, ""):
        return [], JsonResponse(
            {
                "detail": "Do not set line_receipt_station_id when using shared station split; "
                "use shared_equal_station_ids or station_shares instead.",
            },
            status=400,
        )

    pairs, perr = parse_bill_line_station_share_allocations(row, company_id, pl["amount"])
    if perr:
        return [], JsonResponse({"detail": perr}, status=400)
    assert pairs is not None

    item_id = pl.get("item_id")
    outs: list[dict] = []
    for sid, portion in pairs:
        child = {**pl, "amount": portion, "receipt_station_id": sid}
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
