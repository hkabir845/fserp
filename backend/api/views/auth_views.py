"""Auth: login and refresh."""
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from api.models import User
from api.services.permission_service import user_client_dict
from api.utils.auth import create_tokens, get_user_from_request, tenant_company_allows_access


def _parse_login_body(request):
    """Get username and password from request (form, json, or urlencoded)."""
    content_type = request.META.get("CONTENT_TYPE", "") or ""
    username, password = None, None

    if "application/json" in content_type:
        try:
            data = json.loads(request.body)
            username = (data.get("username") or "").strip()
            password = data.get("password")
        except Exception:
            pass
    elif "application/x-www-form-urlencoded" in content_type:
        from urllib.parse import parse_qs
        body = request.body.decode("utf-8") if request.body else ""
        data = parse_qs(body)
        username = (data.get("username", [""])[0] or "").strip()
        password = data.get("password", [""])[0]
    else:
        # Form data
        username = (request.POST.get("username") or "").strip()
        password = request.POST.get("password")

    return username, password


def _user_to_json(user):
    return user_client_dict(user)


@csrf_exempt
@require_http_methods(["POST"])
def login(request):
    """Accept form, json, or x-www-form-urlencoded. Return access_token, refresh_token, user."""
    username, password = _parse_login_body(request)
    if not username or not password:
        return JsonResponse({"detail": "username and password required"}, status=400)
    user = User.objects.filter(username__iexact=username, is_active=True).select_related(
        "custom_role"
    ).first()
    if not user or not user.check_password(password):
        return JsonResponse({"detail": "Invalid credentials"}, status=401)
    if not tenant_company_allows_access(user):
        return JsonResponse(
            {"detail": "This company account is inactive. Contact your administrator."},
            status=403,
        )
    access_token, refresh_token = create_tokens(user)
    return JsonResponse({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": _user_to_json(user),
    })


@csrf_exempt
@require_http_methods(["POST"])
def refresh(request):
    """Expect JSON { refresh_token: "..." }. Return { access_token: "..." }."""
    try:
        body = request.body
        if not body or (hasattr(body, "strip") and not body.strip()):
            return JsonResponse({"detail": "Request body required"}, status=400)
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        data = json.loads(body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    except Exception as e:
        return JsonResponse({"detail": "Bad request"}, status=400)
    if not isinstance(data, dict):
        return JsonResponse({"detail": "JSON object required"}, status=400)
    refresh_token = data.get("refresh_token")
    if refresh_token is None:
        return JsonResponse({"detail": "refresh_token required"}, status=400)
    if not isinstance(refresh_token, str):
        refresh_token = str(refresh_token)
    refresh_token = refresh_token.strip()
    if not refresh_token:
        return JsonResponse({"detail": "refresh_token required"}, status=400)
    import jwt
    from django.conf import settings
    try:
        payload = jwt.decode(
            refresh_token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
            options={"verify_exp": True},
            leeway=60,
        )
    except jwt.ExpiredSignatureError:
        return JsonResponse({"detail": "Refresh token expired"}, status=401)
    except jwt.InvalidTokenError:
        return JsonResponse({"detail": "Invalid refresh token"}, status=401)
    except Exception:
        return JsonResponse({"detail": "Invalid or expired refresh token"}, status=401)
    if payload.get("type") != "refresh":
        return JsonResponse({"detail": "Invalid token type"}, status=401)
    username = payload.get("sub")
    if username is None or username == "":
        return JsonResponse({"detail": "Invalid token"}, status=401)
    if not isinstance(username, str):
        username = str(username)
    try:
        user = User.objects.filter(username__iexact=username, is_active=True).select_related(
        "custom_role"
    ).first()
    except Exception:
        return JsonResponse({"detail": "Server error"}, status=500)
    if not user:
        return JsonResponse({"detail": "User not found"}, status=401)
    if not tenant_company_allows_access(user):
        return JsonResponse(
            {"detail": "This company account is inactive. Contact your administrator."},
            status=403,
        )
    try:
        access_token, _ = create_tokens(user)
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")
        return JsonResponse({"access_token": access_token, "token_type": "bearer"})
    except Exception:
        return JsonResponse({"detail": "Server error"}, status=500)
