"""Company-scoped job types (CRUD) — custom titles + access-profile allowlists."""
from __future__ import annotations

import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import CompanyJobType, CompanyRole, User
from api.services.tenant_job_types import (
    TENANT_USER_ROLES,
    is_valid_job_type_key,
    normalize_job_type_key,
    slugify_job_type_key,
    tenant_job_types_for_api,
)
from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import require_company_id
from api.views.company_roles_views import _tenants_can_edit_roles


def _api_user(request) -> User | None:
    return getattr(request, "api_user", None) or get_user_from_request(request)


def _serialize_job_type(jt: CompanyJobType) -> dict:
    allowed = list(jt.allowed_roles.all()) if jt.pk else []
    return {
        "id": jt.id,
        "key": jt.key,
        "label": jt.label,
        "hint": jt.hint or "",
        "inherits_from": jt.inherits_from or "",
        "is_custom": bool(jt.is_custom),
        "access_profile_enabled": bool(jt.access_profile_enabled),
        "allowed_role_ids": [int(r.id) for r in allowed],
        "is_active": bool(jt.is_active),
        "sort_order": int(jt.sort_order or 200),
        "company_id": jt.company_id,
        "created_at": jt.created_at.isoformat() if jt.created_at else None,
        "updated_at": jt.updated_at.isoformat() if jt.updated_at else None,
    }


def _parse_allowed_role_ids(data: dict, company_id: int) -> tuple[list[int] | None, JsonResponse | None]:
    if "allowed_role_ids" not in data:
        return None, None
    raw = data.get("allowed_role_ids")
    if raw is None:
        return [], None
    if not isinstance(raw, list):
        return None, JsonResponse({"detail": "allowed_role_ids must be a list of numbers."}, status=400)
    ids: list[int] = []
    for item in raw:
        try:
            ids.append(int(item))
        except (TypeError, ValueError):
            return None, JsonResponse({"detail": "allowed_role_ids must be a list of numbers."}, status=400)
    if not ids:
        return [], None
    found = set(
        CompanyRole.objects.filter(company_id=company_id, pk__in=ids).values_list("id", flat=True)
    )
    missing = [i for i in ids if i not in found]
    if missing:
        return None, JsonResponse(
            {"detail": "One or more access profiles do not belong to this company."},
            status=400,
        )
    return ids, None


@csrf_exempt
@auth_required
@require_http_methods(["GET", "POST"])
@require_company_id
def company_job_types_list_or_create(request):
    api = _api_user(request)
    if not api or not _tenants_can_edit_roles(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    cid = int(request.company_id)
    if not user_is_super_admin(api) and getattr(api, "company_id", None) != cid:
        return JsonResponse({"detail": "Permission denied"}, status=403)

    if request.method == "GET":
        # Full picker (built-ins + company rows) for Users/Roles UIs
        merged = tenant_job_types_for_api(cid)
        managed = [
            _serialize_job_type(jt)
            for jt in CompanyJobType.objects.filter(company_id=cid)
            .prefetch_related("allowed_roles")
            .order_by("sort_order", "label")
        ]
        return JsonResponse(
            {
                "company_id": cid,
                "job_types": merged,
                "managed": managed,
            }
        )

    # POST — create custom job type, or upsert builtin override
    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    label = (data.get("label") or "").strip()
    if not label:
        return JsonResponse({"detail": "label is required"}, status=400)

    raw_key = (data.get("key") or "").strip()
    key = normalize_job_type_key(raw_key) if raw_key else slugify_job_type_key(label)
    if not is_valid_job_type_key(key):
        return JsonResponse(
            {
                "detail": (
                    "key must be 2–64 chars, start with a letter, and use only "
                    "lowercase letters, numbers, and underscores."
                )
            },
            status=400,
        )

    is_builtin = key in TENANT_USER_ROLES
    is_custom = not is_builtin
    if "is_custom" in data:
        # Allow explicit override row for built-ins; reject pretending a builtin is custom.
        want_custom = bool(data.get("is_custom"))
        if is_builtin and want_custom:
            return JsonResponse(
                {"detail": f'"{key}" is a built-in job type. Enable access profiles on it instead of recreating it.'},
                status=400,
            )
        is_custom = want_custom and not is_builtin

    if CompanyJobType.objects.filter(company_id=cid, key=key).exists():
        return JsonResponse(
            {"detail": "A job type with this key already exists for this company."},
            status=400,
        )

    inherits_from = normalize_job_type_key(data.get("inherits_from") or "")
    if is_custom:
        if not inherits_from:
            inherits_from = "cashier"
        if inherits_from not in TENANT_USER_ROLES:
            return JsonResponse(
                {"detail": "inherits_from must be a built-in job type key."},
                status=400,
            )
    else:
        inherits_from = key

    hint = (data.get("hint") or "").strip()[:500]
    access_profile_enabled = bool(data.get("access_profile_enabled", False))
    sort_order = data.get("sort_order")
    try:
        sort_order_i = int(sort_order) if sort_order is not None else (200 if is_custom else 100)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "sort_order must be a number."}, status=400)

    allowed_ids, err = _parse_allowed_role_ids(data, cid)
    if err is not None:
        return err

    jt = CompanyJobType(
        company_id=cid,
        key=key,
        label=label[:120],
        hint=hint,
        inherits_from=inherits_from,
        is_custom=is_custom,
        access_profile_enabled=access_profile_enabled,
        is_active=True,
        sort_order=sort_order_i,
    )
    jt.save()
    if allowed_ids is not None:
        jt.allowed_roles.set(allowed_ids)
    return JsonResponse(_serialize_job_type(jt), status=201)


@csrf_exempt
@auth_required
@require_http_methods(["GET", "PUT", "DELETE"])
@require_company_id
def company_job_type_detail(request, job_type_id: int):
    api = _api_user(request)
    if not api or not _tenants_can_edit_roles(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    cid = int(request.company_id)
    if not user_is_super_admin(api) and getattr(api, "company_id", None) != cid:
        return JsonResponse({"detail": "Permission denied"}, status=403)
    try:
        jt = CompanyJobType.objects.prefetch_related("allowed_roles").get(
            pk=job_type_id, company_id=cid
        )
    except CompanyJobType.DoesNotExist:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        d = _serialize_job_type(jt)
        d["active_user_count"] = User.objects.filter(
            company_id=cid, role__iexact=jt.key, is_active=True
        ).count()
        return JsonResponse(d)

    if request.method == "DELETE":
        if jt.is_custom:
            in_use = User.objects.filter(company_id=cid, role__iexact=jt.key).count()
            if in_use:
                return JsonResponse(
                    {
                        "detail": (
                            f"Cannot delete: {in_use} user(s) still use this job type. "
                            "Reassign those users first."
                        )
                    },
                    status=400,
                )
        # Builtin override: deleting restores unrestricted built-in behavior.
        jt.delete()
        return JsonResponse({"detail": "Job type deleted"})

    # PUT
    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    if "label" in data:
        label = (data.get("label") or "").strip()
        if not label:
            return JsonResponse({"detail": "label cannot be empty"}, status=400)
        jt.label = label[:120]
    if "hint" in data:
        jt.hint = (data.get("hint") or "").strip()[:500]
    if "access_profile_enabled" in data:
        jt.access_profile_enabled = bool(data.get("access_profile_enabled"))
    if "is_active" in data:
        jt.is_active = bool(data.get("is_active"))
    if "sort_order" in data:
        try:
            jt.sort_order = int(data.get("sort_order"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "sort_order must be a number."}, status=400)
    if jt.is_custom and "inherits_from" in data:
        inherits_from = normalize_job_type_key(data.get("inherits_from") or "")
        if inherits_from not in TENANT_USER_ROLES:
            return JsonResponse(
                {"detail": "inherits_from must be a built-in job type key."},
                status=400,
            )
        jt.inherits_from = inherits_from

    allowed_ids, err = _parse_allowed_role_ids(data, cid)
    if err is not None:
        return err

    jt.save()
    if allowed_ids is not None:
        jt.allowed_roles.set(allowed_ids)
    jt = CompanyJobType.objects.prefetch_related("allowed_roles").get(pk=jt.pk)
    return JsonResponse(_serialize_job_type(jt))
