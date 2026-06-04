"""Aquaculture Data Bank: per-pond year close, locks, and reference reopen."""
from __future__ import annotations

from datetime import date, timedelta
from typing import TypeVar

from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone

from api.models import (
    AquacultureDataBankPondClose,
    AquaculturePond,
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
    if start > period_end:
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
    return {
        "station_id": station.id,
        "station_name": station.station_name or "",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "label": default_station_period_label(station.station_name, period_start, period_end),
        "pond_count": len(pond_ids),
        "open_pond_count": len(open_pond_ids),
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
    settlement = pond_biological_settlement(company.id, pond.id, period_end)
    return {
        "pond_id": pond.id,
        "pond_name": pond.name,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "label": default_period_label(pond.name, period_start, period_end),
        "settlement_fish_count": settlement["settlement_fish_count"],
        "settlement_weight_kg": str(settlement["settlement_weight_kg"]),
        "settlement_bioasset_value": str(settlement["settlement_bioasset_value"]),
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

    settlement = pond_biological_settlement(company_id, pond_id, period_end)

    with transaction.atomic():
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
