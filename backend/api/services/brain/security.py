"""Tenant isolation and permission checks for Company Brain."""
from __future__ import annotations

from django.http import JsonResponse

from api.models import BrainConversation, BrainCompanySettings, Company
from api.services.permission_service import has_permission, resolve_user_permissions
from api.utils.auth import get_company_id, user_is_super_admin


def brain_access_denied_response(request) -> JsonResponse | None:
    user = getattr(request, "api_user", None)
    if user_is_super_admin(user):
        return None
    perms = resolve_user_permissions(user) if user else []
    if has_permission(perms, "app.brain"):
        return None
    return JsonResponse(
        {"detail": "Company Brain access required. Ask your admin to grant app.brain permission."},
        status=403,
    )


def assert_company_scope(request, company_id: int) -> JsonResponse | None:
    """Ensure request company header matches the resource company."""
    cid = get_company_id(request)
    if cid is None:
        return JsonResponse({"detail": "Company context required."}, status=400)
    if int(cid) != int(company_id):
        return JsonResponse({"detail": "Cross-tenant access denied."}, status=403)
    return None


def get_company_settings(company_id: int) -> BrainCompanySettings:
    settings, _ = BrainCompanySettings.objects.get_or_create(company_id=company_id)
    return settings


def brain_enabled_for_company(company_id: int) -> bool:
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    if not company:
        return False
    settings = BrainCompanySettings.objects.filter(company_id=company_id).first()
    if settings and not settings.brain_enabled:
        return False
    return True


def brain_disabled_response() -> JsonResponse:
    return JsonResponse(
        {"detail": "Company Brain is disabled for this company. Contact platform admin."},
        status=403,
    )


def get_conversation_for_company(conversation_id: int, company_id: int) -> BrainConversation | None:
    return BrainConversation.objects.filter(pk=conversation_id, company_id=company_id).first()
