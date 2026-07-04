"""Deep ERP analytics for Company Brain — answers without sending users to reports."""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db.models import Count, Sum
from django.utils import timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishSale,
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
from api.services.brain.date_parsing import resolve_question_period
from api.services.aquaculture_medicine_catalog_seed import MEDICINE_CATALOG_ITEM_PREFIX
from api.services.aquaculture_partial_harvest import compute_biomass_load_advice_dict, effective_biomass_kg_from_position_row
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.aquaculture_pond_performance_service import build_pond_performance_report
from api.services.aquaculture_sale_reference_service import (
    company_average_fish_sale_price_per_kg,
    last_fish_sale_reference_for_ledger,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.brain.module_analytics import build_erp_module_summaries
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


def _implied_market_value_bdt(biomass_kg: Decimal, price_per_kg: Decimal | None) -> str | None:
    if price_per_kg is None or price_per_kg <= 0 or biomass_kg <= 0:
        return None
    return f"{(biomass_kg * price_per_kg).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,.2f}"


def _resolve_pond_sale_price(
    company_id: int,
    pond_id: int,
    *,
    species: str,
    cycle_id: int | None,
    company_avg: dict | None = None,
) -> tuple[Decimal | None, str | None, dict | None]:
    """Return (price_per_kg, price_basis, last_sale_ref)."""
    last_sale = last_fish_sale_reference_for_ledger(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_id,
        fish_species=species,
    )
    if last_sale and last_sale.get("price_per_kg"):
        try:
            ppk = Decimal(str(last_sale["price_per_kg"]))
            if ppk > 0:
                return ppk, "last_pond_sale", last_sale
        except Exception:
            pass

    avg = company_avg or company_average_fish_sale_price_per_kg(company_id)
    if avg and avg.get("price_per_kg"):
        try:
            ppk = Decimal(str(avg["price_per_kg"]))
            if ppk > 0:
                return ppk, "company_average_sale", None
        except Exception:
            pass
    return None, None, last_sale


def _market_value_block(
    company_id: int,
    pond_id: int,
    biomass_kg: Decimal,
    *,
    species: str,
    cycle_id: int | None,
    company_avg: dict | None = None,
) -> dict[str, Any]:
    price, basis, last_sale = _resolve_pond_sale_price(
        company_id,
        pond_id,
        species=species,
        cycle_id=cycle_id,
        company_avg=company_avg,
    )
    avg = company_avg or company_average_fish_sale_price_per_kg(company_id)
    return {
        "last_sale_price_per_kg": (
            str(last_sale["price_per_kg"]) if last_sale and last_sale.get("price_per_kg") else None
        ),
        "valuation_price_per_kg": str(price) if price is not None else None,
        "price_basis": basis,
        "company_average_sale_price_per_kg": avg.get("price_per_kg") if avg else None,
        "company_average_sale_count": avg.get("sale_count") if avg else None,
        "implied_market_value_bdt": _implied_market_value_bdt(biomass_kg, price),
        "last_sale_date": last_sale.get("sale_date") if last_sale else None,
    }


def _build_stock_profile(
    biomass_kg: Decimal,
    fish_count: int,
    stock: dict[str, Any],
    water_dec: Decimal | None,
) -> dict[str, Any]:
    """How live fish count and average size compose pond density (kg per decimal)."""
    avg_weight_kg: Decimal | None = None
    if stock.get("current_avg_weight_kg") not in (None, ""):
        avg_weight_kg = _d(stock.get("current_avg_weight_kg"))
    elif fish_count > 0 and biomass_kg > 0:
        avg_weight_kg = (biomass_kg / Decimal(fish_count)).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )

    avg_weight_g: str | None = None
    if avg_weight_kg is not None and avg_weight_kg > 0:
        avg_weight_g = str((avg_weight_kg * Decimal("1000")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))

    fish_per_kg = stock.get("current_fish_per_kg")
    kpd: str | None = None
    if water_dec and water_dec > 0 and biomass_kg > 0:
        kpd = str((biomass_kg / water_dec).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))

    return {
        "fish_count": fish_count,
        "biomass_kg": str(biomass_kg) if biomass_kg > 0 else "0",
        "water_area_decimal": str(water_dec) if water_dec is not None else None,
        "avg_weight_kg": str(avg_weight_kg) if avg_weight_kg is not None else None,
        "avg_weight_g": avg_weight_g,
        "fish_per_kg": fish_per_kg,
        "density_kg_per_decimal": kpd,
        "density_formula_bn": (
            "ঘনত্ব (কেজি/ডেসিমাল) = মোট বায়োমাস (কেজি) ÷ জলের ক্ষেত্রফল (ডেসিমাল)"
            if biomass_kg > 0 and water_dec and water_dec > 0
            else None
        ),
    }


def _build_growth_projection(
    biomass_kg: Decimal,
    fish_count: int,
    *,
    adg_g_per_fish_per_day: str | Decimal | None,
    water_dec: Decimal | None,
    comfort_kg_per_decimal: str | Decimal | None,
    valuation_price_per_kg: Decimal | None,
) -> dict[str, Any]:
    """Project biomass and sale value from ADG for harvest planning."""
    adg = _d(adg_g_per_fish_per_day)
    if adg <= 0 or fish_count <= 0 or biomass_kg <= 0:
        return {"available": False}

    daily_gain_kg = (adg * Decimal(fish_count) / Decimal("1000")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    proj_30 = (biomass_kg + daily_gain_kg * 30).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    proj_60 = (biomass_kg + daily_gain_kg * 60).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    proj_kpd_30: str | None = None
    days_to_comfort: int | None = None
    comfort = _d(comfort_kg_per_decimal)
    if water_dec and water_dec > 0 and comfort > 0:
        current_kpd = biomass_kg / water_dec
        proj_kpd_30 = str((proj_30 / water_dec).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))
        if daily_gain_kg > 0 and current_kpd < comfort:
            gap_kg = (comfort * water_dec - biomass_kg).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if gap_kg > 0:
                days_to_comfort = int((gap_kg / daily_gain_kg).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    def _proj_value(kg: Decimal) -> str | None:
        if valuation_price_per_kg is None or valuation_price_per_kg <= 0:
            return None
        return _implied_market_value_bdt(kg, valuation_price_per_kg)

    return {
        "available": True,
        "adg_g_per_fish_per_day": str(adg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "daily_biomass_gain_kg": str(daily_gain_kg),
        "projected_biomass_kg_30d": str(proj_30),
        "projected_biomass_kg_60d": str(proj_60),
        "projected_density_kg_per_decimal_30d": proj_kpd_30,
        "projected_market_value_bdt_30d": _proj_value(proj_30),
        "projected_market_value_bdt_60d": _proj_value(proj_60),
        "days_to_comfort_load": days_to_comfort,
        "planning_note_bn": (
            f"গড় {adg.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)} গ্রাম/মাছ/দিন বৃদ্ধি ধরে "
            f"৩০ দিনে বায়োমাস ~{proj_30} কেজি হতে পারে"
            + (f"; আরামদায়ক লোডে ~{days_to_comfort} দিন" if days_to_comfort else "")
            + "।"
        ),
    }


def _employee_name(emp: Employee) -> str:
    name = f"{emp.first_name or ''} {emp.last_name or ''}".strip()
    return name or (emp.employee_code or emp.employee_number or f"Employee #{emp.id}")


def _period_for_question(message: str, today: date) -> tuple[date, date, str]:
    lower = (message or "").lower()
    if any(k in lower for k in ("today", "todays", "today's", "আজ", "আজকের", "ajker", "aajker", "ajke", "aajke")):
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

    # Specific calendar day or explicit range — e.g. "4th july sale", "1 to 5 july"
    parsed = resolve_question_period(message, today)
    if parsed:
        return parsed

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

    market = _market_value_block(
        company_id,
        pond_id,
        biomass,
        species=(cycle.fish_species if cycle else "tilapia") or "tilapia",
        cycle_id=cycle.id if cycle else None,
    )
    val_price: Decimal | None = None
    if market.get("valuation_price_per_kg"):
        val_price = _d(market["valuation_price_per_kg"])

    comfort_kpd = load_advice.get("comfort_kg_per_decimal") or (
        pond_row.get("comfort_kg_per_decimal") if pond_row else None
    )
    adg = pond_row.get("adg_g_per_fish_per_day")

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
        "adg_g_per_fish_per_day": adg,
        "latest_sample_date": pond_row.get("latest_sample_date"),
        "bioasset_value_bdt": pond_row.get("bioasset_value"),
        "stock_profile": _build_stock_profile(biomass, fish_count, stock, water_dec),
        "growth_projection": _build_growth_projection(
            biomass,
            fish_count,
            adg_g_per_fish_per_day=adg,
            water_dec=water_dec,
            comfort_kg_per_decimal=comfort_kpd,
            valuation_price_per_kg=val_price,
        ),
        "market_value": market,
    }


def all_ponds_summary(company_id: int, *, lang: str = "bn", days: int = 30) -> dict[str, Any]:
    today = timezone.localdate()
    start = today - timedelta(days=days)
    perf = build_pond_performance_report(company_id, start, today)
    company_avg = company_average_fish_sale_price_per_kg(company_id)

    stock_by_pond = {
        int(r["pond_id"]): r
        for r in compute_fish_stock_position_rows(company_id, include_inactive_ponds=False)
    }

    rows = []
    total_biomass = Decimal("0")
    total_market_value = Decimal("0")
    total_fish = 0
    ponds_with_value = 0

    for p in perf.get("ponds") or []:
        pid = p.get("pond_id")
        stock = stock_by_pond.get(int(pid)) if pid is not None else {}
        biomass = effective_biomass_kg_from_position_row(stock) if stock else _d(p.get("biomass_kg"))
        fish_count = int(stock.get("implied_net_fish_count") or p.get("fish_count") or 0)
        avg_weight_g: str | None = None
        if fish_count > 0 and biomass > 0:
            avg_weight_g = str(
                ((biomass / Decimal(fish_count)) * Decimal("1000")).quantize(
                    Decimal("0.1"), rounding=ROUND_HALF_UP
                )
            )
        kpd = stock.get("stock_density_kg_per_decimal") or p.get("load_kg_per_decimal")
        load_label = stock.get("load_level_label") or p.get("load_level_label")
        load_level = stock.get("load_level") or p.get("load_level")

        species = (stock.get("latest_sample_fish_species") or "tilapia") if stock else "tilapia"
        cycle_id = stock.get("production_cycle_id")
        if cycle_id is not None:
            try:
                cycle_id = int(cycle_id)
            except Exception:
                cycle_id = None

        market = _market_value_block(
            company_id,
            int(pid),
            biomass,
            species=species,
            cycle_id=cycle_id,
            company_avg=company_avg,
        ) if pid is not None else {}

        total_biomass += biomass
        total_fish += fish_count
        if market.get("implied_market_value_bdt"):
            try:
                total_market_value += Decimal(str(market["implied_market_value_bdt"].replace(",", "")))
                ponds_with_value += 1
            except Exception:
                pass

        rows.append(
            {
                "pond_id": pid,
                "pond_name": p.get("pond_name"),
                "fcr_biomass": p.get("fcr_biomass"),
                "kg_per_decimal": kpd,
                "load_level": load_level,
                "load_level_label": load_label,
                "fish_count": fish_count,
                "avg_weight_g": avg_weight_g,
                "biomass_kg": str(biomass) if biomass > 0 else p.get("biomass_kg"),
                "valuation_price_per_kg": market.get("valuation_price_per_kg"),
                "price_basis": market.get("price_basis"),
                "implied_market_value_bdt": market.get("implied_market_value_bdt"),
                "net_action_hint": _action_hint_from_load(load_level, lang),
            }
        )

    return {
        "period": {"start": start.isoformat(), "end": today.isoformat()},
        "portfolio_summary": perf.get("summary") or {},
        "company_average_sale_price_per_kg": company_avg.get("price_per_kg") if company_avg else None,
        "company_average_sale_count": company_avg.get("sale_count") if company_avg else 0,
        "totals": {
            "pond_count": len(rows),
            "total_fish_count": total_fish,
            "total_biomass_kg": str(total_biomass.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "total_implied_market_value_bdt": (
                f"{total_market_value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,.2f}"
                if total_market_value > 0
                else None
            ),
            "ponds_with_market_value": ponds_with_value,
        },
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


def find_employees(company_id: int, query: str, *, limit: int = 50) -> list[dict[str, Any]]:
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
    return hits[: max(1, int(limit))]


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
    ).order_by("name")[:40]
    return [
        {
            "item_id": it.id,
            "item_number": it.item_number,
            "name": it.name,
            "unit": it.unit or "",
            "description": (it.description or "")[:200],
        }
        for it in items
    ]


def build_company_knowledge_snapshot(company_id: int, *, lang: str = "bn") -> dict[str, Any]:
    """
    Whole-application business snapshot — loaded on every Brain question so the owner
    can ask anything without us guessing intents first.
    """
    try:
        return _build_company_knowledge_snapshot_body(company_id, lang=lang)
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning(
            "Brain build_company_knowledge_snapshot failed company=%s: %s", company_id, exc
        )
        return {
            "partial": True,
            "error_note": "Full snapshot unavailable; using overview only.",
        }


def _build_company_knowledge_snapshot_body(company_id: int, *, lang: str = "bn") -> dict[str, Any]:
    today = timezone.localdate()
    month_start = today.replace(day=1)
    fin = entity_financials(company_id, start=month_start, end=today)
    ponds_perf = all_ponds_summary(company_id, lang=lang, days=30)

    roster = find_employees(company_id, "", limit=200)

    recent_invoices = list(
        Invoice.objects.filter(company_id=company_id)
        .exclude(status__in=("draft", "void"))
        .select_related("station")
        .order_by("-invoice_date", "-id")[:12]
    )
    recent_bills = list(
        Bill.objects.filter(company_id=company_id).order_by("-bill_date", "-id")[:12]
    )
    recent_samples = list(
        AquacultureBiomassSample.objects.filter(company_id=company_id)
        .select_related("pond")
        .order_by("-sample_date", "-id")[:10]
    )
    recent_fish_sales = list(
        AquacultureFishSale.objects.filter(company_id=company_id)
        .select_related("pond")
        .order_by("-sale_date", "-id")[:8]
    )
    recent_payroll = list(
        PayrollRun.objects.filter(company_id=company_id, payment_date__gte=month_start)
        .order_by("-payment_date", "-id")[:6]
    )
    erp_modules = build_erp_module_summaries(company_id, month_start=month_start, today=today, lang=lang)

    return {
        "generated_at": timezone.now().isoformat(),
        "scope_note_bn": (
            "এই স্ন্যাপশট FSERP-এর সকল মডিউল থেকে — গ্রাহক, সরবরাহকারী, পেমেন্ট, ইনভেন্টরি, "
            "ট্যাংক/শিফট, হিসাব, ঋণ, পে-রোল, পোন্ড, স্থায়ী সম্পদ, এবং GL P&L। "
            "রিপোর্ট খুলতে বলবেন না — এখান থেকেই মানুষের মতো উত্তর দিন।"
        ),
        "periods": {
            "today": {"start": today.isoformat(), "end": today.isoformat()},
            "month_to_date": {"start": month_start.isoformat(), "end": today.isoformat()},
        },
        "sales_today": sales_for_period(company_id, today, today),
        "sales_mtd": sales_for_period(company_id, month_start, today),
        "expenses_mtd": expenses_for_period(company_id, month_start, today),
        "financials_mtd": fin,
        "ponds_performance_30d": ponds_perf,
        "workforce_roster": roster,
        "workforce_advisory_mtd": workforce_retention_analysis(company_id, lang=lang),
        "medicine_catalog": medicine_catalog_for_brain(company_id),
        "erp_modules": erp_modules,
        "recent_invoices": [
            {
                "id": inv.id,
                "number": inv.invoice_number,
                "date": inv.invoice_date.isoformat() if inv.invoice_date else None,
                "total_bdt": _money(inv.total),
                "station": (inv.station.station_name if inv.station_id else None),
            }
            for inv in recent_invoices
        ],
        "recent_bills": [
            {
                "id": b.id,
                "number": b.bill_number,
                "date": b.bill_date.isoformat() if b.bill_date else None,
                "total_bdt": _money(b.total),
                "vendor_ref": (b.vendor_reference or "")[:80],
            }
            for b in recent_bills
        ],
        "recent_biomass_samples": [
            {
                "id": s.id,
                "pond": pond_operational_display_name(s.pond) if s.pond_id else "",
                "pond_id": s.pond_id,
                "date": s.sample_date.isoformat() if s.sample_date else None,
                "fish_count": s.estimated_fish_count,
                "avg_weight_kg": str(s.avg_weight_kg or ""),
                "species": s.fish_species or "",
            }
            for s in recent_samples
        ],
        "recent_fish_sales": [
            {
                "id": fs.id,
                "pond": pond_operational_display_name(fs.pond) if fs.pond_id else "",
                "pond_id": fs.pond_id,
                "date": fs.sale_date.isoformat() if fs.sale_date else None,
                "weight_kg": str(fs.weight_kg or ""),
                "amount_bdt": _money(fs.total_amount),
                "species": fs.fish_species or "",
            }
            for fs in recent_fish_sales
        ],
        "recent_payroll_runs": [
            {
                "id": pr.id,
                "number": pr.payroll_number,
                "payment_date": pr.payment_date.isoformat() if pr.payment_date else None,
                "gross_bdt": _money(pr.total_gross),
                "net_bdt": _money(pr.total_net),
                "status": pr.status,
            }
            for pr in recent_payroll
        ],
        "record_counts": {
            "active_stations": Station.objects.filter(company_id=company_id, is_active=True).count(),
            "active_ponds": AquaculturePond.objects.filter(company_id=company_id, is_active=True).count(),
            "active_employees": Employee.objects.filter(company_id=company_id, is_active=True).count(),
            "active_customers": erp_modules.get("sales_customers_ar", {}).get("active_customers"),
            "active_vendors": erp_modules.get("purchases_vendors_ap", {}).get("active_vendors"),
            "active_items": erp_modules.get("inventory_stock", {}).get("active_items"),
            "active_tanks": erp_modules.get("fuel_forecourt", {}).get("active_tanks"),
            "active_loans": erp_modules.get("loans_financing", {}).get("active_loans_count"),
            "invoices_all_time": Invoice.objects.filter(company_id=company_id).count(),
            "bills_all_time": Bill.objects.filter(company_id=company_id).count(),
            "aquaculture_expenses_all_time": AquacultureExpense.objects.filter(company_id=company_id).count(),
            "fish_sales_all_time": AquacultureFishSale.objects.filter(company_id=company_id).count(),
        },
    }
