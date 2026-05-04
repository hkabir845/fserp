"""
Set the profile email for platform super_admin user(s) so password recovery can deliver mail.

Recovery sends to: email-shaped username, else User.email (see password_views._password_reset_delivery_email).

Usage:
  python manage.py ensure_platform_owner_email
  python manage.py ensure_platform_owner_email --email other@example.com
  python manage.py ensure_platform_owner_email --username superuser@sasfserp.com

Default email is FSERP_PLATFORM_OWNER_EMAIL in settings (env FSERP_PLATFORM_OWNER_EMAIL).
"""
from django.conf import settings
from django.core.management.base import BaseCommand

from api.models import User


class Command(BaseCommand):
    help = (
        "Set User.email for super_admin account(s) so 'Forgot password' can send to a real mailbox. "
        "Default address comes from settings.FSERP_PLATFORM_OWNER_EMAIL."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            type=str,
            default="",
            help="Mailbox to set (default: FSERP_PLATFORM_OWNER_EMAIL from settings)",
        )
        parser.add_argument(
            "--username",
            type=str,
            default="",
            help="If set, only this user (must be super_admin) is updated",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without saving",
        )

    def handle(self, *args, **options):
        raw = (options.get("email") or "").strip()
        target = raw or getattr(settings, "FSERP_PLATFORM_OWNER_EMAIL", "") or ""
        if not target:
            self.stderr.write(
                self.style.ERROR(
                    "No email: pass --email=... or set FSERP_PLATFORM_OWNER_EMAIL / default in settings."
                )
            )
            return

        uq = User.objects.filter(role__iexact="super_admin", is_active=True)
        un = (options.get("username") or "").strip()
        if un:
            uq = uq.filter(username__iexact=un)
        users = list(uq.order_by("id"))
        if not users:
            self.stderr.write(
                self.style.ERROR(
                    "No active super_admin user found."
                    + (f" (username={un!r})" if un else "")
                    + "\nCreate one: python manage.py create_superuser"
                )
            )
            return

        dry = bool(options.get("dry_run"))
        for u in users:
            before = (u.email or "").strip()
            if before == target:
                self.stdout.write(f"  {u.username!r}: email already {target!r} — ok")
                continue
            self.stdout.write(
                f"  {u.username!r}: email {before!r} -> {target!r}" + (" (dry-run)" if dry else "")
            )
            if not dry:
                u.email = target
                u.save(update_fields=["email"])

        if dry:
            self.stdout.write(self.style.WARNING("Dry-run: no changes saved."))
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Platform owner recovery email is set. Forgot password will send to this mailbox when "
                    f"username is not the delivery address, or for OTP/link delivery."
                )
            )
