"""Company Context Engine — structured business context from PostgreSQL."""
from __future__ import annotations

from typing import Any

from django.utils import timezone

from api.services.brain import tools
from api.services.brain.forecasting import build_forecast_pack
from api.services.brain.external_knowledge import build_external_comparison_context
from api.services.brain.global_business_gaps import build_global_business_gap_analysis


def build_company_context(
    company_id: int,
    question: str,
    *,
    context_entity_type: str = "",
    context_entity_id: int | None = None,
    include_forecast: bool = False,
    include_external: bool = False,
    include_global_gaps: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Collect structured business context — delegates to tools.gather_context
    and adds AI Manager summary blocks without dumping raw DB rows.
    """
    context, refs = tools.gather_context(
        company_id,
        question,
        context_entity_type=context_entity_type,
        context_entity_id=context_entity_id,
    )
    context["context_summary"] = summarize_context(context)
    if include_forecast:
        qtype = "forecasting" if include_forecast else ""
        context["forecast_pack"] = build_forecast_pack(company_id, question_type=qtype)
    if include_external:
        context["external_knowledge"] = build_external_comparison_context(
            company_id,
            intents=context.get("intents") or [],
        )
    if include_global_gaps:
        context["global_business_gaps"] = build_global_business_gap_analysis(context)
        context["advisory_mode"] = True
    context["analysis_at"] = timezone.now().isoformat()
    return context, refs


def summarize_context(context: dict[str, Any]) -> dict[str, Any]:
    """Compact executive summary for prompts — not raw DB dump."""
    company = context.get("company") or {}
    snap = context.get("business_snapshot") or {}
    fin = (snap.get("financials_mtd") or {}).get("company_total") or {}
    sales = context.get("sales") or snap.get("sales_mtd") or {}
    mods = snap.get("erp_modules") or {}

    ar = mods.get("sales_customers_ar") or {}
    inv = mods.get("inventory_stock") or {}
    hr = mods.get("hr_payroll") or {}

    warnings: list[str] = []
    brief = context.get("decision_brief") or {}
    for flag in (brief.get("risk_flags") or [])[:5]:
        if isinstance(flag, dict) and flag.get("message_bn"):
            warnings.append(flag["message_bn"])
        elif isinstance(flag, str):
            warnings.append(flag)

    return {
        "company_name": company.get("company_name") or company.get("name"),
        "entities": company.get("entities") or {},
        "financials_mtd": {
            "revenue": fin.get("revenue") or fin.get("total_revenue"),
            "expenses": fin.get("expenses") or fin.get("total_expenses"),
            "net_income": fin.get("net_income"),
        },
        "sales_summary": {
            "period": sales.get("period") or context.get("period_label"),
            "total": sales.get("total") or sales.get("invoice_total"),
            "count": sales.get("invoice_count") or sales.get("count"),
        },
        "receivables": {
            "overdue_total": ar.get("overdue_total"),
            "overdue_count": len(ar.get("overdue_invoices") or []),
        },
        "inventory": {
            "low_stock_count": len(inv.get("low_stock_items") or []),
        },
        "hr": {
            "active_employees": hr.get("active_count") or company.get("entities", {}).get("employees_active"),
            "payroll_mtd": hr.get("payroll_mtd"),
        },
        "warnings": warnings[:6],
        "intents": context.get("intents") or [],
        "question_focus": context.get("question_focus") or {},
    }
