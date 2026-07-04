"""Brain subscription tiers and daily usage limits."""
from __future__ import annotations

from datetime import date

from django.db.models import Count
from django.utils import timezone

from api.models import BrainMessage, Company

PLAN_FREE = "free"
PLAN_GROWTH = "growth"
PLAN_ENTERPRISE = "enterprise"

PLAN_LABELS = {
    PLAN_FREE: "Free",
    PLAN_GROWTH: "Growth",
    PLAN_ENTERPRISE: "Enterprise",
}

DAILY_MESSAGE_LIMITS: dict[str, int | None] = {
    PLAN_FREE: 15,
    PLAN_GROWTH: 200,
    PLAN_ENTERPRISE: None,
}

WEB_RESEARCH_PLANS = frozenset({PLAN_GROWTH, PLAN_ENTERPRISE})


def normalize_brain_plan(raw: str | None) -> str:
    key = (raw or PLAN_FREE).strip().lower()
    if key in (PLAN_FREE, PLAN_GROWTH, PLAN_ENTERPRISE):
        return key
    if key in ("starter", "paid"):
        return PLAN_GROWTH
    if key in ("enterprise", "platform", "custom"):
        return PLAN_ENTERPRISE
    return PLAN_FREE


def brain_plan_for_company(company: Company | None) -> str:
    if not company:
        return PLAN_FREE
    explicit = normalize_brain_plan(getattr(company, "brain_plan", None))
    if explicit != PLAN_FREE:
        return explicit
    billing = (getattr(company, "billing_plan_code", None) or "").strip().lower()
    if billing in ("growth", "enterprise", "platform", "custom"):
        return PLAN_GROWTH if billing == "growth" else PLAN_ENTERPRISE
    return PLAN_FREE


def messages_used_today(company_id: int) -> int:
    today = timezone.localdate()
    return (
        BrainMessage.objects.filter(
            conversation__company_id=company_id,
            role=BrainMessage.ROLE_USER,
            created_at__date=today,
        ).count()
    )


def usage_status(company: Company) -> dict:
    plan = brain_plan_for_company(company)
    limit = DAILY_MESSAGE_LIMITS.get(plan)
    used = messages_used_today(int(company.id))
    remaining = None if limit is None else max(0, limit - used)
    return {
        "plan": plan,
        "plan_label": PLAN_LABELS.get(plan, plan),
        "messages_used_today": used,
        "daily_message_limit": limit,
        "messages_remaining_today": remaining,
        "web_research_enabled": plan in WEB_RESEARCH_PLANS,
        "llm_enabled": bool((__import__("os").environ.get("OPENROUTER_API_KEY") or "").strip()),
    }


def assert_can_send_message(company: Company) -> tuple[bool, str]:
    status = usage_status(company)
    limit = status["daily_message_limit"]
    if limit is not None and status["messages_used_today"] >= limit:
        return (
            False,
            "আজকের বার্তা সীমা শেষ হয়েছে। Growth প্ল্যানে আপগ্রেড করুন অথবা আগামীকাল আবার চেষ্টা করুন।",
        )
    return True, ""
