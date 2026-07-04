"""Generate proactive business insights and warnings from ERP analytics."""
from __future__ import annotations

from typing import Any

from django.utils import timezone

from api.models import BrainInsight
from api.services.brain import analytics, forecasting
from api.services.brain.decision_intelligence import build_decision_brief


def _insight(
    *,
    insight_type: str,
    title_bn: str,
    body_bn: str,
    severity: str = BrainInsight.SEVERITY_INFO,
    key_numbers: dict | None = None,
    action_bn: str = "",
    confidence: str = "medium",
    sources: list | None = None,
) -> dict[str, Any]:
    return {
        "insight_type": insight_type,
        "title_bn": title_bn,
        "body_bn": body_bn,
        "severity": severity,
        "key_numbers": key_numbers or {},
        "recommended_action_bn": action_bn,
        "confidence": confidence,
        "data_sources": sources or [{"kind": "erp", "type": "analytics"}],
    }


def build_insights(company_id: int, *, lang: str = "bn") -> list[dict[str, Any]]:
    """Compute on-demand insights — no LLM required."""
    insights: list[dict[str, Any]] = []
    today = timezone.localdate()

    try:
        snap = analytics.build_company_knowledge_snapshot(company_id, lang=lang)
    except Exception:
        snap = {}

    try:
        cash = forecasting.forecast_cash_flow_pressure(company_id)
        level = (cash.get("forecast_data") or {}).get("pressure_level", "low")
        if level in ("medium", "high"):
            insights.append(
                _insight(
                    insight_type="cash_flow",
                    title_bn=cash.get("title_bn", "ক্যাশ-ফ্লো সতর্কতা"),
                    body_bn=cash.get("summary_bn", ""),
                    severity=BrainInsight.SEVERITY_WARNING if level == "medium" else BrainInsight.SEVERITY_CRITICAL,
                    key_numbers=cash.get("forecast_data") or {},
                    action_bn="বকেয়া A/R সংগ্রহ ও A/P সময়মতো পরিশোধ পরিকল্পনা করুন।",
                    confidence=cash.get("confidence", "medium"),
                )
            )
    except Exception:
        pass

    try:
        ar = forecasting.forecast_customer_payment_risk(company_id)
        overdue = (ar.get("forecast_data") or {}).get("overdue_total", "0")
        if str(overdue) not in ("0", "0.00"):
            insights.append(
                _insight(
                    insight_type="receivables",
                    title_bn="গ্রাহক বকেয়া সতর্কতা",
                    body_bn=ar.get("summary_bn", ""),
                    severity=BrainInsight.SEVERITY_WARNING,
                    key_numbers=ar.get("forecast_data") or {},
                    action_bn="শীর্ষ overdue গ্রাহকদের ফোন/নোটিশ পাঠান।",
                    confidence=ar.get("confidence", "medium"),
                )
            )
    except Exception:
        pass

    try:
        stock = forecasting.forecast_stock_shortage(company_id)
        count = (stock.get("forecast_data") or {}).get("low_stock_count", 0)
        if count:
            insights.append(
                _insight(
                    insight_type="inventory",
                    title_bn=stock.get("title_bn", "স্টক সতর্কতা"),
                    body_bn=stock.get("summary_bn", ""),
                    severity=BrainInsight.SEVERITY_WARNING,
                    key_numbers={"low_stock_count": count},
                    action_bn="Reorder level যাচাই করে ক্রয়/ট্রান্সফার করুন।",
                    confidence=stock.get("confidence", "medium"),
                )
            )
    except Exception:
        pass

    if snap:
        try:
            brief = build_decision_brief(snap, message="management summary")
            for flag in (brief.get("risk_flags") or [])[:3]:
                insights.append(
                    _insight(
                        insight_type="risk",
                        title_bn=flag.get("title_bn") or "ব্যবসায়িক ঝুঁকি",
                        body_bn=flag.get("detail_bn") or flag.get("insight_bn") or "",
                        severity=BrainInsight.SEVERITY_WARNING,
                        key_numbers={"metric": flag.get("metric"), "value": flag.get("value")},
                        action_bn=flag.get("action_bn") or "",
                        confidence="medium",
                    )
                )
        except Exception:
            pass

    try:
        sales = forecasting.forecast_sales_trend(company_id)
        insights.append(
            _insight(
                insight_type="sales_trend",
                title_bn=sales.get("title_bn", "বিক্রি ট্রেন্ড"),
                body_bn=sales.get("summary_bn", ""),
                severity=BrainInsight.SEVERITY_INFO,
                key_numbers=sales.get("forecast_data") or {},
                confidence=sales.get("confidence", "medium"),
            )
        )
    except Exception:
        pass

    return insights[:12]


def persist_insights(company_id: int, insights: list[dict[str, Any]]) -> list[BrainInsight]:
    """Persist insights; replace prior active rows of the same insight_type."""
    types = [item.get("insight_type", "") for item in insights if item.get("insight_type")]
    if types:
        BrainInsight.objects.filter(
            company_id=company_id,
            insight_type__in=types,
            is_dismissed=False,
        ).update(is_dismissed=True)

    rows: list[BrainInsight] = []
    for item in insights:
        rows.append(
            BrainInsight.objects.create(
                company_id=company_id,
                insight_type=item.get("insight_type", "")[:64],
                title_bn=(item.get("title_bn") or "")[:300],
                body_bn=item.get("body_bn") or "",
                severity=item.get("severity", BrainInsight.SEVERITY_INFO),
                key_numbers=item.get("key_numbers") or {},
                recommended_action_bn=item.get("recommended_action_bn") or "",
                confidence=item.get("confidence", "medium"),
                data_sources=item.get("data_sources") or [],
            )
        )
    return rows


def get_active_insights(company_id: int, *, limit: int = 10) -> list[BrainInsight]:
    return list(
        BrainInsight.objects.filter(company_id=company_id, is_dismissed=False).order_by("-created_at")[
            :limit
        ]
    )


def generate_insights(company_id: int, *, persist: bool = False, lang: str = "bn") -> list[dict[str, Any]]:
    """Build insights; optionally persist to BrainInsight table."""
    items = build_insights(company_id, lang=lang)
    if persist and items:
        persist_insights(company_id, items)
    return items


def list_active_insights(company_id: int, *, limit: int = 10) -> list[dict[str, Any]]:
    """Serialize active insights for API."""
    return [
        {
            "id": r.id,
            "insight_type": r.insight_type,
            "title_bn": r.title_bn,
            "body_bn": r.body_bn,
            "severity": r.severity,
            "key_numbers": r.key_numbers,
            "recommended_action_bn": r.recommended_action_bn,
            "confidence": r.confidence,
            "data_sources": r.data_sources,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in get_active_insights(company_id, limit=limit)
    ]
