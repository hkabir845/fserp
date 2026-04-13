"""Password change (authenticated) and email-based reset (unauthenticated)."""
import hashlib
import json
import logging
import secrets
from datetime import timedelta
from html import escape

from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import PasswordResetToken, User
from api.utils.auth import auth_required

logger = logging.getLogger(__name__)

TOKEN_EXPIRY_HOURS = 1
MIN_PASSWORD_LEN = 8
FORGOT_COOLDOWN_SEC = 120


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_json(request):
    try:
        data = json.loads(request.body) if request.body else {}
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _validate_new_password(pw) -> tuple[bool, str]:
    if pw is None or not isinstance(pw, str):
        return False, "Password is required."
    if len(pw) < MIN_PASSWORD_LEN:
        return False, f"Password must be at least {MIN_PASSWORD_LEN} characters."
    if len(pw.encode("utf-8")) > 72:
        return False, "Password is too long (maximum 72 bytes)."
    return True, ""


def _reset_email_recipient(user: User) -> str | None:
    em = (getattr(user, "email", None) or "").strip()
    if em:
        return em
    un = (user.username or "").strip()
    if "@" in un:
        return un
    return None


def _send_password_reset_email(to_email: str, reset_link: str, user_name: str) -> None:
    display_name = (user_name or "").strip() or "there"
    subject = "Reset your FS ERP password"
    text_body = (
        f"Hello {display_name},\n\n"
        "We received a request to reset the password for your account.\n\n"
        f"Open this link in your browser (valid for {TOKEN_EXPIRY_HOURS} hour):\n{reset_link}\n\n"
        "If you did not request this, you can ignore this email. Your password will not change.\n\n"
        "— FS ERP"
    )
    safe_link = escape(reset_link, quote=True)
    html_body = (
        f"<p>Hello {escape(display_name)},</p>"
        "<p>We received a request to reset the password for your account.</p>"
        f'<p><a href="{safe_link}">Reset your password</a></p>'
        f"<p>This link expires in {TOKEN_EXPIRY_HOURS} hour.</p>"
        "<p>If you did not request this, you can ignore this email.</p>"
        "<p>— FS ERP</p>"
    )
    send_mail(
        subject=subject,
        message=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[to_email],
        html_message=html_body,
        fail_silently=False,
    )


FORGOT_GENERIC_RESPONSE = {
    "detail": (
        "If an account exists for that address, we sent password reset instructions. "
        "Check your inbox and spam folder."
    )
}


@csrf_exempt
@require_http_methods(["POST"])
def forgot_password(request):
    """
    Request a password reset email.
    Always returns the same success message to avoid revealing whether an email is registered.
    """
    body = _parse_json(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    email = (body.get("email") or "").strip()
    if not email:
        return JsonResponse({"detail": "Email is required."}, status=400)

    throttle_key = f"pwreset_throttle:{email.lower()}"
    if cache.get(throttle_key):
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)
    cache.set(throttle_key, 1, FORGOT_COOLDOWN_SEC)

    # Prefer username match (unique) so duplicate emails across users do not pick an arbitrary row.
    user = User.objects.filter(is_active=True, username__iexact=email).first()
    if not user:
        user = User.objects.filter(is_active=True, email__iexact=email).first()

    if not user:
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    to_addr = _reset_email_recipient(user)
    if not to_addr:
        logger.warning("password reset: user id=%s has no deliverable email", user.id)
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    token_row = None
    with transaction.atomic():
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        raw_token = secrets.token_urlsafe(48)
        token_hash = _hash_token(raw_token)
        expires = timezone.now() + timedelta(hours=TOKEN_EXPIRY_HOURS)
        try:
            token_row = PasswordResetToken.objects.create(
                user=user, token_hash=token_hash, expires_at=expires
            )
        except Exception:
            logger.exception("password reset: failed to store token for user id=%s", user.id)
            cache.delete(throttle_key)
            return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    frontend = getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    reset_link = f"{frontend}/reset-password?token={raw_token}"

    try:
        _send_password_reset_email(
            to_addr,
            reset_link,
            getattr(user, "full_name", None) or user.username,
        )
    except Exception:
        logger.exception("password reset: email send failed for user id=%s", user.id)
        if token_row is not None:
            PasswordResetToken.objects.filter(pk=token_row.pk).delete()
        cache.delete(throttle_key)
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)


@csrf_exempt
@require_http_methods(["POST"])
def reset_password(request):
    """Complete password reset using the token from the email link."""
    body = _parse_json(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    raw = (body.get("token") or "").strip()
    new_pw = body.get("new_password")
    if not raw:
        return JsonResponse({"detail": "Reset token is required."}, status=400)
    ok, err = _validate_new_password(new_pw)
    if not ok:
        return JsonResponse({"detail": err}, status=400)

    th = _hash_token(raw)
    rec = (
        PasswordResetToken.objects.filter(token_hash=th, used_at__isnull=True)
        .select_related("user")
        .first()
    )
    if not rec or rec.expires_at < timezone.now():
        return JsonResponse(
            {
                "detail": "This reset link is invalid or has expired. Please request a new password reset.",
            },
            status=400,
        )
    user = rec.user
    if not user.is_active:
        return JsonResponse({"detail": "This account is disabled. Contact your administrator."}, status=400)

    with transaction.atomic():
        locked = PasswordResetToken.objects.select_for_update().filter(pk=rec.pk, used_at__isnull=True).first()
        if not locked or locked.expires_at < timezone.now():
            return JsonResponse(
                {
                    "detail": "This reset link is invalid or has expired. Please request a new password reset.",
                },
                status=400,
            )
        user.set_password(new_pw)
        user.save(update_fields=["password_hash", "updated_at"])
        PasswordResetToken.objects.filter(pk=locked.pk).update(used_at=timezone.now())

    return JsonResponse(
        {"detail": "Your password has been reset. You can sign in with your new password."},
        status=200,
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
def change_password(request):
    """Change password while logged in (requires current password)."""
    body = _parse_json(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    current = body.get("current_password")
    new_pw = body.get("new_password")
    if current is None or not isinstance(current, str):
        return JsonResponse({"detail": "Current password is required."}, status=400)
    ok, err = _validate_new_password(new_pw)
    if not ok:
        return JsonResponse({"detail": err}, status=400)

    user = request.api_user
    if not user.check_password(current):
        return JsonResponse({"detail": "Current password is incorrect."}, status=400)
    if current == new_pw:
        return JsonResponse(
            {"detail": "New password must be different from your current password."},
            status=400,
        )

    user.set_password(new_pw)
    user.save(update_fields=["password_hash", "updated_at"])
    return JsonResponse({"detail": "Password updated successfully."}, status=200)
