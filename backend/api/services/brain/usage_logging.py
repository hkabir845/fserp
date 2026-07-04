"""Token and cost usage logging for Company Brain."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.utils import timezone

from api.models import BrainUsageLog
from api.services.brain.security import get_company_settings

# Rough OpenRouter cost estimates per 1M tokens (USD) — conservative defaults
_DEFAULT_COST_PER_1M = Decimal("3.0")


def estimate_cost_usd(*, prompt_tokens: int, completion_tokens: int, model: str = "") -> Decimal:
    total = prompt_tokens + completion_tokens
    if total <= 0:
        return Decimal("0")
    # Slightly higher for research models
    rate = _DEFAULT_COST_PER_1M
    if "sonar" in model or "perplexity" in model:
        rate = Decimal("5.0")
    elif "claude" in model or "gpt-4" in model:
        rate = Decimal("8.0")
    return (Decimal(total) / Decimal("1000000")) * rate


def log_usage(
    *,
    company_id: int,
    user_id: int | None = None,
    conversation_id: int | None = None,
    model: str = "",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    question_type: str = "",
    route: str = "",
    success: bool = True,
    error_message: str = "",
    latency_ms: int | None = None,
) -> BrainUsageLog:
    total = prompt_tokens + completion_tokens
    cost = estimate_cost_usd(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        model=model,
    )
    return BrainUsageLog.objects.create(
        company_id=company_id,
        user_id=user_id,
        conversation_id=conversation_id,
        model=model[:128],
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total,
        estimated_cost_usd=cost,
        question_type=question_type[:32],
        route=route[:64],
        success=success,
        error_message=(error_message or "")[:2000],
        latency_ms=latency_ms,
    )


def usage_summary_for_company(company_id: int, *, month: date | None = None) -> dict[str, Any]:
    today = timezone.localdate()
    month_start = (month or today).replace(day=1)
    qs = BrainUsageLog.objects.filter(
        company_id=company_id,
        created_at__date__gte=month_start,
    )
    agg = qs.aggregate(
        total_tokens=Sum("total_tokens"),
        total_cost=Sum("estimated_cost_usd"),
    )
    count = qs.count()
    return {
        "month": month_start.isoformat(),
        "request_count": count,
        "total_tokens": int(agg.get("total_tokens") or 0),
        "estimated_cost_usd": str(agg.get("total_cost") or Decimal("0")),
    }


def assert_within_monthly_budget(company_id: int) -> tuple[bool, str]:
    """Return (ok, error_message) when monthly token/cost budget is exceeded."""
    settings = get_company_settings(company_id)
    summary = usage_summary_for_company(company_id)
    total_tokens = int(summary.get("total_tokens") or 0)
    if settings.monthly_token_budget and total_tokens >= settings.monthly_token_budget:
        return (
            False,
            "Monthly AI token budget exceeded for this company. Contact your admin or wait until next month.",
        )
    if settings.monthly_cost_budget_usd is not None:
        spent = Decimal(str(summary.get("estimated_cost_usd") or "0"))
        if spent >= settings.monthly_cost_budget_usd:
            return (
                False,
                "Monthly AI cost budget exceeded for this company. Contact your admin or wait until next month.",
            )
    return True, ""


def platform_usage_summary(*, days: int = 30) -> dict[str, Any]:
    since = timezone.now() - timezone.timedelta(days=days)
    qs = BrainUsageLog.objects.filter(created_at__gte=since)
    agg = qs.aggregate(
        total_tokens=Sum("total_tokens"),
        total_cost=Sum("estimated_cost_usd"),
    )
    return {
        "days": days,
        "request_count": qs.count(),
        "total_tokens": int(agg.get("total_tokens") or 0),
        "estimated_cost_usd": str(agg.get("total_cost") or Decimal("0")),
    }
