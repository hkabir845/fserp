"""Aquaculture Data Bank: per-pond year close, locks, and reference reopen."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import TypeVar

from django.db import transaction
from django.db.models import F, OuterRef, Q, QuerySet, Subquery
from django.utils import timezone

from api.models import (
    AquacultureDataBankPondClose,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
    Station,
)
from api.services.aquaculture_pond_pos_customer import resolve_shop_station_for_pond  # ponds without POS customer
from api.services.permission_service import normalize_role_key, user_is_super_admin


def _actor_user_id(user) -> int | None:
    if not user:
        return None
    pk = getattr(user, "pk", None) or getattr(user, "id", None)
    try:
        return int(pk) if pk is not None else None
    except (TypeError, ValueError):
        return None


def pond_biological_settlement(company_id: int, pond_id: int, as_of: date) -> dict:
    """
    Remaining live-fish position for a pond and its bio-asset book value at close.

    - count/weight: implied net (stocking + transfers + ledger - sales) from the stock service.
    - bioasset value: posted GL balance of Biological Inventory (1581) tagged to this pond, on or
      before ``as_of`` (debits minus credits).
    """
    from decimal import Decimal

    from django.db.models import Sum
    from django.db.models.functions import Coalesce

    from api.models import JournalEntryLine
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    count = 0
    weight = Decimal("0")
    rows = compute_fish_stock_position_rows(
        company_id, pond_id=pond_id, include_inactive_ponds=True
    )
    for row in rows:
        try:
            count += int(row.get("implied_net_fish_count") or 0)
        except (TypeError, ValueError):
            pass
        try:
            weight += Decimal(str(row.get("implied_net_weight_kg") or "0"))
        except (TypeError, ValueError, ArithmeticError):
            pass

    agg = (
        JournalEntryLine.objects.filter(
            journal_entry__company_id=company_id,
            journal_entry__is_posted=True,
            journal_entry__entry_date__lte=as_of,
            aquaculture_pond_id=pond_id,
            account__account_code="1581",
        )
        .aggregate(
            td=Coalesce(Sum("debit"), Decimal("0")),
            tc=Coalesce(Sum("credit"), Decimal("0")),
        )
    )
    bioasset = (agg["td"] - agg["tc"]).quantize(Decimal("0.01"))
    return {
        "settlement_fish_count": count,
        "settlement_weight_kg": weight.quantize(Decimal("0.0001")),
        "settlement_bioasset_value": bioasset,
    }


_BIOASSET_CLOSE_TOLERANCE = Decimal("0.01")

_YEAR_CLOSE_LEASE_NOTE = (
    "Land lease and site costs on Site & lease are not closed with the pond — rent continues "
    "through the empty pond renovation and preparation period until the next stocking cycle."
)


def _pond_warehouse_stock_lines(company_id: int, pond_id: int) -> list[dict]:
    """Non-fish pond-warehouse rows with on-hand quantity (feed, medicine, supplies)."""
    from decimal import Decimal

    from api.services.aquaculture_pond_stock_service import pond_warehouse_stock_matrix

    lines: list[dict] = []
    for row in pond_warehouse_stock_matrix(company_id, pond_id=pond_id):
        qty = Decimal(str(row.get("quantity") or "0"))
        if qty <= 0:
            continue
        lines.append(
            {
                "item_id": row.get("item_id"),
                "item_name": (row.get("item_name") or row.get("name") or "").strip(),
                "quantity": str(qty),
                "unit": (row.get("unit") or "").strip(),
                "pos_category": (row.get("pos_category") or "").strip(),
            }
        )
    return lines


def _open_production_cycle_count(company_id: int, pond_id: int) -> int:
    return AquacultureProductionCycle.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        end_date__isnull=True,
    ).count()


def pond_year_close_readiness(company_id: int, pond_id: int, as_of: date) -> dict:
    """
    Year close requires an empty pond ready for renovation / next cycle (global practice:
    harvest, drain, dry, lime, predator removal) while land lease continues on Site & lease.

    Hard blockers: live fish, biological inventory (1581), feed/medicine in pond warehouse.
    Open production cycles are auto-ended on successful close (not a blocker).
    """
    settlement = pond_biological_settlement(company_id, pond_id, as_of)
    fish_count = int(settlement["settlement_fish_count"] or 0)
    fish_kg = settlement["settlement_weight_kg"]
    bioasset = settlement["settlement_bioasset_value"]
    warehouse_lines = _pond_warehouse_stock_lines(company_id, pond_id)
    open_cycles = _open_production_cycle_count(company_id, pond_id)

    blockers: list[str] = []
    if fish_count > 0:
        blockers.append(
            f"{fish_count:,} live fish remain ({fish_kg} kg). Harvest or transfer all fish "
            "before year close so the pond is empty for renovation."
        )
    if bioasset > _BIOASSET_CLOSE_TOLERANCE:
        blockers.append(
            f"Biological inventory (1581) balance {bioasset} remains for this pond. "
            "Record harvest sales or bio-asset relief so the pond is financially empty."
        )
    if warehouse_lines:
        parts = [
            f'{(ln["item_name"] or "item").strip()} ({ln["quantity"]} {ln["unit"] or "units"})'.strip()
            for ln in warehouse_lines[:5]
        ]
        extra = f" (+{len(warehouse_lines) - 5} more)" if len(warehouse_lines) > 5 else ""
        blockers.append(
            f"Feed/medicine still in pond warehouse: {', '.join(parts)}{extra}. "
            "Use, transfer, or adjust stock before close."
        )

    actions = _year_close_readiness_actions(
        pond_id=pond_id,
        fish_count=fish_count,
        bioasset=bioasset,
        warehouse_lines=warehouse_lines,
        open_cycles=open_cycles,
    )

    return {
        "is_ready": len(blockers) == 0,
        "blockers": blockers,
        "actions": actions,
        "open_production_cycle_count": open_cycles,
        "warehouse_stock_lines": warehouse_lines,
        "lease_continues_note": _YEAR_CLOSE_LEASE_NOTE,
        "settlement_fish_count": fish_count,
        "settlement_weight_kg": str(fish_kg),
        "settlement_bioasset_value": str(bioasset),
    }


def _year_close_readiness_actions(
    *,
    pond_id: int,
    fish_count: int,
    bioasset: Decimal,
    warehouse_lines: list[dict],
    open_cycles: int,
) -> list[dict]:
    """Actionable next steps for operators (links or confirmed helpers)."""
    actions: list[dict] = []
    if fish_count > 0:
        actions.append(
            {
                "id": "harvest_fish",
                "kind": "link",
                "label": "Record harvest sale",
                "detail": f"{fish_count:,} live fish remain in this pond.",
                "href": f"/aquaculture/sales?pond_id={pond_id}",
            }
        )
        actions.append(
            {
                "id": "transfer_fish",
                "kind": "link",
                "label": "Transfer fish to another pond",
                "detail": "Use inter-pond fish transfer when moving fingerlings or biomass.",
                "href": f"/aquaculture/transfers?from_pond_id={pond_id}",
            }
        )
    if bioasset > _BIOASSET_CLOSE_TOLERANCE:
        actions.append(
            {
                "id": "bioasset_relief",
                "kind": "link",
                "label": "Finalize harvest sales or adjust bio-asset",
                "detail": f"Biological inventory (1581) balance {bioasset} remains.",
                "href": f"/aquaculture/sales?pond_id={pond_id}",
            }
        )
        actions.append(
            {
                "id": "stock_ledger",
                "kind": "link",
                "label": "Fish stock ledger (mortality / write-down)",
                "detail": "Post mortality or count adjustments with GL relief when needed.",
                "href": f"/aquaculture/stock?pond_id={pond_id}",
            }
        )
    if warehouse_lines:
        actions.append(
            {
                "id": "return_warehouse",
                "kind": "return_warehouse",
                "label": "Return all warehouse stock to shop",
                "detail": (
                    f"{len(warehouse_lines)} item line(s) on hand — returns feed/medicine to the "
                    "linked shop station (confirmed action)."
                ),
            }
        )
        actions.append(
            {
                "id": "pond_warehouse",
                "kind": "link",
                "label": "Pond warehouse detail",
                "detail": "Review on-hand feed, medicine, and supplies.",
                "href": f"/aquaculture/ponds/{pond_id}",
            }
        )
        actions.append(
            {
                "id": "inventory_transfer",
                "kind": "link",
                "label": "Inventory transfers",
                "detail": "Manual pond → shop return or inter-pond move.",
                "href": "/inventory",
            }
        )
    if open_cycles > 0:
        actions.append(
            {
                "id": "open_cycles",
                "kind": "info",
                "label": f"{open_cycles} open production cycle(s)",
                "detail": "These cycles will end automatically when year close succeeds.",
                "href": f"/aquaculture/cycles?pond_id={pond_id}",
            }
        )
    return actions


def _resolve_return_station_id(
    company_id: int,
    pond_id: int,
    station_id: int | None = None,
) -> int | None:
    if station_id:
        if Station.objects.filter(pk=station_id, company_id=company_id, is_active=True).exists():
            return station_id
        return None
    from api.services.aquaculture_pond_pos_customer import resolve_shop_station_for_pond
    from api.services.station_stock import get_or_create_default_station

    sid = resolve_shop_station_for_pond(company_id=company_id, pond_id=pond_id)
    if sid:
        return sid
    return get_or_create_default_station(company_id).id


def return_pond_warehouse_for_year_close(
    *,
    company_id: int,
    pond_id: int,
    user=None,
    station_id: int | None = None,
    memo: str = "",
) -> tuple[dict | None, str | None]:
    """
    Explicit helper: return all pond-warehouse feed/medicine lines to a shop station.
    Does not run automatically on year close.
    """
    from api.exceptions import StockBusinessError
    from api.services.aquaculture_pond_stock_service import (
        transfer_pond_warehouse_to_station,
    )

    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return None, "Pond not found."

    blocked = pond_write_blocked_detail(company_id, pond_id)
    if blocked:
        return None, blocked

    lines = _pond_warehouse_stock_lines(company_id, pond_id)
    if not lines:
        return {"pond_id": pond_id, "returned_lines": 0, "items": []}, None

    sid = _resolve_return_station_id(company_id, pond_id, station_id)
    if not sid:
        return None, "No active shop station found to receive returned stock."

    items = [
        {"item_id": int(ln["item_id"]), "quantity": ln["quantity"]}
        for ln in lines
        if ln.get("item_id") is not None
    ]
    if not items:
        return None, "Warehouse stock lines could not be resolved for return."

    note = (memo or "").strip() or f"Data Bank year-close prep — return all stock from {pond.name}"
    try:
        ret = transfer_pond_warehouse_to_station(
            company_id=company_id,
            pond_id=pond_id,
            station_id=sid,
            items=items,
            memo=note[:500],
        )
    except StockBusinessError as ex:
        return None, getattr(ex, "detail", str(ex))

    remaining = _pond_warehouse_stock_lines(company_id, pond_id)
    return {
        "pond_id": pond_id,
        "station_id": sid,
        "return_id": ret.id,
        "return_number": ret.return_number or "",
        "returned_lines": len(items),
        "remaining_lines": len(remaining),
        "items": lines,
    }, None


def list_readiness_overview(company_id: int, as_of: date) -> dict:
    """Readiness summary for every pond not currently data-locked (year-close prep fleet view)."""
    ponds = list(
        AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
            "sort_order", "id"
        )
    )
    rows: list[dict] = []
    ready_count = 0
    for pond in ponds:
        if _active_close_qs(company_id, pond.id).exists():
            rows.append(
                {
                    "pond_id": pond.id,
                    "pond_name": pond.name,
                    "pond_code": pond.code or "",
                    "is_currently_locked": True,
                    "is_ready": None,
                    "blocker_count": None,
                }
            )
            continue
        readiness = pond_year_close_readiness(company_id, pond.id, as_of)
        if readiness["is_ready"]:
            ready_count += 1
        rows.append(
            {
                "pond_id": pond.id,
                "pond_name": pond.name,
                "pond_code": pond.code or "",
                "is_currently_locked": False,
                "is_ready": readiness["is_ready"],
                "blocker_count": len(readiness["blockers"]),
                "open_production_cycle_count": readiness["open_production_cycle_count"],
                "settlement_fish_count": readiness["settlement_fish_count"],
                "settlement_bioasset_value": readiness["settlement_bioasset_value"],
                "warehouse_line_count": len(readiness["warehouse_stock_lines"]),
            }
        )
    open_ponds = [r for r in rows if not r["is_currently_locked"]]
    return {
        "as_of": as_of.isoformat(),
        "pond_count": len(rows),
        "open_pond_count": len(open_ponds),
        "ready_pond_count": ready_count,
        "not_ready_pond_count": len(open_ponds) - ready_count,
        "lease_continues_note": _YEAR_CLOSE_LEASE_NOTE,
        "ponds": rows,
    }


def _end_open_production_cycles_on_close(
    company_id: int,
    pond_id: int,
    period_end: date,
    close_label: str,
) -> int:
    """Mark open cycles ended on the close date so the next season starts fresh."""
    note_suffix = f"Ended by Data Bank year close ({close_label}) on {period_end.isoformat()}."
    ended = 0
    for cycle in AquacultureProductionCycle.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        end_date__isnull=True,
    ):
        notes = (cycle.notes or "").strip()
        if note_suffix not in notes:
            notes = f"{notes}\n{note_suffix}".strip() if notes else note_suffix
        cycle.end_date = period_end
        cycle.is_active = False
        cycle.notes = notes[:5000]
        cycle.save(update_fields=["end_date", "is_active", "notes", "updated_at"])
        ended += 1
    return ended


def user_may_manage_aquaculture_data_bank(user) -> bool:
    """Per-pond year close and reopen/relock: tenant Admin or platform super-admin only."""
    if not user:
        return False
    if user_is_super_admin(user):
        return True
    return normalize_role_key(getattr(user, "role", None)) == "admin"


def _parse_fiscal_year_start(company: Company) -> tuple[int, int]:
    raw = (getattr(company, "fiscal_year_start", None) or "01-01").strip()[:5]
    parts = raw.split("-")
    if len(parts) == 2:
        try:
            month = int(parts[0])
            day = int(parts[1])
            if 1 <= month <= 12 and 1 <= day <= 31:
                return month, day
        except ValueError:
            pass
    return 1, 1


def fiscal_period_for_end_date(company: Company, period_end: date) -> tuple[date, date]:
    """Return (period_start, period_end) using company fiscal year start."""
    month, day = _parse_fiscal_year_start(company)
    start = date(period_end.year, month, day)
    if start >= period_end:
        start = date(period_end.year - 1, month, day)
    return start, period_end


def default_period_label(pond_name: str, period_start: date, period_end: date) -> str:
    if period_start.year == period_end.year:
        fy = f"FY {period_end.year}"
    else:
        fy = f"FY {period_start.year}/{str(period_end.year)[-2:]}"
    name = (pond_name or "").strip()
    return f"{name} — {fy}" if name else fy


def default_station_period_label(station_name: str, period_start: date, period_end: date) -> str:
    if period_start.year == period_end.year:
        fy = f"FY {period_end.year}"
    else:
        fy = f"FY {period_start.year}/{str(period_end.year)[-2:]}"
    name = (station_name or "").strip()
    return f"{name} — {fy}" if name else fy


def pond_ids_for_station(company_id: int, station_id: int) -> list[int]:
    """Ponds linked to a shop station via default outlet or POS customer default site."""
    if not Station.objects.filter(pk=station_id, company_id=company_id).exists():
        return []
    out: set[int] = set()
    explicit = Station.objects.filter(
        pk=station_id, company_id=company_id, default_aquaculture_pond_id__isnull=False
    ).values_list("default_aquaculture_pond_id", flat=True)
    for pid in explicit:
        if pid:
            out.add(int(pid))
    for pid in AquaculturePond.objects.filter(
        company_id=company_id,
        pos_customer__default_station_id=station_id,
    ).values_list("id", flat=True):
        out.add(int(pid))
    for pond in AquaculturePond.objects.filter(
        company_id=company_id, pos_customer_id__isnull=True
    ).only("id"):
        sid = resolve_shop_station_for_pond(company_id=company_id, pond_id=pond.id)
        if sid == station_id:
            out.add(pond.id)
    return sorted(out)


def _active_close_qs(company_id: int, pond_id: int):
    return AquacultureDataBankPondClose.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        status=AquacultureDataBankPondClose.STATUS_CLOSED,
        is_data_locked=True,
    ).order_by("-period_end", "-id")


QS = TypeVar("QS", bound=QuerySet)


def pond_live_data_after_date(company_id: int, pond_id: int) -> date | None:
    """
    Last date of the archived closed period. Live pond UI/API rows must be strictly after this.
    None when the pond has no active data lock.
    """
    close = _active_close_qs(company_id, pond_id).first()
    if not close:
        return None
    return close.period_end


def filter_live_pond_queryset(qs: QS, company_id: int, pond_id: int, date_field: str) -> QS:
    """Exclude archived operational rows for a locked pond (keep structure/master data APIs separate)."""
    after = pond_live_data_after_date(company_id, pond_id)
    if after is None:
        return qs
    return qs.filter(**{f"{date_field}__gt": after})


def filter_live_biomass_samples_queryset(qs: QS, company_id: int) -> QS:
    """
    Exclude archived biomass samples for ponds with active Data Bank closes.
    Matches per-pond filter_live_pond_queryset(..., sample_date) when listing all ponds.
    """
    latest_close_end = (
        AquacultureDataBankPondClose.objects.filter(
            company_id=company_id,
            pond_id=OuterRef("pond_id"),
            status=AquacultureDataBankPondClose.STATUS_CLOSED,
            is_data_locked=True,
        )
        .order_by("-period_end", "-id")
        .values("period_end")[:1]
    )
    return qs.annotate(_data_bank_close_end=Subquery(latest_close_end)).filter(
        Q(_data_bank_close_end__isnull=True) | Q(sample_date__gt=F("_data_bank_close_end"))
    )


def effective_pl_start_for_pond(company_id: int, pond_id: int, start: date) -> date:
    """Clamp P&L window so locked ponds never aggregate archived periods in live views."""
    after = pond_live_data_after_date(company_id, pond_id)
    if after is None:
        return start
    live_floor = after + timedelta(days=1)
    return max(start, live_floor)


def pond_write_blocked_detail(
    company_id: int,
    pond_id: int,
    transaction_date: date | None = None,
) -> str | None:
    if transaction_date is not None:
        close = (
            AquacultureDataBankPondClose.objects.filter(
                company_id=company_id,
                pond_id=pond_id,
                status=AquacultureDataBankPondClose.STATUS_CLOSED,
                is_data_locked=True,
                period_start__lte=transaction_date,
                period_end__gte=transaction_date,
            )
            .select_related("pond")
            .order_by("-period_end")
            .first()
        )
        if not close:
            return None
    else:
        close = _active_close_qs(company_id, pond_id).first()
        if not close:
            return None
    label = close.label or default_period_label(
        getattr(close.pond, "name", ""), close.period_start, close.period_end
    )
    period = f"{close.period_start.isoformat()} – {close.period_end.isoformat()}"
    if close.reference_access_enabled:
        return (
            f"Operational data for {period} is archived in Data Bank ({label}). "
            "Pond structure is unchanged; reference access is on but edits in this period stay "
            "locked. Re-lock in Data Bank or contact an administrator. "
            f"Record the next season with dates after {close.period_end.isoformat()}."
        )
    return (
        f"Operational data for {period} is archived after year close ({label}). "
        "Pond structure is unchanged; edits within this window are blocked. "
        "View the period in Aquaculture → Data Bank, or record new cycles and stocking "
        f"dated after {close.period_end.isoformat()} when preparing for the next season."
    )


def pond_lock_summary(company_id: int, pond_id: int) -> dict | None:
    close = (
        AquacultureDataBankPondClose.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            status=AquacultureDataBankPondClose.STATUS_CLOSED,
        )
        .select_related("pond")
        .order_by("-period_end", "-id")
        .first()
    )
    if not close:
        return None
    return {
        "close_id": close.id,
        "period_label": close.label,
        "period_start": close.period_start.isoformat(),
        "period_end": close.period_end.isoformat(),
        "is_data_locked": close.is_data_locked,
        "reference_access_enabled": close.reference_access_enabled,
        "reopened_at": close.reopened_at.isoformat() if close.reopened_at else None,
        "reopen_reason": close.reopen_reason or "",
    }


def pond_close_to_dict(close: AquacultureDataBankPondClose) -> dict:
    pond = close.pond
    return {
        "id": close.id,
        "pond_id": pond.id,
        "pond_name": pond.name,
        "pond_code": pond.code or "",
        "is_active": pond.is_active,
        "label": close.label,
        "period_start": close.period_start.isoformat(),
        "period_end": close.period_end.isoformat(),
        "status": close.status,
        "is_data_locked": close.is_data_locked,
        "reference_access_enabled": close.reference_access_enabled,
        "closed_at": close.closed_at.isoformat() if close.closed_at else None,
        "closed_by_user_id": close.closed_by_user_id,
        "notes": close.notes or "",
        "settlement_fish_count": close.settlement_fish_count,
        "settlement_weight_kg": (
            str(close.settlement_weight_kg) if close.settlement_weight_kg is not None else None
        ),
        "settlement_bioasset_value": (
            str(close.settlement_bioasset_value)
            if close.settlement_bioasset_value is not None
            else None
        ),
        "reopened_at": close.reopened_at.isoformat() if close.reopened_at else None,
        "reopened_by_user_id": close.reopened_by_user_id,
        "reopen_reason": close.reopen_reason or "",
        "relocked_at": close.relocked_at.isoformat() if close.relocked_at else None,
        "relocked_by_user_id": close.relocked_by_user_id,
    }


def list_data_bank(company_id: int) -> dict:
    """Ponds with close status plus full history of per-pond closes."""
    ponds = list(
        AquaculturePond.objects.filter(company_id=company_id).order_by("sort_order", "id")
    )
    closes = (
        AquacultureDataBankPondClose.objects.filter(company_id=company_id)
        .select_related("pond")
        .order_by("-period_end", "-id")
    )
    closes_by_pond: dict[int, list] = {}
    for c in closes:
        closes_by_pond.setdefault(c.pond_id, []).append(pond_close_to_dict(c))

    pond_rows = []
    for p in ponds:
        history = closes_by_pond.get(p.id, [])
        latest = history[0] if history else None
        pond_rows.append(
            {
                "pond_id": p.id,
                "pond_name": p.name,
                "pond_code": p.code or "",
                "is_active": p.is_active,
                "is_currently_locked": bool(latest and latest["is_data_locked"]),
                "reference_access_enabled": bool(
                    latest and latest["reference_access_enabled"]
                ),
                "latest_close": latest,
                "close_history": history,
            }
        )

    return {
        "ponds": pond_rows,
        "closes": [pond_close_to_dict(c) for c in closes],
    }


def preview_station_close(
    company: Company,
    station: Station,
    period_end: date,
    period_start: date | None = None,
) -> dict:
    if period_start is None:
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
    elif period_start > period_end:
        raise ValueError("period_start must be on or before period_end.")
    pond_ids = pond_ids_for_station(company.id, station.id)
    ponds = list(
        AquaculturePond.objects.filter(pk__in=pond_ids).order_by("sort_order", "id")
    )
    open_pond_ids = [
        p.id
        for p in ponds
        if not _active_close_qs(company.id, p.id).exists()
    ]
    pond_previews = [
        preview_pond_close(company, p, period_end, period_start) for p in ponds
    ]
    ready_count = sum(1 for p in pond_previews if p.get("is_ready"))
    return {
        "station_id": station.id,
        "station_name": station.station_name or "",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "label": default_station_period_label(station.station_name, period_start, period_end),
        "pond_count": len(pond_ids),
        "open_pond_count": len(open_pond_ids),
        "ready_pond_count": ready_count,
        "not_ready_pond_count": len(pond_previews) - ready_count,
        "lease_continues_note": _YEAR_CLOSE_LEASE_NOTE,
        "ponds": pond_previews,
    }


def preview_pond_close(
    company: Company,
    pond: AquaculturePond,
    period_end: date,
    period_start: date | None = None,
) -> dict:
    if period_start is None:
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
    elif period_start > period_end:
        raise ValueError("period_start must be on or before period_end.")
    readiness = pond_year_close_readiness(company.id, pond.id, period_end)
    return {
        "pond_id": pond.id,
        "pond_name": pond.name,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "label": default_period_label(pond.name, period_start, period_end),
        "settlement_fish_count": readiness["settlement_fish_count"],
        "settlement_weight_kg": readiness["settlement_weight_kg"],
        "settlement_bioasset_value": readiness["settlement_bioasset_value"],
        "is_ready": readiness["is_ready"],
        "blockers": readiness["blockers"],
        "actions": readiness["actions"],
        "open_production_cycle_count": readiness["open_production_cycle_count"],
        "warehouse_stock_lines": readiness["warehouse_stock_lines"],
        "lease_continues_note": readiness["lease_continues_note"],
    }


def close_pond(
    *,
    company_id: int,
    pond_id: int,
    period_end: date,
    user,
    period_start: date | None = None,
    label: str = "",
    notes: str = "",
) -> tuple[AquacultureDataBankPondClose | None, str | None]:
    """Close one pond for the given period end (and optional custom period start)."""
    company = Company.objects.filter(pk=company_id).first()
    if not company:
        return None, "Company not found."
    if not getattr(company, "aquaculture_enabled", False):
        return None, "Aquaculture module is not enabled for this company."

    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return None, "Pond not found."

    if period_start is None:
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
    elif period_start > period_end:
        return None, "period_start must be on or before period_end."

    if AquacultureDataBankPondClose.objects.filter(pond_id=pond_id, period_end=period_end).exists():
        return None, (
            f"This pond already has a year close ending {period_end.isoformat()}."
        )

    display_label = (label or "").strip() or default_period_label(
        pond.name, period_start, period_end
    )

    readiness = pond_year_close_readiness(company_id, pond_id, period_end)
    if not readiness["is_ready"]:
        detail = " ".join(readiness["blockers"])
        return None, (
            f"Pond is not ready for year close. {detail} "
            f"{_YEAR_CLOSE_LEASE_NOTE}"
        )

    settlement = pond_biological_settlement(company_id, pond_id, period_end)

    with transaction.atomic():
        _end_open_production_cycles_on_close(
            company_id, pond_id, period_end, display_label
        )
        # Only one active operational lock per pond; prior closes stay in history.
        AquacultureDataBankPondClose.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            is_data_locked=True,
        ).update(is_data_locked=False, reference_access_enabled=False)
        close = AquacultureDataBankPondClose.objects.create(
            company_id=company_id,
            pond=pond,
            label=display_label[:120],
            period_start=period_start,
            period_end=period_end,
            status=AquacultureDataBankPondClose.STATUS_CLOSED,
            is_data_locked=True,
            reference_access_enabled=False,
            closed_by_user_id=_actor_user_id(user),
            notes=(notes or "")[:5000],
            settlement_fish_count=settlement["settlement_fish_count"],
            settlement_weight_kg=settlement["settlement_weight_kg"],
            settlement_bioasset_value=settlement["settlement_bioasset_value"],
        )
    close = AquacultureDataBankPondClose.objects.select_related("pond").get(pk=close.pk)
    return close, None


def close_station(
    *,
    company_id: int,
    station_id: int,
    period_end: date,
    user,
    period_start: date | None = None,
    notes: str = "",
) -> tuple[dict | None, str | None]:
    """Close every pond linked to the shop station for the same fiscal period."""
    company = Company.objects.filter(pk=company_id).first()
    if not company:
        return None, "Company not found."
    if not getattr(company, "aquaculture_enabled", False):
        return None, "Aquaculture module is not enabled for this company."

    station = Station.objects.filter(pk=station_id, company_id=company_id).first()
    if not station:
        return None, "Station not found."

    pond_ids = pond_ids_for_station(company_id, station_id)
    if not pond_ids:
        return None, "No ponds are linked to this station."

    if period_start is None:
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
    elif period_start > period_end:
        return None, "period_start must be on or before period_end."

    closed: list[dict] = []
    errors: list[dict] = []
    for pond_id in pond_ids:
        close, err = close_pond(
            company_id=company_id,
            pond_id=pond_id,
            period_end=period_end,
            period_start=period_start,
            user=user,
            notes=notes,
        )
        if err:
            pond = AquaculturePond.objects.filter(pk=pond_id).only("name").first()
            errors.append(
                {
                    "pond_id": pond_id,
                    "pond_name": (pond.name if pond else ""),
                    "detail": err,
                }
            )
        else:
            closed.append(pond_close_to_dict(close))

    if not closed:
        first = errors[0]["detail"] if errors else "No ponds could be closed."
        return None, first

    station_name = (station.station_name or "").strip() or f"Station {station.id}"
    msg = (
        f"Closed {len(closed)} pond(s) at {station_name} "
        f"({period_start.isoformat()} – {period_end.isoformat()})."
    )
    if errors:
        msg += f" {len(errors)} pond(s) skipped."
    return {
        "station_id": station.id,
        "station_name": station_name,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "closed": closed,
        "errors": errors,
        "message": msg,
    }, None


def reopen_close_for_reference(
    *,
    company_id: int,
    close_id: int,
    user,
    reason: str = "",
) -> tuple[AquacultureDataBankPondClose | None, str | None]:
    close = (
        AquacultureDataBankPondClose.objects.filter(pk=close_id, company_id=company_id)
        .select_related("pond")
        .first()
    )
    if not close:
        return None, "Pond close record not found."
    if close.reference_access_enabled:
        return close, None
    now = timezone.now()
    close.reference_access_enabled = True
    close.reopened_at = now
    close.reopened_by_user_id = _actor_user_id(user)
    close.reopen_reason = (reason or "")[:2000]
    close.relocked_at = None
    close.relocked_by_user_id = None
    close.save(
        update_fields=[
            "reference_access_enabled",
            "reopened_at",
            "reopened_by_user_id",
            "reopen_reason",
            "relocked_at",
            "relocked_by_user_id",
        ]
    )
    return close, None


def unlock_pond_close(
    *,
    company_id: int,
    close_id: int,
    user,
) -> tuple[AquacultureDataBankPondClose | None, str | None]:
    """
    Remove the operational write lock for a pond close (e.g. test year close).
    The close record stays in history; pond structure was never locked.
    """
    close = (
        AquacultureDataBankPondClose.objects.filter(pk=close_id, company_id=company_id)
        .select_related("pond")
        .first()
    )
    if not close:
        return None, "Pond close record not found."
    if not close.is_data_locked and not close.reference_access_enabled:
        return close, None
    close.is_data_locked = False
    close.reference_access_enabled = False
    close.relocked_at = timezone.now()
    close.relocked_by_user_id = _actor_user_id(user)
    close.save(
        update_fields=[
            "is_data_locked",
            "reference_access_enabled",
            "relocked_at",
            "relocked_by_user_id",
        ]
    )
    return close, None


def relock_close(
    *,
    company_id: int,
    close_id: int,
    user,
) -> tuple[AquacultureDataBankPondClose | None, str | None]:
    close = (
        AquacultureDataBankPondClose.objects.filter(pk=close_id, company_id=company_id)
        .select_related("pond")
        .first()
    )
    if not close:
        return None, "Pond close record not found."
    if not close.reference_access_enabled:
        return close, None
    now = timezone.now()
    close.reference_access_enabled = False
    close.relocked_at = now
    close.relocked_by_user_id = _actor_user_id(user)
    close.save(
        update_fields=["reference_access_enabled", "relocked_at", "relocked_by_user_id"]
    )
    return close, None


def assert_ponds_writable(company_id: int, pond_ids: list[int], transaction_date: date | None = None) -> str | None:
    seen: set[int] = set()
    for pid in pond_ids:
        if not pid or pid in seen:
            continue
        seen.add(pid)
        detail = pond_write_blocked_detail(company_id, pid, transaction_date)
        if detail:
            return detail
    return None
