"""ERP context tools for Company Brain — every fact includes a citable reference."""
from __future__ import annotations

import re
from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum
from django.utils import timezone

from api.models import (
    AquacultureBiomassSample,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    Company,
    Employee,
    Invoice,
    Station,
)
from api.services.aquaculture_fcr_service import compute_fcr_for_scope
from api.services.aquaculture_pond_display import pond_operational_display_name
from api.services.brain import analytics
from api.services.brain.intents import detect_intents
from api.services.brain.plans import brain_plan_for_company
from api.services.station_business_kind import station_business_kind_label, station_business_kind


def _ref(*, kind: str, type_: str, id_: int, label: str, path: str) -> dict[str, Any]:
    return {"kind": kind, "type": type_, "id": id_, "label": label, "path": path}


def _money(val) -> str:
    try:
        return f"{Decimal(str(val or 0)):,.2f}"
    except Exception:
        return "0.00"


def company_overview(company_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    if not company:
        return {}, []

    today = timezone.localdate()
    month_start = today.replace(day=1)
    refs: list[dict[str, Any]] = []

    inv_qs = Invoice.objects.filter(company_id=company_id, invoice_date__gte=month_start, invoice_date__lte=today)
    inv_agg = inv_qs.aggregate(total=Sum("total"), count=Count("id"))
    bill_qs = Bill.objects.filter(company_id=company_id, bill_date__gte=month_start, bill_date__lte=today)
    bill_agg = bill_qs.aggregate(total=Sum("total"), count=Count("id"))

    stations = list(
        Station.objects.filter(company_id=company_id, is_active=True).order_by("station_name", "id")[:50]
    )
    ponds = list(
        AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")[:50]
    )
    employees_active = Employee.objects.filter(company_id=company_id, is_active=True).count()

    refs.append(_ref(kind="erp", type_="company", id_=company.id, label=company.name, path="/company"))

    station_rows = []
    for st in stations:
        kind = station_business_kind(st)
        station_rows.append(
            {
                "id": st.id,
                "name": st.station_name,
                "number": st.station_number,
                "business_kind": kind,
                "business_kind_label": station_business_kind_label(kind),
            }
        )
        refs.append(
            _ref(
                kind="erp",
                type_="station",
                id_=st.id,
                label=st.station_name,
                path="/stations",
            )
        )

    pond_rows = []
    for pond in ponds:
        name = pond_operational_display_name(pond)
        cycle = (
            AquacultureProductionCycle.objects.filter(pond_id=pond.id, end_date__isnull=True)
            .order_by("-start_date", "-id")
            .first()
        )
        species = "tilapia"
        if cycle:
            species = (cycle.fish_species or "tilapia").strip() or "tilapia"
        pond_rows.append(
            {
                "id": pond.id,
                "code": pond.code,
                "name": name,
                "species_focus": species,
                "active_cycle_id": cycle.id if cycle else None,
            }
        )
        refs.append(
            _ref(
                kind="erp",
                type_="pond",
                id_=pond.id,
                label=name,
                path="/aquaculture/ponds",
            )
        )

    data = {
        "company_name": company.name,
        "currency": company.currency or "BDT",
        "language": company.language or "bn",
        "brain_plan": brain_plan_for_company(company),
        "period": {"start": month_start.isoformat(), "end": today.isoformat()},
        "month_to_date": {
            "invoice_total_bdt": _money(inv_agg.get("total")),
            "invoice_count": int(inv_agg.get("count") or 0),
            "bill_total_bdt": _money(bill_agg.get("total")),
            "bill_count": int(bill_agg.get("count") or 0),
        },
        "entities": {
            "stations_count": len(station_rows),
            "ponds_count": len(pond_rows),
            "employees_active": employees_active,
            "stations": station_rows,
            "ponds": pond_rows,
        },
    }
    return data, refs


def _extract_pond_id(message: str, company_id: int) -> int | None:
    m = re.search(r"pond\s*#?\s*(\d+)", message, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"পোন্ড\s*#?\s*(\d+)", message)
    if m:
        return int(m.group(1))
    ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True)
    lower = message.lower()
    for pond in ponds:
        names = [
            (pond.name or "").lower(),
            (pond.code or "").lower(),
            pond_operational_display_name(pond).lower(),
        ]
        if any(n and n in lower for n in names):
            return pond.id
    return None


def _extract_station_id(message: str, company_id: int) -> int | None:
    m = re.search(r"station\s*#?\s*(\d+)", message, re.I)
    if m:
        return int(m.group(1))
    stations = Station.objects.filter(company_id=company_id, is_active=True)
    lower = message.lower()
    for st in stations:
        if (st.station_name or "").lower() in lower:
            return st.id
    return None


def _employee_display(emp: Employee) -> str:
    name = f"{emp.first_name or ''} {emp.last_name or ''}".strip()
    return name or (emp.employee_code or emp.employee_number or f"Employee #{emp.id}")


def _employee_query_from_message(message: str, company_id: int) -> str:
    """Best-effort name/title fragment for employee lookup."""
    lower = message.lower()
    for emp in Employee.objects.filter(company_id=company_id, is_active=True):
        name = f"{emp.first_name or ''} {emp.last_name or ''}".strip().lower()
        if name and name in lower:
            return name
        for part in name.split():
            if len(part) >= 3 and part in lower:
                return part
        title = (emp.job_title or "").strip().lower()
        if title and title in lower:
            return title
    return message


def gather_context(
    company_id: int,
    message: str,
    *,
    context_entity_type: str = "",
    context_entity_id: int | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Assemble rich ERP facts so Brain answers directly — never 'go run a report'."""
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    lang = (company.language if company else "bn") or "bn"
    intents = detect_intents(message)
    today = timezone.localdate()
    period_start, period_end, period_label = analytics._period_for_question(message, today)

    overview, refs = company_overview(company_id)
    context: dict[str, Any] = {
        "company": overview,
        "intents": sorted(intents),
        "period_label": period_label,
        "answer_mode": "direct_from_erp",
    }
    all_refs = list(refs)
    missing_inputs: list[dict[str, str]] = []
    suggested_actions: list[dict[str, Any]] = []

    pond_id = context_entity_id if context_entity_type == "pond" else _extract_pond_id(message, company_id)
    station_id = context_entity_id if context_entity_type == "station" else _extract_station_id(message, company_id)
    employee_id = context_entity_id if context_entity_type == "employee" else None

    need_pond = pond_id or {"fcr", "density", "harvest", "feeding", "disease", "pond"} & intents
    need_all_ponds = not pond_id and {"fcr", "density", "harvest"} & intents

    if pond_id:
        pa = analytics.pond_deep_analytics(company_id, pond_id, lang=lang)
        if pa:
            context["pond_analytics"] = pa
            all_refs.append(
                _ref(
                    kind="erp",
                    type_="pond",
                    id_=pond_id,
                    label=pa.get("pond_name", ""),
                    path="/aquaculture/ponds",
                )
            )
            rec = pa.get("stocking_recommendation") or {}
            if rec.get("owner_action") == "partial_harvest":
                suggested_actions.append(
                    {
                        "action": "partial_harvest",
                        "label_bn": "আংশিক হারভেস্ট / বিক্রি পরিকল্পনা করুন",
                        "requires_approval": True,
                    }
                )
            if rec.get("owner_action") == "grow":
                suggested_actions.append(
                    {
                        "action": "increase_stocking",
                        "label_bn": "স্টকিং বাড়ানোর পরিকল্পনা করুন",
                        "requires_approval": True,
                    }
                )

    if need_all_ponds:
        context["all_ponds_summary"] = analytics.all_ponds_summary(company_id, lang=lang)

    if {"sales", "sales_today"} & intents:
        context["sales"] = analytics.sales_for_period(
            company_id, period_start, period_end, station_id=station_id
        )
        if station_id:
            st = Station.objects.filter(pk=station_id).first()
            if st:
                all_refs.append(
                    _ref(kind="erp", type_="station", id_=station_id, label=st.station_name, path="/invoices")
                )

    if {"profit", "expense", "general", "job_cut"} & intents:
        context["financials"] = analytics.entity_financials(
            company_id,
            start=period_start if period_label != "today" else today.replace(day=1),
            end=period_end,
            station_id=station_id,
            pond_id=pond_id,
        )

    if "expense" in intents:
        context["expenses"] = analytics.expenses_for_period(
            company_id, period_start, period_end, pond_id=pond_id
        )

    if "hr" in intents or employee_id:
        eq = _employee_query_from_message(message, company_id)
        emps = analytics.find_employees(company_id, eq)
        if employee_id and not emps:
            from api.models import Employee

            emp = Employee.objects.filter(pk=employee_id, company_id=company_id).first()
            if emp:
                emps = analytics.find_employees(company_id, _employee_display(emp))
        if not emps and any(
            k in message.lower()
            for k in ("salary", "worker", "employee", "বেতন", "কর্মচারী", "শ্রমিক", "সব")
        ):
            emps = analytics.find_employees(company_id, "")
        context["employees"] = emps
        for e in emps[:3]:
            all_refs.append(
                _ref(
                    kind="erp",
                    type_="employee",
                    id_=int(e["employee_id"]),
                    label=e.get("name", ""),
                    path="/employees",
                )
            )

    if "job_cut" in intents:
        context["workforce_analysis"] = analytics.workforce_retention_analysis(company_id, lang=lang)

    if "disease" in intents:
        context["disease_context"] = {
            "medicine_catalog": analytics.medicine_catalog_for_brain(company_id),
            "user_symptoms": message[:500],
            "note_bn": (
                "রোগ নির্ণয়ের জন্য লক্ষণ, পোন্ড, মাছের আচরণ, পানির রং/গন্ধ, মৃত্যুর হার জানান। "
                "প্রেসক্রিপশন ERP ঔষধ ক্যাটালগ + বিশেষজ্ঞ জ্ঞান দিয়ে তৈরি হবে — মালিক অনুমোদন ছাড়া প্রয়োগ নয়।"
            ),
        }
        if not pond_id:
            missing_inputs.append(
                {
                    "key": "disease_pond",
                    "prompt_bn": "কোন পোন্ডে রোগ দেখা দিয়েছে?",
                }
            )
        all_refs.append(
            _ref(kind="erp", type_="medicine", id_=0, label="ঔষধ ক্যাটালগ", path="/aquaculture/medicine")
        )

    if "feeding" in intents and not pond_id:
        missing_inputs.append({"key": "feeding_pond", "prompt_bn": "কোন পোন্ডের জন্য ফিড সুপারিশ চান?"})

    context["missing_inputs"] = missing_inputs
    context["suggested_actions"] = suggested_actions

    seen: set[tuple[str, int]] = set()
    unique_refs: list[dict[str, Any]] = []
    for r in all_refs:
        key = (str(r.get("type")), int(r.get("id") or 0))
        if key in seen:
            continue
        seen.add(key)
        unique_refs.append(r)

    return context, unique_refs


def wants_web_research(message: str) -> bool:
    lower = (message or "").lower()
    keywords = (
        "web",
        "internet",
        "research",
        "market price",
        "disease",
        "symptom",
        "infection",
        "parasite",
        "prescription",
        "treatment",
        "medicine",
        "ওয়েব",
        "ইন্টারনেট",
        "রোগ",
        "লক্ষণ",
        "অসুস্থ",
        "প্রেসক্রিপশন",
        "চিকিৎসা",
        "ঔষধ",
        "বাজার দর",
        "গবেষণা",
    )
    return any(k in lower for k in keywords)
