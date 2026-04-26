"""Password change (authenticated) and email-based reset (unauthenticated)."""
import hashlib
import hmac
import json
import logging
import re
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

# Password reset windows — aligned with common SaaS / identity-provider practice:
# short-lived reset links (~15–30 min), 5–10 min OTP, ~60 s resend cooldown, 5 failed OTP tries then lock.
RESET_LINK_VALIDITY_MINUTES = 30
MIN_PASSWORD_LEN = 8
FORGOT_COOLDOWN_SEC = 60
OTP_TTL_SEC = 300
MAX_OTP_ATTEMPTS = 5
OTP_LOCKOUT_SEC = 900
OTP_FAIL_TRACK_TTL_SEC = OTP_LOCKOUT_SEC

_EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+", re.IGNORECASE)


def _reset_link_expires_display() -> str:
    m = RESET_LINK_VALIDITY_MINUTES
    if m <= 0:
        return "a short time"
    if m == 1:
        return "1 minute"
    return f"{m} minutes"


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


def _password_reset_delivery_email(user: User) -> str | None:
    """
    Where to send reset mail/OTP. Prefer the sign-in identity when it is an email
    (username = email); otherwise use the profile email field.
    """
    un = (user.username or "").strip()
    if un and _EMAIL_LIKE.search(un or ""):
        return un
    em = (getattr(user, "email", None) or "").strip()
    if em:
        return em
    if "@" in un:
        return un
    return None


def _otp_cache_key(user_id: int) -> str:
    return f"pwreset_otp:{user_id}"


def _otp_lock_key(user_id: int) -> str:
    return f"pwreset_otp_lock:{user_id}"


def _hash_otp(user_id: int, raw_otp: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"{user_id}:{raw_otp.strip()}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _store_otp(user_id: int, raw_otp: str) -> None:
    cache.set(_otp_cache_key(user_id), _hash_otp(user_id, raw_otp), OTP_TTL_SEC)
    cache.delete(_otp_lock_key(user_id))


def _send_password_reset_link_email(to_email: str, reset_link: str, user_name: str) -> None:
    display_name = (user_name or "").strip() or "there"
    subject = "Confirm password reset – FS ERP"
    exp = _reset_link_expires_display()
    text_body = (
        f"Hello {display_name},\n\n"
        "We received a request to reset the password for your account.\n\n"
        f"To confirm you want to choose a new password, open this link in your browser "
        f"(it expires in {exp}):\n{reset_link}\n\n"
        "If you did not request a reset, ignore this message. Your password will stay the same.\n\n"
        "— FS ERP"
    )
    safe_link = escape(reset_link, quote=True)
    html_body = (
        f"<p>Hello {escape(display_name)},</p>"
        "<p>We received a request to reset the password for your account.</p>"
        f'<p><a href="{safe_link}">Confirm and set a new password</a></p>'
        f"<p>This link expires in {exp}.</p>"
        "<p>If you did not request a reset, you can ignore this email.</p>"
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


def _send_password_reset_otp_email(to_email: str, otp: str, user_name: str) -> None:
    display_name = (user_name or "").strip() or "there"
    subject = f"{otp} is your FS ERP password reset code"
    text_body = (
        f"Hello {display_name},\n\n"
        f"Use this one-time code to set a new password: {otp}\n\n"
        f"The code expires in {max(1, OTP_TTL_SEC // 60)} minutes. If you did not request a reset, ignore this message.\n\n"
        "— FS ERP"
    )
    safe_otp = escape(otp, quote=True)
    html_body = (
        f"<p>Hello {escape(display_name)},</p>"
        f"<p>Your one-time password reset code is: <strong>{safe_otp}</strong></p>"
        f"<p>It expires in {max(1, OTP_TTL_SEC // 60)} minutes.</p>"
        "<p>If you did not request a reset, ignore this email.</p>"
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


def _find_active_user_by_identifier(identifier: str) -> User | None:
    """Match login identifier: unique username, then email field."""
    q = (identifier or "").strip()
    if not q:
        return None
    user = User.objects.filter(is_active=True, username__iexact=q).first()
    if user:
        return user
    return User.objects.filter(is_active=True, email__iexact=q).first()


@csrf_exempt
@require_http_methods(["POST"])
def forgot_password(request):
    """
    Request password reset: email a confirmation link and/or a one-time code.

    Body:
      - email: sign-in email or username (required)
      - method: "link" (default) | "otp"

    Link: user must open the link to confirm they want to reset; then they set a new password.
    OTP: a 6-digit code is sent; user completes reset with POST /auth/reset-password/ using
         email, otp, new_password (see reset_password).

    Always returns a generic success when no user matches (anti-enumeration).
    """
    body = _parse_json(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    email = (body.get("email") or "").strip()
    if not email:
        return JsonResponse({"detail": "Email is required."}, status=400)

    method = (body.get("method") or "link").strip().lower()
    if method not in ("link", "otp"):
        return JsonResponse({"detail": 'method must be "link" or "otp".'}, status=400)

    throttle_key = f"pwreset_throttle:{email.lower()}"
    if cache.get(throttle_key):
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)
    cache.set(throttle_key, 1, FORGOT_COOLDOWN_SEC)

    user = _find_active_user_by_identifier(email)
    if not user:
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    to_addr = _password_reset_delivery_email(user)
    if not to_addr:
        logger.warning("password reset: user id=%s has no deliverable email", user.id)
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    display = getattr(user, "full_name", None) or user.username

    if method == "otp":
        cache.delete(_otp_cache_key(user.id))
        raw_otp = f"{secrets.randbelow(900000) + 100000:06d}"
        _store_otp(user.id, raw_otp)
        try:
            _send_password_reset_otp_email(to_addr, raw_otp, display)
        except Exception:
            logger.exception("password reset OTP: email send failed for user id=%s", user.id)
            cache.delete(_otp_cache_key(user.id))
            cache.delete(throttle_key)
            return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)
        if settings.DEBUG:
            logger.info("password reset OTP (dev) user id=%s: sent to %s", user.id, to_addr)
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    # method == "link"
    token_row = None
    with transaction.atomic():
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        raw_token = secrets.token_urlsafe(48)
        token_hash = _hash_token(raw_token)
        expires = timezone.now() + timedelta(minutes=RESET_LINK_VALIDITY_MINUTES)
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
        _send_password_reset_link_email(to_addr, reset_link, display)
    except Exception:
        logger.exception("password reset: email send failed for user id=%s", user.id)
        if token_row is not None:
            PasswordResetToken.objects.filter(pk=token_row.pk).delete()
        cache.delete(throttle_key)
        return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)

    if settings.DEBUG:
        logger.info("password reset link (dev) user id=%s: %s", user.id, reset_link)

    return JsonResponse(FORGOT_GENERIC_RESPONSE, status=200)


@csrf_exempt
@require_http_methods(["POST"])
def reset_password(request):
    """
    Complete password reset using either:
      - token + new_password (from the confirmation email link), or
      - email + otp + new_password (after receiving a one-time code).
    """
    body = _parse_json(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    new_pw = body.get("new_password")
    ok, err = _validate_new_password(new_pw)
    if not ok:
        return JsonResponse({"detail": err}, status=400)

    otp = (body.get("otp") or "").strip()
    ident = (body.get("email") or "").strip()
    if otp and ident:
        # OTP path
        if not otp.isdigit() or len(otp) != 6:
            return JsonResponse(
                {"detail": "Enter the 6-digit code from your email."},
                status=400,
            )
        user = _find_active_user_by_identifier(ident)
        if not user:
            return JsonResponse(
                {
                    "detail": "This code is invalid or has expired. Request a new code and try again.",
                },
                status=400,
            )
        if cache.get(_otp_lock_key(user.id)):
            return JsonResponse(
                {
                    "detail": "Too many attempts. Wait a few minutes and request a new code.",
                },
                status=400,
            )
        expect = cache.get(_otp_cache_key(user.id))
        if not expect or not hmac.compare_digest(
            expect, _hash_otp(user.id, otp)
        ):
            kfail = f"pwreset_otp_fail:{user.id}"
            fails = int(cache.get(kfail) or 0) + 1
            cache.set(kfail, fails, OTP_FAIL_TRACK_TTL_SEC)
            if fails >= MAX_OTP_ATTEMPTS:
                cache.set(_otp_lock_key(user.id), 1, OTP_LOCKOUT_SEC)
            return JsonResponse(
                {
                    "detail": "This code is invalid or has expired. Request a new code and try again.",
                },
                status=400,
            )
        with transaction.atomic():
            user = User.objects.select_for_update().filter(
                pk=user.pk, is_active=True
            ).first()
            if not user:
                return JsonResponse(
                    {"detail": "This account is disabled. Contact your administrator."},
                    status=400,
                )
            user.set_password(new_pw)
            user.save(update_fields=["password_hash", "updated_at"])
        cache.delete(_otp_cache_key(user.id))
        cache.delete(f"pwreset_otp_fail:{user.id}")
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        return JsonResponse(
            {
                "detail": "Your password has been reset. You can sign in with your new password.",
            },
            status=200,
        )

    # Token (link) path
    raw = (body.get("token") or "").strip()
    if not raw:
        return JsonResponse(
            {
                "detail": "Use the reset link from your email, or provide email, 6-digit code, and new password.",
            },
            status=400,
        )

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

    cache.delete(_otp_cache_key(user.id))

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
