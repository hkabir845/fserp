"""Deep ERP analytics for Company Brain — answers without sending users to reports."""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum
from django.utils import timezone

from api.models import (
    AquacultureExpense,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    Employee,
    Invoice,
    Item,
    PayrollRun,
    PayrollRunEmployeeAllocation,
    Station,
)
from api.services.aquaculture_feeding_advice_service import build_feeding_advice_payload
from api.services.aquaculture_medicine_catalog_seed import MEDICINE_CATALOG_ITEM_PREFIX
from api.services.aquaculture_partial_harvest import compute_biomass_load_advice_dict, effective_biomass_kg_from_position_row
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.aquaculture_pond_performance_service import build_pond_performance_report
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.reporting import _collect_all_entity_financial_rows, _entity_pl_row


def _money(val) -> str:
    try:
        return f"{Decimal(str(val or 0)):,.2f}"
    except Exception:
        return "0.00"


def _d(val) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _employee_name(emp: Employee) -> str:
    name = f"{emp.first_name or ''} {emp.last_name or ''}".strip()
    return name or (emp.employee_code or emp.employee_number or f"Employee #{emp.id}")


def _period_for_question(message: str, today: date) -> tuple[date, date, str]:
    lower = (message or "").lower()
    if any(k in lower for k in ("today", "আজ", "আজকের")):
        return today, today, "today"
    if any(k in lower for k in ("yesterday", "গতকাল")):
        y = today - timedelta(days=1)
        return y, y, "yesterday"
    if any(k in lower for k in ("this week", "সপ্তাহ")):
        start = today - timedelta(days=today.weekday())
        return start, today, "this_week"
    if any(k in lower for k in ("last month", "গত মাস")):
        first = today.replace(day=1)
        end = first - timedelta(days=1)
        start = end.replace(day=1)
        return start, end, "last_month"
    month_start = today.replace(day=1)
    if any(k in lower for k in ("this month", "মাসে", "mtd", "month")):
        return month_start, today, "month_to_date"
    return month_start, today, "month_to_date"


def pond_deep_analytics(
    company_id: int,
    pond_id: int,
    *,
    lang: str = "bn",
    period_start: date | None = None,
    period_end: date | None = None,
) -> dict[str, Any] | None:
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return None

    today = timezone.localdate()
    start = period_start or (today - timedelta(days=30))
    end = period_end or today
    name = pond_operational_display_name(pond)

    perf = build_pond_performance_report(company_id, start, end, pond_id=pond_id)
    pond_row = (perf.get("ponds") or [{}])[0] if perf.get("ponds") else {}

    stock_rows = compute_fish_stock_position_rows(company_id, pond_id=pond_id)
    stock = stock_rows[0] if stock_rows else {}

    biomass = effective_biomass_kg_from_position_row(stock) if stock else Decimal("0")
    fish_count = int(stock.get("implied_net_fish_count") or 0) if stock else 0
    water_dec = pond.water_area_decimal

    load_advice = compute_biomass_load_advice_dict(
        biomass,
        fish_count,
        water_dec,
        getattr(pond, "pond_role", None) or stock.get("pond_role"),
        _d(stock.get("water_volume_cu_ft")) if stock.get("water_volume_cu_ft") else None,
        lang=lang,
    )

    feeding, feed_err = build_feeding_advice_payload(company_id, pond_id, today)
    feeding_block = None
    if feeding:
        feeding_block = {
            "suggested_feed_kg_today": str(feeding.get("suggested_feed_kg") or ""),
            "advice_text": (feeding.get("ai_advice_text") or "")[:2000],
            "snapshot": feeding.get("pond_status_snapshot") or {},
        }

    cycle = (
        AquacultureProductionCycle.objects.filter(pond_id=pond_id, end_date__isnull=True)
        .order_by("-start_date", "-id")
        .first()
    )

    return {
        "pond_id": pond_id,
        "pond_name": name,
        "code": pond.code,
        "species": (cycle.fish_species if cycle else "tilapia") or "tilapia",
        "water_area_decimal": str(water_dec or ""),
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "fish_count": fish_count,
        "biomass_kg": str(biomass),
        "fcr": {
            "fcr_biomass": pond_row.get("fcr_biomass"),
            "fcr_harvest": pond_row.get("fcr_harvest"),
            "feed_kg": pond_row.get("feed_kg"),
            "biomass_gain_kg": pond_row.get("biomass_gain_kg"),
            "harvest_kg": pond_row.get("harvest_kg"),
        },
        "density": {
            "kg_per_decimal": load_advice.get("stock_density_kg_per_decimal") or pond_row.get("load_kg_per_decimal"),
            "kg_per_1000_cu_ft": load_advice.get("stock_density_kg_per_1000_cu_ft"),
            "load_level": load_advice.get("load_level"),
            "load_level_label": load_advice.get("load_level_label"),
            "comfort_kg_per_decimal": load_advice.get("comfort_kg_per_decimal"),
        },
        "stocking_recommendation": {
            "owner_action": load_advice.get("owner_action"),
            "owner_decision_recommended": load_advice.get("owner_decision_recommended"),
            "summary": load_advice.get("owner_decision_summary") or load_advice.get("advice_summary"),
            "partial_harvest_suggested_kg": load_advice.get("partial_harvest_suggested_kg"),
            "partial_harvest_suggested_fish_count": load_advice.get("partial_harvest_suggested_fish_count"),
        },
        "feeding_today": feeding_block,
        "feeding_error": feed_err,
        "adg_g_per_fish_per_day": pond_row.get("adg_g_per_fish_per_day"),
        "latest_sample_date": pond_row.get("latest_sample_date"),
        "bioasset_value_bdt": pond_row.get("bioasset_value"),
    }


def all_ponds_summary(company_id: int, *, lang: str = "bn", days: int = 30) -> dict[str, Any]:
    today = timezone.localdate()
    start = today - timedelta(days=days)
    perf = build_pond_performance_report(company_id, start, today)
    rows = []
    for p in perf.get("ponds") or []:
        rows.append(
            {
                "pond_id": p.get("pond_id"),
                "pond_name": p.get("pond_name"),
                "fcr_biomass": p.get("fcr_biomass"),
                "kg_per_decimal": p.get("load_kg_per_decimal"),
                "load_level": p.get("load_level_label"),
                "fish_count": p.get("fish_count"),
                "biomass_kg": p.get("biomass_kg"),
                "net_action_hint": _action_hint_from_load(p.get("load_level"), lang),
            }
        )
    return {
        "period": {"start": start.isoformat(), "end": today.isoformat()},
        "portfolio_summary": perf.get("summary") or {},
        "ponds": rows,
    }


def _action_hint_from_load(level: str | None, lang: str) -> str:
    lvl = (level or "").strip().lower()
    if lang == "bn":
        if lvl == "high_risk":
            return "অবিলম্বে পাতলা করে বিক্রি/হারভেস্ট বিবেচনা করুন"
        if lvl == "full":
            return "আংশিক হারভেস্ট বা বিক্রি বিবেচনা করুন"
        if lvl == "understocked":
            return "স্টকিং বাড়ানো যেতে পারে"
        if lvl == "moderate":
            return "পর্যবেক্ষণ চালিয়ে যান"
        return "—"
    if lvl == "high_risk":
        return "Consider urgent thinning / harvest"
    if lvl == "full":
        return "Consider partial harvest or sale"
    if lvl == "understocked":
        return "Room to increase stocking"
    return "Continue monitoring"


def entity_financials(
    company_id: int,
    *,
    start: date,
    end: date,
    station_id: int | None = None,
    pond_id: int | None = None,
) -> dict[str, Any]:
    bundle = _collect_all_entity_financial_rows(company_id, start, end)
    out: dict[str, Any] = {
        "period": bundle.get("period"),
        "company_total": _entity_pl_row(bundle["company_total"]),
        "stations": [_entity_pl_row(r) for r in bundle.get("by_station") or []],
        "ponds": [_entity_pl_row(r) for r in bundle.get("by_pond") or []],
        "unscoped": _entity_pl_row(bundle.get("unscoped") or {}),
    }
    if station_id:
        match = next((r for r in out["stations"] if r.get("entity_id") == station_id), None)
        out["focused_station"] = match
    if pond_id:
        match = next((r for r in out["ponds"] if r.get("entity_id") == pond_id), None)
        out["focused_pond"] = match
    return out


def sales_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    station_id: int | None = None,
) -> dict[str, Any]:
    qs = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=start,
        invoice_date__lte=end,
    ).exclude(status__in=("draft", "void"))
    if station_id:
        qs = qs.filter(station_id=station_id)
    agg = qs.aggregate(total=Sum("total"), count=Count("id"))
    by_station = []
    if not station_id:
        for row in (
            qs.values("station_id", "station__station_name")
            .annotate(total=Sum("total"), count=Count("id"))
            .order_by("-total")[:20]
        ):
            by_station.append(
                {
                    "station_id": row["station_id"],
                    "station_name": row["station__station_name"] or "Unassigned",
                    "sales_bdt": _money(row["total"]),
                    "invoice_count": row["count"],
                }
            )
    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "total_sales_bdt": _money(agg.get("total")),
        "invoice_count": int(agg.get("count") or 0),
        "by_station": by_station,
    }


def expenses_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
) -> dict[str, Any]:
    bill_qs = Bill.objects.filter(company_id=company_id, bill_date__gte=start, bill_date__lte=end)
    bill_agg = bill_qs.aggregate(total=Sum("total"), count=Count("id"))

    aqua_qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_date__gte=start,
        expense_date__lte=end,
    )
    if pond_id:
        aqua_qs = aqua_qs.filter(pond_id=pond_id)
    aqua_agg = aqua_qs.aggregate(total=Sum("amount"), count=Count("id"))

    by_category = []
    for row in (
        aqua_qs.values("expense_category")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")[:15]
    ):
        by_category.append(
            {
                "category": row["expense_category"] or "other",
                "amount_bdt": _money(row["total"]),
                "count": row["count"],
            }
        )

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "vendor_bills_bdt": _money(bill_agg.get("total")),
        "vendor_bill_count": int(bill_agg.get("count") or 0),
        "pond_direct_expenses_bdt": _money(aqua_agg.get("total")),
        "pond_expense_count": int(aqua_agg.get("count") or 0),
        "pond_expenses_by_category": by_category,
    }


def find_employees(company_id: int, query: str) -> list[dict[str, Any]]:
    q = (query or "").strip().lower()
    emps = Employee.objects.filter(company_id=company_id, is_active=True).select_related(
        "home_station", "home_aquaculture_pond"
    )
    hits: list[dict[str, Any]] = []
    for emp in emps:
        name = _employee_name(emp)
        search_blob = " ".join(
            filter(
                None,
                [
                    name,
                    emp.first_name,
                    emp.last_name,
                    emp.job_title,
                    emp.employee_code,
                    emp.employee_number,
                    emp.department,
                ],
            )
        ).lower()
        matched = not q
        if q:
            matched = name.lower() in q or q in search_blob
            if not matched:
                for word in re.split(r"\s+", q):
                    if len(word) >= 3 and word in search_blob:
                        matched = True
                        break
        if not matched:
            continue
        last_payroll = (
            PayrollRunEmployeeAllocation.objects.filter(
                employee_id=emp.id,
                payroll_run__company_id=company_id,
            )
            .select_related("payroll_run")
            .order_by("-payroll_run__payment_date", "-id")
            .first()
        )
        hits.append(
            {
                "employee_id": emp.id,
                "name": _employee_name(emp),
                "job_title": emp.job_title or "",
                "department": emp.department or "",
                "monthly_salary_bdt": _money(emp.salary),
                "home_station": (emp.home_station.station_name if emp.home_station_id else None),
                "home_pond": (
                    pond_operational_display_name(emp.home_aquaculture_pond)
                    if emp.home_aquaculture_pond_id
                    else None
                ),
                "labor_scope": emp.aquaculture_labor_scope,
                "last_payroll_gross_bdt": (
                    _money(last_payroll.amount) if last_payroll else None
                ),
                "last_payroll_date": (
                    last_payroll.payroll_run.payment_date.isoformat()
                    if last_payroll and last_payroll.payroll_run
                    else None
                ),
            }
        )
    return hits[:10]


def workforce_retention_analysis(company_id: int, *, lang: str = "bn") -> dict[str, Any]:
    """Advisory ranking for job-cut / retain decisions — owner must approve."""
    today = timezone.localdate()
    month_start = today.replace(day=1)
    fin = entity_financials(company_id, start=month_start, end=today)
    company_net = _d((fin.get("company_total") or {}).get("net_income"))

    emps = list(
        Employee.objects.filter(company_id=company_id, is_active=True)
        .select_related("home_station", "home_aquaculture_pond")
        .order_by("-salary", "id")
    )
    total_payroll_month = sum(_d(e.salary) for e in emps)
    payroll_pct = (
        str((total_payroll_month / company_net * 100).quantize(Decimal("0.1")))
        if company_net > 0
        else None
    )

    rows: list[dict[str, Any]] = []
    for emp in emps:
        salary = _d(emp.salary)
        pond_net = None
        if emp.home_aquaculture_pond_id:
            pond_row = next(
                (p for p in fin.get("ponds") or [] if p.get("entity_id") == emp.home_aquaculture_pond_id),
                None,
            )
            if pond_row:
                pond_net = pond_row.get("net_income")
        station_net = None
        if emp.home_station_id:
            st_row = next(
                (s for s in fin.get("stations") or [] if s.get("entity_id") == emp.home_station_id),
                None,
            )
            if st_row:
                station_net = st_row.get("net_income")

        risk_score = 0
        reasons: list[str] = []
        if salary > 0 and company_net <= 0:
            risk_score += 2
            reasons.append("কোম্পানি এই মাসে নেট লোকসান" if lang == "bn" else "Company net loss MTD")
        if salary >= Decimal("30000") and pond_net is not None and _d(pond_net) < 0:
            risk_score += 3
            reasons.append("উচ্চ বেতন কিন্তু পোন্ড লোকসান" if lang == "bn" else "High salary, pond loss")
        if salary >= Decimal("20000") and station_net is not None and _d(station_net) < 0:
            risk_score += 2
            reasons.append("স্টেশন লোকসানে উচ্চ বেতন" if lang == "bn" else "High salary on loss station")
        if not emp.home_station_id and not emp.home_aquaculture_pond_id and salary > 0:
            risk_score += 1
            reasons.append("কোনো সাইট/পোন্ডে আবদ্ধ নয়" if lang == "bn" else "Not tied to site/pond")

        rows.append(
            {
                "employee_id": emp.id,
                "name": _employee_name(emp),
                "job_title": emp.job_title or "",
                "monthly_salary_bdt": _money(salary),
                "home_station": emp.home_station.station_name if emp.home_station_id else None,
                "home_pond": (
                    pond_operational_display_name(emp.home_aquaculture_pond)
                    if emp.home_aquaculture_pond_id
                    else None
                ),
                "pond_net_income_mtd": pond_net,
                "station_net_income_mtd": station_net,
                "retention_risk_score": risk_score,
                "advisory_reasons": reasons,
                "advisory": (
                    "review_for_release" if risk_score >= 3 else "retain" if risk_score == 0 else "review"
                ),
            }
        )

    rows.sort(key=lambda r: (-int(r["retention_risk_score"]), -_d(r["monthly_salary_bdt"].replace(",", ""))))
    release_candidates = [r for r in rows if r["advisory"] == "review_for_release"][:8]
    retain_core = [r for r in rows if r["advisory"] == "retain"][:8]

    return {
        "period": {"start": month_start.isoformat(), "end": today.isoformat()},
        "company_net_income_mtd": _money(company_net),
        "total_monthly_salary_bdt": _money(total_payroll_month),
        "payroll_as_pct_of_net_income": payroll_pct,
        "active_employees": len(emps),
        "release_candidates_advisory": release_candidates,
        "retain_core_advisory": retain_core,
        "disclaimer_bn": (
            "এটি শুধু পরামর্শ — চূড়ান্ত সিদ্ধান্ত মালিকের। বরখাস্ত ERP থেকে স্বয়ংক্রিয় হয় না।"
        ),
    }


def medicine_catalog_for_brain(company_id: int) -> list[dict[str, str]]:
    items = Item.objects.filter(
        company_id=company_id,
        is_active=True,
        item_number__startswith=MEDICINE_CATALOG_ITEM_PREFIX,
    ).order_by("item_name")[:40]
    return [
        {
            "item_id": it.id,
            "item_number": it.item_number,
            "name": it.item_name,
            "unit": it.unit_of_measure or "",
            "description": (it.description or "")[:200],
        }
        for it in items
    ]
