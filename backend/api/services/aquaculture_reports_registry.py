"""
Aquaculture report payloads for GET /api/reports/<report_id>/ (Reports module).
All monetary amounts are BDT for display consistency (currency_code on payload).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Sum

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishSale,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_constants import (
    EXPENSE_CATEGORY_LABELS,
    INCOME_TYPE_LABELS,
    fish_species_display_label,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.permission_service import user_may_access_aquaculture_api
from django.http import HttpRequest, JsonResponse


BDT = "BDT"


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _decimal(s: str) -> Decimal:
    try:
        return Decimal(str(s))
    except Exception:
        return Decimal("0")


def _pond_filter(company_id: int, raw: str | None) -> tuple[int | None, JsonResponse | None]:
    if not raw or not str(raw).strip().isdigit():
        return None, None
    pid = int(raw)
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
        return None, JsonResponse({"detail": "Pond not found"}, status=404)
    return pid, None


def _cycle_filter(company_id: int, raw: str | None) -> tuple[int | None, AquacultureProductionCycle | None, JsonResponse | None]:
    if not raw or not str(raw).strip().isdigit():
        return None, None, None
    cid = int(raw)
    cyc = AquacultureProductionCycle.objects.filter(pk=cid, company_id=company_id).first()
    if not cyc:
        return None, None, JsonResponse({"detail": "Production cycle not found"}, status=404)
    return cid, cyc, None


def aquaculture_gate(company_id: int, user) -> JsonResponse | None:
    c = Company.objects.filter(pk=company_id).only("aquaculture_enabled").first()
    if not c or not getattr(c, "aquaculture_enabled", False):
        return JsonResponse(
            {"detail": "Aquaculture is not enabled for this company."},
            status=403,
        )
    if not user_may_access_aquaculture_api(user):
        return JsonResponse(
            {"detail": "Aquaculture reports are only available to the company Admin account for this tenant."},
            status=403,
        )
    return None


def _period_block(start: date, end: date) -> dict[str, str]:
    return {"start_date": start.isoformat(), "end_date": end.isoformat()}


def build_aquaculture_report(
    report_id: str, company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    user = getattr(request, "api_user", None)
    gate = aquaculture_gate(company_id, user)
    if gate:
        return gate

    if report_id == "aquaculture-pond-pl":
        return _report_pond_pl(company_id, start, end, request)
    if report_id == "aquaculture-fish-sales":
        return _report_fish_sales(company_id, start, end, request)
    if report_id == "aquaculture-expenses":
        return _report_expenses(company_id, start, end, request)
    if report_id == "aquaculture-sampling":
        return _report_sampling(company_id, start, end, request)
    if report_id == "aquaculture-production-cycles":
        return _report_production_cycles(company_id, start, end, request)
    if report_id == "aquaculture-profit-transfers":
        return _report_profit_transfers(company_id, start, end, request)
    return JsonResponse({"detail": "Unknown aquaculture report"}, status=404)


def _report_pond_pl(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    cycle_filter_id, scoped_cycle, cerr = _cycle_filter(company_id, request.GET.get("cycle_id"))
    if cerr:
        return cerr
    if cycle_filter_id is not None and pond_filter_id is not None and scoped_cycle and scoped_cycle.pond_id != pond_filter_id:
        return JsonResponse({"detail": "cycle_id does not belong to the selected pond"}, status=400)
    if cycle_filter_id is not None and scoped_cycle:
        pond_filter_id = scoped_cycle.pond_id

    include_cycle_breakdown = str(request.GET.get("include_cycle_breakdown", "")).lower() in ("1", "true", "yes")

    base = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        pond_filter_id,
        cycle_filter_id,
        scoped_cycle,
        include_cycle_breakdown,
    )
    t = base.get("totals") or {}
    summary = {
        "total_revenue_bdt": float(Decimal(str(t.get("revenue", "0")))),
        "total_operating_expenses_bdt": float(Decimal(str(t.get("operating_expenses", "0")))),
        "total_payroll_allocated_bdt": float(Decimal(str(t.get("payroll_allocated", "0")))),
        "net_profit_bdt": float(Decimal(str(t.get("profit", "0")))),
    }
    base["period"] = _period_block(start, end)
    base["currency_code"] = BDT
    base["summary"] = summary
    base["filter"] = {
        "pond_id": pond_filter_id,
        "cycle_id": cycle_filter_id,
        "include_cycle_breakdown": include_cycle_breakdown,
    }
    return base


def _report_fish_sales(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureFishSale.objects.filter(
            company_id=company_id,
            sale_date__gte=start,
            sale_date__lte=end,
        )
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "sale_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for s in qs:
        sp = getattr(s, "fish_species", None) or "tilapia"
        spo = getattr(s, "fish_species_other", None) or ""
        by_pond[s.pond_id].append(
            {
                "id": s.id,
                "sale_date": s.sale_date.isoformat(),
                "income_type": s.income_type,
                "income_type_label": INCOME_TYPE_LABELS.get(s.income_type, s.income_type),
                "fish_species": sp,
                "fish_species_other": spo,
                "fish_species_label": fish_species_display_label(sp, spo),
                "production_cycle_name": (s.production_cycle.name or "").strip() if s.production_cycle_id else "",
                "weight_kg": str(s.weight_kg),
                "fish_count": s.fish_count,
                "total_amount": str(s.total_amount),
                "buyer_name": s.buyer_name or "",
                "memo": (s.memo or "")[:200],
            }
        )
        pond_names[s.pond_id] = (s.pond.name or "").strip() if s.pond_id else ""

    groups: list[dict[str, Any]] = []
    grand_amt = Decimal("0")
    grand_wt = Decimal("0")
    grand_lines = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub_a = _money_q(sum((_decimal(l["total_amount"]) for l in lines), Decimal("0")))
        sub_w = _money_q(sum((_decimal(l["weight_kg"]) for l in lines), Decimal("0")))
        grand_amt += sub_a
        grand_wt += sub_w
        grand_lines += len(lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_amount": str(sub_a),
                "subtotal_weight_kg": str(sub_w),
                "line_count": len(lines),
            }
        )

    summary = {
        "total_amount_bdt": float(grand_amt),
        "total_weight_kg": float(grand_wt),
        "line_count": grand_lines,
        "pond_group_count": len(groups),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "total_amount": str(grand_amt),
            "total_weight_kg": str(grand_wt),
            "line_count": grand_lines,
        },
    }


def _report_expenses(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            expense_date__gte=start,
            expense_date__lte=end,
        )
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .order_by("pond_id", "expense_date", "id")
    )
    rows: list[AquacultureExpense] = list(qs)

    def sort_key(e: AquacultureExpense):
        pid = e.pond_id if e.pond_id is not None else -1
        return (pid, e.expense_date, e.id)

    rows.sort(key=sort_key)

    by_pond: dict[int | None, list[dict]] = defaultdict(list)
    pond_names: dict[int | None, str] = {}

    for e in rows:
        if e.pond_id is None:
            pname = "Shared (allocated to ponds)"
            pid: int | None = None
        else:
            pid = e.pond_id
            pname = (e.pond.name or "").strip() if e.pond else f"Pond #{e.pond_id}"
        pond_names[pid] = pname
        shares_out = []
        if e.pond_id is None:
            for sh in e.pond_shares.all():
                pn = (sh.pond.name or "").strip() if getattr(sh, "pond", None) else f"Pond #{sh.pond_id}"
                shares_out.append({"pond_id": sh.pond_id, "pond_name": pn, "amount": str(sh.amount)})
        by_pond[pid].append(
            {
                "id": e.id,
                "expense_date": e.expense_date.isoformat(),
                "expense_category": e.expense_category,
                "expense_category_label": EXPENSE_CATEGORY_LABELS.get(e.expense_category, e.expense_category),
                "amount": str(e.amount),
                "vendor_name": e.vendor_name or "",
                "memo": (e.memo or "")[:200],
                "production_cycle_name": (e.production_cycle.name or "").strip() if e.production_cycle_id else "",
                "is_shared_header": e.pond_id is None,
                "pond_allocations": shares_out,
                "source_station_id": e.source_station_id,
                "source_station_name": (e.source_station.station_name or "").strip()
                if getattr(e, "source_station_id", None) and getattr(e, "source_station", None)
                else "",
            }
        )

    groups: list[dict[str, Any]] = []
    grand = Decimal("0")
    grand_n = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (-1 if x is None else x)):
        lines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in lines), Decimal("0")))
        grand += sub
        grand_n += len(lines)
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, "Shared"),
                "lines": lines,
                "subtotal_amount": str(sub),
                "line_count": len(lines),
            }
        )

    summary = {
        "total_expense_bdt": float(grand),
        "line_count": grand_n,
        "pond_group_count": len(groups),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(grand), "line_count": grand_n},
    }


def _report_sampling(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            sample_date__gte=start,
            sample_date__lte=end,
        )
        .select_related("pond")
        .order_by("pond_id", "-sample_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for b in qs:
        sp = getattr(b, "fish_species", None) or "tilapia"
        spo = getattr(b, "fish_species_other", None) or ""
        by_pond[b.pond_id].append(
            {
                "id": b.id,
                "sample_date": b.sample_date.isoformat(),
                "fish_species": sp,
                "fish_species_other": spo,
                "fish_species_label": fish_species_display_label(sp, spo),
                "estimated_fish_count": b.estimated_fish_count,
                "estimated_total_weight_kg": str(b.estimated_total_weight_kg) if b.estimated_total_weight_kg is not None else "",
                "avg_weight_kg": str(b.avg_weight_kg) if b.avg_weight_kg is not None else "",
                "notes": (b.notes or "")[:200],
            }
        )
        pond_names[b.pond_id] = (b.pond.name or "").strip() if b.pond_id else ""

    groups: list[dict[str, Any]] = []
    total_samples = 0
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        total_samples += len(lines)
        wt_sum = Decimal("0")
        for ln in lines:
            if ln.get("estimated_total_weight_kg"):
                wt_sum += _decimal(str(ln["estimated_total_weight_kg"]))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_samples": len(lines),
                "subtotal_estimated_weight_kg": str(_money_q(wt_sum)) if wt_sum != 0 else "0",
            }
        )

    summary = {"sample_count": total_samples, "pond_group_count": len(groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"sample_count": total_samples},
    }


def _report_production_cycles(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = AquacultureProductionCycle.objects.filter(company_id=company_id).select_related("pond").order_by(
        "pond_id", "sort_order", "-start_date", "id"
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    lines: list[dict[str, Any]] = []
    by_pond: dict[int, list[dict]] = defaultdict(list)
    for c in qs:
        if c.end_date and c.end_date < start:
            continue
        if c.start_date > end:
            continue
        row = {
            "id": c.id,
            "pond_id": c.pond_id,
            "pond_name": (c.pond.name or "").strip() if c.pond_id else "",
            "name": c.name,
            "code": c.code or "",
            "start_date": c.start_date.isoformat(),
            "end_date": c.end_date.isoformat() if c.end_date else "",
            "is_active": c.is_active,
            "notes": (c.notes or "")[:200],
        }
        lines.append(row)
        by_pond[c.pond_id].append(row)

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (by_pond[x][0].get("pond_name", ""), x)):
        glines = by_pond[pid]
        groups.append(
            {
                "pond_id": pid,
                "pond_name": glines[0].get("pond_name", f"Pond #{pid}"),
                "lines": glines,
                "subtotal_cycles": len(glines),
            }
        )

    summary = {"cycle_count": len(lines), "pond_group_count": len(groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "lines": lines,
        "groups": groups,
        "totals": {"cycle_count": len(lines)},
    }


def _report_profit_transfers(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquaculturePondProfitTransfer.objects.filter(
            company_id=company_id,
            transfer_date__gte=start,
            transfer_date__lte=end,
        )
        .select_related("pond", "production_cycle", "debit_account", "credit_account", "journal_entry")
        .order_by("pond_id", "-transfer_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(pond_id=pond_filter_id)

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {}
    for t in qs:
        row = {
            "id": t.id,
            "transfer_date": t.transfer_date.isoformat(),
            "amount": str(t.amount),
            "memo": (t.memo or "")[:200],
            "production_cycle_name": (t.production_cycle.name or "").strip() if t.production_cycle_id else "",
            "debit_account_code": (t.debit_account.account_code or "") if t.debit_account_id else "",
            "debit_account_name": (t.debit_account.account_name or "") if t.debit_account_id else "",
            "credit_account_code": (t.credit_account.account_code or "") if t.credit_account_id else "",
            "credit_account_name": (t.credit_account.account_name or "") if t.credit_account_id else "",
            "journal_entry_number": (t.journal_entry.entry_number if t.journal_entry_id and t.journal_entry else ""),
        }
        by_pond[t.pond_id].append(row)
        pond_names[t.pond_id] = (t.pond.name or "").strip() if t.pond_id else ""

    groups: list[dict[str, Any]] = []
    grand = Decimal("0")
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        lines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in lines), Decimal("0")))
        grand += sub
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": lines,
                "subtotal_amount": str(sub),
                "line_count": len(lines),
            }
        )

    summary = {"total_transfers_bdt": float(grand), "line_count": sum(len(g["lines"]) for g in groups)}
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {"total_amount": str(grand), "line_count": summary["line_count"]},
    }
