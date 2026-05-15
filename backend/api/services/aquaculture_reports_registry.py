"""
Aquaculture report payloads for GET /api/reports/<report_id>/ (Reports module).
All monetary amounts are BDT for display consistency (currency_code on payload).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from django.db import models
from django.db.models import Sum

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishSale,
    AquaculturePond,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    Company,
    Invoice,
    InvoiceLine,
)
from api.services.aquaculture_constants import (
    EXPENSE_CATEGORY_LABELS,
    INCOME_TYPE_LABELS,
    fish_species_display_label,
)
from api.services.reporting import _is_fuel_line
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
            {"detail": "Aquaculture reports require Admin or app.aquaculture permission for this tenant."},
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
    if report_id == "aquaculture-pond-sales-comprehensive":
        return _report_pond_sales_comprehensive(company_id, start, end, request)
    if report_id == "aquaculture-expenses":
        return _report_expenses(company_id, start, end, request)
    if report_id == "aquaculture-sampling":
        return _report_sampling(company_id, start, end, request)
    if report_id == "aquaculture-production-cycles":
        return _report_production_cycles(company_id, start, end, request)
    if report_id == "aquaculture-profit-transfers":
        return _report_profit_transfers(company_id, start, end, request)
    if report_id == "aquaculture-fish-transfers":
        return _report_fish_transfers(company_id, start, end, request)
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


def _report_pos_pond_shop_sales(
    company_id: int, start: date, end: date, pond_filter_id: int | None
) -> dict[str, Any]:
    """
    Invoices (non-draft) to each pond's linked POS customer; excludes motor-fuel-classified lines
    (same rule as fuel-sales report).
    """
    pond_q = AquaculturePond.objects.filter(company_id=company_id).exclude(pos_customer_id__isnull=True)
    if pond_filter_id is not None:
        pond_q = pond_q.filter(pk=pond_filter_id)
    ponds = list(pond_q.only("id", "name", "pos_customer_id"))
    cust_to_pond: dict[int, AquaculturePond] = {}
    for p in ponds:
        cid_cust = getattr(p, "pos_customer_id", None)
        if cid_cust:
            cust_to_pond[int(cid_cust)] = p
    if not cust_to_pond:
        return {
            "groups": [],
            "totals": {"total_amount": "0.00", "line_count": 0},
            "summary": {"total_amount_bdt": 0.0, "line_count": 0, "pond_group_count": 0},
        }

    inv_qs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
            customer_id__in=list(cust_to_pond.keys()),
        )
        .exclude(status="draft")
        .select_related("station", "customer")
    )
    inv_ids = list(inv_qs.values_list("id", flat=True))
    lines = (
        InvoiceLine.objects.filter(invoice_id__in=inv_ids)
        .select_related("item", "invoice", "invoice__station")
        .order_by("invoice_id", "id")
    )

    by_pond: dict[int, list[dict]] = defaultdict(list)
    pond_names: dict[int, str] = {p.id: (p.name or "").strip() for p in ponds}

    grand_amt = Decimal("0")
    grand_n = 0
    for line in lines:
        if _is_fuel_line(line):
            continue
        inv = line.invoice
        cust_id = inv.customer_id
        pond = cust_to_pond.get(cust_id)
        if not pond:
            continue
        pid = pond.id
        it = line.item
        amt = line.amount or Decimal("0")
        grand_amt += amt
        grand_n += 1
        st = inv.station
        st_name = (st.station_name or "").strip() if st else ""
        by_pond[pid].append(
            {
                "id": line.id,
                "invoice_id": inv.id,
                "invoice_number": inv.invoice_number or "",
                "invoice_date": inv.invoice_date.isoformat(),
                "invoice_status": inv.status or "",
                "station_name": st_name,
                "item_id": it.id if it else None,
                "item_name": ((it.name if it else "") or (line.description or ""))[:200],
                "item_number": (it.item_number or "") if it else "",
                "pos_category": (it.pos_category or "") if it else "",
                "reporting_category": (it.category or "") if it else "",
                "quantity": str(line.quantity or 0),
                "amount": str(amt),
                "line_description": (line.description or "")[:200],
            }
        )

    groups: list[dict[str, Any]] = []
    for pid in sorted(by_pond.keys(), key=lambda x: (pond_names.get(x, ""), x)):
        plines = by_pond[pid]
        sub = _money_q(sum((_decimal(l["amount"]) for l in plines), Decimal("0")))
        groups.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond #{pid}"),
                "lines": plines,
                "subtotal_amount": str(sub),
                "line_count": len(plines),
            }
        )

    g_amt = _money_q(grand_amt)
    summary = {
        "total_amount_bdt": float(g_amt),
        "line_count": grand_n,
        "pond_group_count": len(groups),
    }
    return {
        "groups": groups,
        "totals": {"total_amount": str(g_amt), "line_count": grand_n},
        "summary": summary,
    }


def _report_pond_sales_comprehensive(
    company_id: int, start: date, end: date, request: HttpRequest
) -> dict[str, Any] | JsonResponse:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr

    fish = _report_fish_sales(company_id, start, end, request)
    if isinstance(fish, JsonResponse):
        return fish

    pos = _report_pos_pond_shop_sales(company_id, start, end, pond_filter_id)

    fish_amt = _decimal(fish["totals"]["total_amount"])
    pos_amt = _decimal(pos["totals"]["total_amount"])
    combined = _money_q(fish_amt + pos_amt)

    by_income: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": Decimal("0"), "n": 0})
    for g in fish["groups"]:
        for ln in g["lines"]:
            k = str(ln.get("income_type") or "")
            by_income[k]["amount"] += _decimal(ln["total_amount"])
            by_income[k]["n"] += 1

    fish_by_income_type = [
        {
            "income_type": k,
            "income_type_label": INCOME_TYPE_LABELS.get(k, k or "—"),
            "amount_bdt": float(_money_q(v["amount"])),
            "line_count": v["n"],
        }
        for k, v in sorted(by_income.items(), key=lambda x: (x[0] or ""))
    ]

    return {
        "period": fish["period"],
        "currency_code": BDT,
        "summary": {
            "fish_total_amount_bdt": fish["summary"]["total_amount_bdt"],
            "pos_non_fuel_total_amount_bdt": pos["summary"]["total_amount_bdt"],
            "combined_total_amount_bdt": float(combined),
            "fish_line_count": fish["summary"]["line_count"],
            "pos_non_fuel_line_count": pos["summary"]["line_count"],
            "fish_by_income_type": fish_by_income_type,
        },
        "fish_sales": {"groups": fish["groups"], "totals": fish["totals"], "summary": fish["summary"]},
        "pos_shop_sales": pos,
        "accounting_note": (
            "Fish: all Aquaculture pond income lines in the period (every income_type). "
            "POS: invoices to each pond's linked POS customer; lines classified as motor fuel are excluded."
        ),
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
                "stock_reference_fish_count": b.stock_reference_fish_count,
                "stock_reference_avg_weight_kg": (
                    str(b.stock_reference_avg_weight_kg) if b.stock_reference_avg_weight_kg is not None else ""
                ),
                "extrapolated_biomass_kg": str(b.extrapolated_biomass_kg) if b.extrapolated_biomass_kg is not None else "",
                "biomass_gain_kg": str(b.biomass_gain_kg) if b.biomass_gain_kg is not None else "",
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


def _report_fish_transfers(company_id: int, start: date, end: date, request: HttpRequest) -> dict[str, Any]:
    pond_filter_id, perr = _pond_filter(company_id, request.GET.get("pond_id"))
    if perr:
        return perr
    qs = (
        AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            transfer_date__gte=start,
            transfer_date__lte=end,
        )
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .order_by("-transfer_date", "-id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(
            models.Q(from_pond_id=pond_filter_id) | models.Q(lines__to_pond_id=pond_filter_id)
        ).distinct()

    groups: list[dict[str, Any]] = []
    grand_wt = Decimal("0")
    grand_cost = Decimal("0")
    grand_lines = 0
    for t in qs:
        from_name = (t.from_pond.name or "").strip() if t.from_pond_id else ""
        line_rows: list[dict[str, Any]] = []
        sub_wt = Decimal("0")
        sub_cost = Decimal("0")
        for ln in t.lines.all():
            wt = ln.weight_kg or Decimal("0")
            cost = ln.cost_amount or Decimal("0")
            sub_wt += wt
            sub_cost += cost
            to_name = (ln.to_pond.name or "").strip() if ln.to_pond_id else ""
            line_rows.append(
                {
                    "id": ln.id,
                    "to_pond_id": ln.to_pond_id,
                    "to_pond_name": to_name,
                    "to_cycle_name": (
                        (ln.to_production_cycle.name or "").strip()
                        if ln.to_production_cycle_id
                        else ""
                    ),
                    "weight_kg": str(wt),
                    "fish_count": ln.fish_count,
                    "cost_amount": str(cost),
                }
            )
        grand_wt += sub_wt
        grand_cost += sub_cost
        grand_lines += len(line_rows)
        sp = getattr(t, "fish_species", None) or "tilapia"
        spo = getattr(t, "fish_species_other", None) or ""
        groups.append(
            {
                "id": t.id,
                "transfer_date": t.transfer_date.isoformat(),
                "from_pond_id": t.from_pond_id,
                "from_pond_name": from_name,
                "from_cycle_name": (
                    (t.from_production_cycle.name or "").strip()
                    if t.from_production_cycle_id
                    else ""
                ),
                "fish_species": sp,
                "fish_species_label": fish_species_display_label(sp, spo),
                "memo": (t.memo or "")[:200],
                "lines": line_rows,
                "subtotal_weight_kg": str(_money_q(sub_wt)),
                "subtotal_cost_amount": str(_money_q(sub_cost)),
                "line_count": len(line_rows),
            }
        )

    summary = {
        "transfer_count": len(groups),
        "line_count": grand_lines,
        "total_weight_kg": float(_money_q(grand_wt)),
        "total_cost_amount_bdt": float(_money_q(grand_cost)),
    }
    return {
        "period": _period_block(start, end),
        "currency_code": BDT,
        "summary": summary,
        "groups": groups,
        "totals": {
            "transfer_count": len(groups),
            "line_count": grand_lines,
            "total_weight_kg": str(_money_q(grand_wt)),
            "total_cost_amount": str(_money_q(grand_cost)),
        },
    }
