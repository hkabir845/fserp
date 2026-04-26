"""User CRUD: super_admin sees all tenants; company admin manages users in their company only."""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.utils.recovery_email import profile_allows_password_recovery
from api.models import BroadcastRead, User, Company, CompanyRole
from api.services.permission_service import user_client_dict, POS_SALE_SCOPES, normalize_role_key

logger = logging.getLogger(__name__)

TENANT_USER_ROLES = frozenset({"admin", "accountant", "cashier", "operator"})


def _set_pos_sale_scope_cashier_operator(user: User, data: dict, force_default: bool) -> "JsonResponse|None":
    """Set User.pos_sale_scope. force_default: create user when key omitted (use 'both')."""
    r = normalize_role_key(user.role)
    if r not in ("cashier", "operator"):
        user.pos_sale_scope = "both"
        return None
    if not force_default and "pos_sale_scope" not in data:
        return None
    raw = data.get("pos_sale_scope", "both")
    val = (str(raw) if raw is not None else "both").strip().lower()
    if val not in POS_SALE_SCOPES:
        return JsonResponse(
            {"detail": f"pos_sale_scope must be one of: {', '.join(POS_SALE_SCOPES)}"},
            status=400,
        )
    user.pos_sale_scope = val
    return None


def _set_custom_role_from_request(user: User, data: dict, api_user, company_id: int | None) -> "JsonResponse|None":
    if "custom_role_id" not in data:
        return None
    if not _is_super_admin(api_user) and not _is_company_admin(api_user):
        return JsonResponse(
            {"detail": "Only administrators can assign custom roles."},
            status=403,
        )
    raw = data.get("custom_role_id")
    if raw in (None, "", False):
        user.custom_role = None
        return None
    if company_id is None:
        return JsonResponse(
            {"detail": "Custom roles can only be assigned to users in a company."},
            status=400,
        )
    try:
        crid = int(raw)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "custom_role_id must be a number or null."}, status=400)
    cr = CompanyRole.objects.filter(pk=crid).first()
    if not cr or int(cr.company_id) != int(company_id):
        return JsonResponse(
            {"detail": "The selected role does not belong to this company."},
            status=400,
        )
    user.custom_role = cr
    return None


def _api_user(request):
    return getattr(request, "api_user", None) or get_user_from_request(request)


def _is_super_admin(u):
    return bool(u and user_is_super_admin(u))


def _is_company_admin(u):
    return u and getattr(u, "role", "") == "admin" and getattr(u, "company_id", None)


def _can_manage_user(api_user, target):
    """Super admin: any user. Company admin: same company, target not super_admin."""
    if not api_user or not target:
        return False
    if _is_super_admin(api_user):
        return True
    if _is_company_admin(api_user) and not user_is_super_admin(target):
        return target.company_id == api_user.company_id
    return False


def _user_to_json(u):
    company_name = ""
    if u.company_id:
        co = Company.objects.filter(id=u.company_id).first()
        if co:
            company_name = co.name
    created_at = getattr(u, "created_at", None)
    base = user_client_dict(u)
    base["company_name"] = company_name
    base["is_active"] = getattr(u, "is_active", True)
    base["created_at"] = created_at.isoformat() if created_at else None
    return base


@csrf_exempt
@require_http_methods(["GET", "POST"])
@auth_required
def users_list_or_create(request):
    """GET list users. POST create user. Super admin: all companies. Company admin: own company only."""
    api_user = _api_user(request)
    if not api_user:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    if not _is_super_admin(api_user) and not _is_company_admin(api_user):
        return JsonResponse({"detail": "Permission denied"}, status=403)

    if request.method == "GET":
        skip = int(request.GET.get("skip", 0))
        limit = min(int(request.GET.get("limit", 100)), 200)
        if _is_super_admin(api_user):
            qs = (
                User.objects.select_related("custom_role")
                .order_by("id")
            )[skip : skip + limit]
        else:
            # Company admins see active and inactive so they can reactivate without extra flags.
            qs = (
                User.objects.filter(company_id=api_user.company_id)
                .select_related("custom_role")
                .order_by("-is_active", "id")
            )[skip : skip + limit]
        result = [_user_to_json(u) for u in qs]
        return JsonResponse(result, safe=False)

    # POST - create
    try:
        body = request.body
        if not body:
            return JsonResponse({"detail": "Request body required"}, status=400)
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        data = json.loads(body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    if not username and email:
        username = email
    full_name = (data.get("full_name") or "").strip()
    role = (data.get("role") or "user").strip() or "user"
    password = data.get("password")
    company_id = data.get("company_id")
    if company_id is not None and company_id != "":
        try:
            company_id = int(company_id)
        except (TypeError, ValueError):
            company_id = None
    else:
        company_id = None

    if _is_company_admin(api_user):
        company_id = api_user.company_id
        if role not in TENANT_USER_ROLES:
            return JsonResponse(
                {
                    "detail": "Role must be one of: admin, accountant, cashier, operator for company users.",
                },
                status=400,
            )
    elif _is_super_admin(api_user):
        pass
    else:
        return JsonResponse({"detail": "Permission denied"}, status=403)

    if not username:
        return JsonResponse({"detail": "email/username required"}, status=400)
    if not password:
        return JsonResponse({"detail": "password required"}, status=400)
    if not profile_allows_password_recovery(username=username, email=email):
        return JsonResponse(
            {
                "detail": (
                    "If the username is not an email address, profile email is required (used for sign-in, "
                    "forgot password, and notifications). Either set a valid email as username, or add email."
                ),
            },
            status=400,
        )
    e_norm = (email or "").strip()
    if e_norm and User.objects.filter(email__iexact=e_norm).exists():
        return JsonResponse(
            {"detail": "Another user already uses this email address."},
            status=400,
        )
    if User.objects.filter(username__iexact=username).exists():
        return JsonResponse({"detail": "User with this username already exists"}, status=400)
    try:
        user = User(
            username=username,
            email=email,
            full_name=full_name or username,
            role=role,
            company_id=company_id,
        )
        err = _set_custom_role_from_request(user, data, api_user, company_id)
        if err is not None:
            return err
        err2 = _set_pos_sale_scope_cashier_operator(user, data, force_default=True)
        if err2 is not None:
            return err2
        user.set_password(password)
        user.save()
        return JsonResponse(
            _user_to_json(
                User.objects.filter(pk=user.pk).select_related("custom_role").first() or user
            ),
            status=201,
        )
    except Exception as e:
        logger.exception("create user error")
        return JsonResponse({"detail": "Failed to create user", "error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
@auth_required
def user_detail(request, user_id):
    """GET/PUT/DELETE /api/users/<id>/."""
    try:
        api_user = _api_user(request)
        if not api_user:
            return JsonResponse({"detail": "Authentication required"}, status=401)

        try:
            user = User.objects.filter(id=user_id).select_related("custom_role").first()
        except Exception as e:
            logger.exception("user_detail load error")
            return JsonResponse({"detail": "Server error", "error": str(e)}, status=500)
        if not user:
            return JsonResponse({"detail": "User not found"}, status=404)
        if not _can_manage_user(api_user, user):
            return JsonResponse({"detail": "Permission denied"}, status=403)

        if request.method == "GET":
            return JsonResponse(_user_to_json(user))

        if request.method == "DELETE":
            # DELETE always removes the row from the database. Use PUT { "is_active": false } to disable login only.
            if user.id == api_user.id:
                return JsonResponse({"detail": "You cannot delete your own account."}, status=400)
            if user_is_super_admin(user):
                others = User.objects.filter(is_active=True).exclude(pk=user.pk)
                if not any(user_is_super_admin(u) for u in others):
                    return JsonResponse(
                        {
                            "detail": "Cannot delete: at least one other active Super Admin must remain."
                        },
                        status=400,
                    )
            try:
                BroadcastRead.objects.filter(user_id=user.id).delete()
                user.delete()
            except Exception as e_orm:
                logger.exception("delete user failed: %s", e_orm)
                return JsonResponse(
                    {"detail": "Failed to delete user", "error": str(e_orm)},
                    status=500,
                )
            return JsonResponse({"detail": "User deleted permanently"}, status=200)

        # PUT
        body = request.body
        if not body:
            return JsonResponse({"detail": "Request body required"}, status=400)
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        data = json.loads(body)

        if "is_active" in data:
            raw = data.get("is_active")
            if isinstance(raw, str):
                active = raw.strip().lower() in ("true", "1", "yes")
            elif isinstance(raw, bool):
                active = raw
            else:
                return JsonResponse({"detail": "is_active must be true or false"}, status=400)
            if user.id == api_user.id and not active:
                return JsonResponse({"detail": "You cannot deactivate your own account."}, status=400)
            user.is_active = active

        if _is_company_admin(api_user):
            new_role = (data.get("role") or user.role or "").strip()
            if data.get("role") is not None and new_role not in TENANT_USER_ROLES:
                return JsonResponse(
                    {
                        "detail": "Role must be one of: admin, accountant, cashier, operator.",
                    },
                    status=400,
                )
        if data.get("email") is not None:
            user.email = (data.get("email") or "").strip()
        if data.get("username") is not None:
            user.username = (data.get("username") or "").strip()
        elif data.get("email") is not None:
            user.username = user.email
        if data.get("full_name") is not None:
            user.full_name = (data.get("full_name") or "").strip()
        if data.get("role") is not None:
            user.role = (data.get("role") or "user").strip() or "user"
        serr = _set_pos_sale_scope_cashier_operator(user, data, force_default=False)
        if serr is not None:
            return serr
        if "company_id" in data and _is_super_admin(api_user):
            cid = data.get("company_id")
            if cid is None or cid == "":
                user.company_id = None
            else:
                try:
                    user.company_id = int(cid)
                except (TypeError, ValueError):
                    user.company_id = None
        if "custom_role_id" in data:
            err = _set_custom_role_from_request(user, data, api_user, user.company_id)
            if err is not None:
                return err
        if data.get("password"):
            user.set_password(data["password"])
        final_username = (user.username or "").strip()
        if not final_username:
            return JsonResponse({"detail": "username cannot be empty"}, status=400)
        if User.objects.filter(username__iexact=final_username).exclude(pk=user.pk).exists():
            return JsonResponse({"detail": "User with this username already exists"}, status=400)
        if "email" in data or "username" in data:
            if not profile_allows_password_recovery(
                username=final_username, email=(user.email or "").strip()
            ):
                return JsonResponse(
                    {
                        "detail": (
                            "When the username is not an email, profile email is required for forgot password. "
                            "Set a non-empty email or change the username to a valid email address."
                        ),
                    },
                    status=400,
                )
            fin_e = (user.email or "").strip()
            if fin_e and User.objects.filter(email__iexact=fin_e).exclude(pk=user.pk).exists():
                return JsonResponse(
                    {"detail": "Another user already uses this email address."},
                    status=400,
                )
        user.save()
        return JsonResponse(_user_to_json(user))
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.exception("user_detail error")
        return JsonResponse({"detail": "Server error", "error": str(e)}, status=500)
