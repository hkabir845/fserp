"""Super Admin — platform-wide Company Brain API configuration."""
from __future__ import annotations

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import BrainCompanySettings, BrainUsageLog, Company
from api.services.brain import config as brain_config
from api.services.brain import usage_logging as brain_usage
from api.services.brain.audit import log_action
from api.utils.auth import auth_required, get_user_from_request
from api.views.admin_views import _super_admin_required
from api.views.common import parse_json_body


@csrf_exempt
@require_http_methods(["GET", "PUT"])
@auth_required
@_super_admin_required
def admin_brain_config(request):
    """GET/PUT /api/admin/brain-config/ — OpenRouter keys for free vs paid Brain tiers."""
    if request.method == "GET":
        payload = brain_config.serialize_brain_config_for_admin()
        payload["platform_usage"] = brain_usage.platform_usage_summary(days=30)
        return JsonResponse(payload)

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    user = get_user_from_request(request)
    try:
        brain_config.update_brain_config_from_admin(body or {}, user_id=user.id if user else None)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    log_action(
        action_type="brain_config_update",
        description="Platform Brain config updated",
        user_id=user.id if user else None,
        metadata={"fields": list((body or {}).keys())},
    )
    payload = brain_config.serialize_brain_config_for_admin()
    payload["platform_usage"] = brain_usage.platform_usage_summary(days=30)
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(["GET", "PUT"])
@auth_required
@_super_admin_required
def admin_brain_company_settings(request, company_id: int):
    """Super admin: enable/disable Brain and set budgets per company."""
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)

    from api.services.brain.security import get_company_settings

    settings = get_company_settings(company_id)

    if request.method == "GET":
        usage = brain_usage.usage_summary_for_company(company_id)
        return JsonResponse(
            {
                "company_id": company_id,
                "company_name": company.name,
                "brain_plan": company.brain_plan,
                "brain_enabled": settings.brain_enabled,
                "monthly_token_budget": settings.monthly_token_budget,
                "monthly_cost_budget_usd": str(settings.monthly_cost_budget_usd or ""),
                "usage_month": usage,
            }
        )

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    user = get_user_from_request(request)
    if "brain_enabled" in body:
        settings.brain_enabled = bool(body.get("brain_enabled"))
    if "brain_plan" in body:
        plan = (body.get("brain_plan") or "free").strip()[:16]
        if plan in ("free", "growth", "enterprise"):
            company.brain_plan = plan
            company.save(update_fields=["brain_plan"])
    if "monthly_token_budget" in body:
        val = body.get("monthly_token_budget")
        settings.monthly_token_budget = int(val) if val not in (None, "") else None
    if "monthly_cost_budget_usd" in body:
        val = body.get("monthly_cost_budget_usd")
        settings.monthly_cost_budget_usd = val if val not in (None, "") else None
    settings.save()
    log_action(
        action_type="brain_company_settings",
        description=f"Brain settings updated for company {company_id}",
        company_id=company_id,
        user_id=user.id if user else None,
        metadata=body or {},
    )
    return JsonResponse({"ok": True})


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_brain_usage_logs(request):
    """Platform-wide AI usage logs for super admin."""
    days = int(request.GET.get("days") or 30)
    summary = brain_usage.platform_usage_summary(days=days)
    rows = BrainUsageLog.objects.select_related("company").order_by("-created_at")[:100]
    return JsonResponse(
        {
            "summary": summary,
            "results": [
                {
                    "id": r.id,
                    "company_id": r.company_id,
                    "company_name": r.company.name if r.company_id else "",
                    "model": r.model,
                    "total_tokens": r.total_tokens,
                    "estimated_cost_usd": str(r.estimated_cost_usd),
                    "question_type": r.question_type,
                    "success": r.success,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
        }
    )
