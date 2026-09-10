"""Auth: login and refresh."""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import User
from api.services.auth_refresh_sessions import (
    ReplayDetected,
    issue_refresh_session,
    revoke_family,
    revoke_jti,
    revoke_user_sessions,
    rotate_refresh_session,
)
from api.services.permission_service import user_client_dict
from api.utils.auth import create_tokens, tenant_company_allows_access
from api.utils.auth_origin import cookie_refresh_origin_error
from api.utils.rate_limit import (
    account_login_failure_key,
    auth_rate_limits_enabled,
    client_ip,
    rate_limit_count,
    rate_limit_exceeded,
)


def _set_refresh_cookie(response, token: str):
    from django.conf import settings

    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        token,
        max_age=settings.AUTH_REFRESH_COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path="/api/auth/",
    )
    return response


def _clear_refresh_cookie(response):
    from django.conf import settings

    response.delete_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        path="/api/auth/",
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
    )
    return response


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


def _auth_client(request) -> str:
    """browser | native — native keeps refresh_token in the JSON body."""
    raw = (request.META.get("HTTP_X_AUTH_CLIENT") or "").strip().lower()
    if raw in ("browser", "native"):
        return raw
    # Capacitor / mobile shells often omit Sec-Fetch-*; treat missing as native-safe.
    sec_mode = (request.META.get("HTTP_SEC_FETCH_MODE") or "").strip().lower()
    if sec_mode in ("cors", "navigate", "same-origin"):
        return "browser"
    return "native"


def _request_meta(request) -> tuple[str, str]:
    ua = (request.META.get("HTTP_USER_AGENT") or "")[:255]
    return ua, client_ip(request) or ""


@csrf_exempt
@require_http_methods(["POST"])
def login(request):
    """Accept form, json, or x-www-form-urlencoded. Return access_token, refresh_token, user."""
    ip = client_ip(request)
    if auth_rate_limits_enabled() and rate_limit_exceeded(
        key=f"rl:login_ip:v1:{ip}", limit=40, period_seconds=300
    ):
        return JsonResponse(
            {"detail": "Too many login attempts. Please try again later."},
            status=429,
        )
    username, password = _parse_login_body(request)
    if not username or not password:
        return JsonResponse({"detail": "username and password required"}, status=400)
    acct_key = account_login_failure_key(username)
    if auth_rate_limits_enabled() and rate_limit_count(acct_key) >= 12:
        return JsonResponse(
            {"detail": "Too many login attempts for this account. Please try again later."},
            status=429,
        )
    user = User.objects.filter(username__iexact=username, is_active=True).select_related(
        "custom_role", "home_station"
    ).first()
    if not user or not user.check_password(password):
        if auth_rate_limits_enabled() and rate_limit_exceeded(
            key=f"rl:loginfail_ip:v1:{ip}", limit=35, period_seconds=900
        ):
            return JsonResponse(
                {"detail": "Too many login attempts. Please try again later."},
                status=429,
            )
        if auth_rate_limits_enabled():
            rate_limit_exceeded(key=acct_key, limit=12, period_seconds=900)
        return JsonResponse({"detail": "Invalid credentials"}, status=401)
    if not tenant_company_allows_access(user):
        return JsonResponse(
            {"detail": "This company account is inactive. Contact your administrator."},
            status=403,
        )
    ua, ip_addr = _request_meta(request)
    jti, fid, _exp = issue_refresh_session(user, user_agent=ua, ip_address=ip_addr)
    access_token, refresh_token = create_tokens(
        user, refresh_jti=jti, refresh_family_id=fid
    )
    body = {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _user_to_json(user),
    }
    # Browser clients use the HttpOnly cookie only — never put refresh in JS-readable JSON.
    if _auth_client(request) != "browser":
        body["refresh_token"] = refresh_token
    response = JsonResponse(body)
    return _set_refresh_cookie(response, refresh_token)


@csrf_exempt
@require_http_methods(["POST"])
def refresh(request):
    """Expect JSON { refresh_token: "..." }. Return { access_token: "..." }."""
    ip = client_ip(request)
    if auth_rate_limits_enabled() and rate_limit_exceeded(
        key=f"rl:refresh_ip:v1:{ip}", limit=120, period_seconds=300
    ):
        return JsonResponse(
            {"detail": "Too many requests. Please try again later."},
            status=429,
        )
    try:
        body = request.body
        if not body or (hasattr(body, "strip") and not body.strip()):
            data = {}
        else:
            if isinstance(body, bytes):
                body = body.decode("utf-8")
            data = json.loads(body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    except Exception:
        return JsonResponse({"detail": "Bad request"}, status=400)
    if not isinstance(data, dict):
        return JsonResponse({"detail": "JSON object required"}, status=400)
    from django.conf import settings

    body_token = data.get("refresh_token")
    cookie_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
    used_cookie = not (isinstance(body_token, str) and body_token.strip()) and bool(
        cookie_token
    )
    origin_err = cookie_refresh_origin_error(request, used_cookie=used_cookie)
    if origin_err:
        return JsonResponse({"detail": origin_err}, status=403)

    refresh_token = body_token or cookie_token
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
        "custom_role", "home_station"
    ).first()
    except Exception:
        return JsonResponse({"detail": "Server error"}, status=500)
    if not user:
        return JsonResponse({"detail": "User not found"}, status=401)
    from api.utils.auth import _credential_version
    if payload.get("cv") != _credential_version(user):
        return JsonResponse({"detail": "Session expired; sign in again"}, status=401)
    if not tenant_company_allows_access(user):
        return JsonResponse(
            {"detail": "This company account is inactive. Contact your administrator."},
            status=403,
        )

    jti = (payload.get("jti") or "").strip()
    fid = (payload.get("fid") or "").strip()
    ua, ip_addr = _request_meta(request)
    # Legacy refresh JWTs (pre-session ledger) still rotate, but mint a tracked session.
    if not jti or not fid:
        new_jti, new_fid, _exp = issue_refresh_session(
            user, user_agent=ua, ip_address=ip_addr
        )
    else:
        try:
            rotated = rotate_refresh_session(
                user=user,
                jti=jti,
                family_id=fid,
                user_agent=ua,
                ip_address=ip_addr,
            )
        except ReplayDetected as replay:
            revoke_family(replay.family_id)
            resp = JsonResponse(
                {"detail": "Session revoked due to refresh-token reuse. Sign in again."},
                status=401,
            )
            return _clear_refresh_cookie(resp)
        if rotated is None:
            resp = JsonResponse({"detail": "Session expired; sign in again"}, status=401)
            return _clear_refresh_cookie(resp)
        new_jti, new_fid, _exp = rotated

    try:
        access_token, rotated_refresh_token = create_tokens(
            user, refresh_jti=new_jti, refresh_family_id=new_fid
        )
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")
        body = {"access_token": access_token, "token_type": "bearer"}
        if _auth_client(request) != "browser":
            body["refresh_token"] = rotated_refresh_token
        response = JsonResponse(body)
        return _set_refresh_cookie(response, rotated_refresh_token)
    except Exception:
        return JsonResponse({"detail": "Server error"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def logout(request):
    """End the browser refresh session and revoke server-side refresh family/jti."""
    from django.conf import settings
    import jwt

    raw = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if not raw:
        raw = body.get("refresh_token")
    if isinstance(raw, str) and raw.strip():
        try:
            payload = jwt.decode(
                raw.strip(),
                settings.SECRET_KEY,
                algorithms=["HS256"],
                options={"verify_exp": False},
                leeway=60,
            )
            fid = (payload.get("fid") or "").strip()
            jti = (payload.get("jti") or "").strip()
            if fid:
                revoke_family(fid)
            elif jti:
                revoke_jti(jti)
            else:
                username = payload.get("sub")
                if username:
                    user = User.objects.filter(username__iexact=str(username)).first()
                    if user:
                        revoke_user_sessions(user)
        except Exception:
            pass
    return _clear_refresh_cookie(JsonResponse({"detail": "Signed out"}))
