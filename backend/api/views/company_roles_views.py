"""Company-scoped custom roles (CRUD) for tenant admins."""
from __future__ import annotations

import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import CompanyRole, User
from api.services.permission_service import (
    PERMISSION_CATALOG,
    has_permission,
    resolve_user_permissions,
    role_default_permissions_for_catalog,
    sanitize_tenant_role_permissions,
)
from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import require_company_id

def _api_user(request) -> User | None:
    return getattr(request, "api_user", None) or get_user_from_request(request)


def _is_company_admin(u) -> bool:
    if not u:
        return False
    return (getattr(u, "role", None) or "").lower() == "admin" and getattr(
        u, "company_id", None
    )


def _tenants_can_edit_roles(api_user) -> bool:
    """
    Super admin, tenant admin (job title), or any company user with effective
    permission app.roles (e.g. custom role) — must match company scope below.
    """
    if not api_user:
        return False
    if user_is_super_admin(api_user):
        return True
    if _is_company_admin(api_user):
        return True
    if not getattr(api_user, "company_id", None):
        return False
    perms = resolve_user_permissions(api_user)
    return has_permission(perms, "app.roles")


def _serialize_role(cr: CompanyRole) -> dict:
    return {
        "id": cr.id,
        "name": cr.name,
        "description": cr.description or "",
        "permissions": list(cr.permissions) if cr.permissions else [],
        "company_id": cr.company_id,
        "created_at": cr.created_at.isoformat() if cr.created_at else None,
        "updated_at": cr.updated_at.isoformat() if cr.updated_at else None,
    }


@csrf_exempt
@auth_required
@require_http_methods(["GET"])
@require_company_id
def permission_catalog(request):
    """
    All assignable permission keys (for the Roles editor). Tenant must have company context.
    """
    api = _api_user(request)
    if not api or not _tenants_can_edit_roles(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    return JsonResponse(
        {
            "permissions": PERMISSION_CATALOG,
            "role_defaults": role_default_permissions_for_catalog(),
        }
    )


@csrf_exempt
@auth_required
@require_http_methods(["GET", "POST"])
@require_company_id
def company_roles_list_or_create(request):
    api = _api_user(request)
    if not api or not _tenants_can_edit_roles(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    cid = int(request.company_id)
    if not user_is_super_admin(api) and getattr(api, "company_id", None) != cid:
        return JsonResponse({"detail": "Permission denied"}, status=403)

    if request.method == "GET":
        out = [
            _serialize_role(cr)
            for cr in CompanyRole.objects.filter(company_id=cid).order_by("name")
        ]
        return JsonResponse({"company_id": cid, "results": out})

    # POST
    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    name = (data.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "name is required"}, status=400)
    desc = (data.get("description") or "").strip()[:500]
    perms = data.get("permissions")
    if perms is None:
        perms = []
    if not isinstance(perms, list):
        return JsonResponse({"detail": "permissions must be a list of strings"}, status=400)
    if CompanyRole.objects.filter(company_id=cid, name__iexact=name).exists():
        return JsonResponse(
            {"detail": "A role with this name already exists."},
            status=400,
        )
    cr = CompanyRole(
        company_id=cid,
        name=name,
        description=desc,
        permissions=sanitize_tenant_role_permissions(perms),
    )
    cr.save()
    return JsonResponse(_serialize_role(cr), status=201)


@csrf_exempt
@auth_required
@require_http_methods(["GET", "PUT", "DELETE"])
@require_company_id
def company_role_detail(request, role_id: int):
    api = _api_user(request)
    if not api or not _tenants_can_edit_roles(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    cid = int(request.company_id)
    if not user_is_super_admin(api) and getattr(api, "company_id", None) != cid:
        return JsonResponse({"detail": "Permission denied"}, status=403)
    try:
        cr = CompanyRole.objects.get(pk=role_id, company_id=cid)
    except CompanyRole.DoesNotExist:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        in_use = User.objects.filter(custom_role=cr, is_active=True).count()
        d = _serialize_role(cr)
        d["active_user_count"] = in_use
        return JsonResponse(d)

    if request.method == "DELETE":
        n = User.objects.filter(custom_role=cr).update(custom_role=None)
        cr.delete()
        return JsonResponse(
            {
                "detail": "Role deleted",
                "users_unassigned": n,
            }
        )

    # PUT
    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    if "name" in data:
        nm = (data.get("name") or "").strip()
        if not nm:
            return JsonResponse({"detail": "name cannot be empty"}, status=400)
        if (
            CompanyRole.objects.filter(company_id=cid, name__iexact=nm)
            .exclude(pk=cr.pk)
            .exists()
        ):
            return JsonResponse({"detail": "A role with this name already exists."}, status=400)
        cr.name = nm
    if "description" in data:
        cr.description = (data.get("description") or "").strip()[:500]
    if "permissions" in data:
        perms = data.get("permissions")
        if not isinstance(perms, list):
            return JsonResponse({"detail": "permissions must be a list of strings"}, status=400)
        cr.permissions = sanitize_tenant_role_permissions(perms)
    cr.save()
    return JsonResponse(_serialize_role(cr))
