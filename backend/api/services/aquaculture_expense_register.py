"""Unified pond cost register: manual/shop AquacultureExpense rows + vendor bill pond lines."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Q

from api.models import AquacultureExpense, BillLine
from api.services.aquaculture_bill_defaults import expense_category_from_cost_bucket
from api.services.tenant_reporting_categories import (
    APP_AQUACULTURE,
    aquaculture_expense_label,
)


def _parse_iso_date(raw: str | None) -> date | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return date.fromisoformat(str(raw).strip()[:10])
    except ValueError:
        return None


def _vendor_display(vendor) -> str:
    if not vendor:
        return ""
    for attr in ("display_name", "company_name", "vendor_number"):
        val = (getattr(vendor, attr, None) or "").strip()
        if val:
            return val
    return f"Vendor #{getattr(vendor, 'id', '')}"


def _expense_code_for_bill_line(line: BillLine) -> str:
    trc = getattr(line, "tenant_reporting_category", None)
    if trc and getattr(trc, "application", None) == APP_AQUACULTURE:
        code = (getattr(trc, "code", None) or "").strip()
        if code:
            return code
    bucket = (getattr(line, "aquaculture_cost_bucket", None) or "").strip()
    cat = expense_category_from_cost_bucket(bucket)
    return cat or "vendor_bill_pond"


def expense_row_from_model(x: AquacultureExpense) -> dict:
    pond_name = ""
    if x.pond_id and getattr(x, "pond", None):
        pond_name = (x.pond.name or "").strip()
    shares = []
    for sh in x.pond_shares.all():
        pname = ""
        if getattr(sh, "pond", None):
            pname = (sh.pond.name or "").strip()
        shares.append({"pond_id": sh.pond_id, "pond_name": pname, "amount": str(sh.amount)})
    shares.sort(key=lambda r: r["pond_id"])
    cname = ""
    cid_cycle = None
    if x.production_cycle_id and getattr(x, "production_cycle", None):
        cid_cycle = x.production_cycle_id
        cname = (x.production_cycle.name or "").strip()
    src_sid = getattr(x, "source_station_id", None)
    src_sname = ""
    if src_sid and getattr(x, "source_station", None):
        src_sname = (x.source_station.station_name or "").strip()
    return {
        "source": "expense",
        "id": int(x.id),
        "bill_id": None,
        "bill_number": "",
        "pond_id": x.pond_id,
        "pond_name": pond_name,
        "is_shared": x.pond_id is None,
        "pond_shares": shares,
        "production_cycle_id": cid_cycle,
        "production_cycle_name": cname,
        "expense_category": x.expense_category,
        "expense_category_label": aquaculture_expense_label(x.company_id, x.expense_category),
        "expense_date": x.expense_date.isoformat(),
        "amount": str(x.amount),
        "memo": x.memo or "",
        "vendor_name": x.vendor_name or "",
        "source_station_id": src_sid,
        "source_station_name": src_sname,
        "feed_sack_count": str(x.feed_sack_count) if getattr(x, "feed_sack_count", None) is not None else None,
        "feed_weight_kg": str(x.feed_weight_kg) if getattr(x, "feed_weight_kg", None) is not None else None,
        "funding_account_code": getattr(x, "funding_account_code", "") or "",
        "created_at": x.created_at.isoformat() if x.created_at else "",
    }


def expense_row_from_bill_line(*, company_id: int, line: BillLine) -> dict:
    bill = line.bill
    pond = getattr(line, "aquaculture_pond", None)
    cycle = getattr(line, "aquaculture_production_cycle", None)
    cat = _expense_code_for_bill_line(line)
    vendor = getattr(bill, "vendor", None)
    desc = (line.description or "").strip()
    bill_memo = (getattr(bill, "memo", None) or "").strip()
    memo = desc or bill_memo
    return {
        "source": "bill",
        "id": int(line.id),
        "bill_id": int(bill.id),
        "bill_number": (bill.bill_number or "").strip(),
        "pond_id": line.aquaculture_pond_id,
        "pond_name": (pond.name or "").strip() if pond else "",
        "is_shared": False,
        "pond_shares": [],
        "production_cycle_id": line.aquaculture_production_cycle_id,
        "production_cycle_name": (cycle.name or "").strip() if cycle else "",
        "expense_category": cat,
        "expense_category_label": aquaculture_expense_label(company_id, cat),
        "expense_date": bill.bill_date.isoformat(),
        "amount": str(line.amount),
        "memo": memo,
        "vendor_name": _vendor_display(vendor),
        "source_station_id": None,
        "source_station_name": "",
        "feed_sack_count": None,
        "feed_weight_kg": (
            str(line.aquaculture_fish_weight_kg)
            if getattr(line, "aquaculture_fish_weight_kg", None) is not None
            else None
        ),
        "funding_account_code": "",
        "created_at": bill.created_at.isoformat() if getattr(bill, "created_at", None) else "",
        "bill_status": (bill.status or "").strip(),
    }


def list_aquaculture_expense_register(
    company_id: int,
    *,
    pond_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
) -> dict:
    expense_qs = (
        AquacultureExpense.objects.filter(company_id=company_id)
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
    )
    if pond_id is not None:
        expense_qs = expense_qs.filter(Q(pond_id=pond_id) | Q(pond_shares__pond_id=pond_id)).distinct()
    if date_from is not None:
        expense_qs = expense_qs.filter(expense_date__gte=date_from)
    if date_to is not None:
        expense_qs = expense_qs.filter(expense_date__lte=date_to)

    bill_qs = (
        BillLine.objects.filter(
            bill__company_id=company_id,
            aquaculture_pond_id__isnull=False,
        )
        .exclude(bill__status__iexact="void")
        .select_related(
            "bill",
            "bill__vendor",
            "aquaculture_pond",
            "aquaculture_production_cycle",
            "tenant_reporting_category",
        )
    )
    if pond_id is not None:
        bill_qs = bill_qs.filter(aquaculture_pond_id=pond_id)
    if date_from is not None:
        bill_qs = bill_qs.filter(bill__bill_date__gte=date_from)
    if date_to is not None:
        bill_qs = bill_qs.filter(bill__bill_date__lte=date_to)

    expense_rows = [expense_row_from_model(x) for x in expense_qs]
    bill_rows = [expense_row_from_bill_line(company_id=company_id, line=ln) for ln in bill_qs]

    merged = expense_rows + bill_rows
    merged.sort(key=lambda r: (r.get("expense_date") or "", r.get("source") or "", r.get("id") or 0), reverse=True)
    if limit > 0:
        merged = merged[:limit]

    total = Decimal("0")
    for row in merged:
        try:
            total += Decimal(str(row.get("amount") or "0"))
        except Exception:
            pass
    total = total.quantize(Decimal("0.01"))

    return {
        "rows": merged,
        "total_amount": str(total),
        "count": len(merged),
    }


def parse_register_date_filters(*, date_from_raw: str | None, date_to_raw: str | None) -> tuple[date | None, date | None]:
    return _parse_iso_date(date_from_raw), _parse_iso_date(date_to_raw)
