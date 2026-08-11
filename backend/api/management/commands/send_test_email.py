"""
Send a one-off test message to verify SMTP (forgot-password OTP delivery).

  python manage.py send_test_email
  python manage.py send_test_email --to hkabir845@gmail.com
"""
from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send a test email via current EMAIL_* settings (SMTP or console)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--to",
            type=str,
            default="",
            help="Recipient (default: FSERP_PLATFORM_OWNER_EMAIL or EMAIL_HOST_USER)",
        )

    def handle(self, *args, **options):
        to = (options.get("to") or "").strip()
        if not to:
            to = (
                (getattr(settings, "FSERP_PLATFORM_OWNER_EMAIL", None) or "").strip()
                or (getattr(settings, "EMAIL_HOST_USER", None) or "").strip()
            )
        if not to or "@" not in to:
            raise CommandError("Pass --to=you@example.com (no default recipient configured).")

        backend = getattr(settings, "EMAIL_BACKEND", "")
        host = getattr(settings, "EMAIL_HOST", "") or "(none — console backend)"
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "") or "(unset)"

        self.stdout.write(f"EMAIL_BACKEND={backend}")
        self.stdout.write(f"EMAIL_HOST={host}")
        self.stdout.write(f"FROM={from_email}")
        self.stdout.write(f"TO={to}")

        if not (getattr(settings, "EMAIL_HOST", None) or "").strip():
            self.stdout.write(
                self.style.WARNING(
                    "EMAIL_HOST is unset — message goes to the server console/logs only, not the inbox."
                )
            )

        app = getattr(settings, "FSERP_APP_DISPLAY_NAME", None) or "FS ERP"
        try:
            send_mail(
                subject=f"{app} SMTP test",
                message=(
                    f"This is a test message from {app}.\n\n"
                    "If you received this, forgot-password OTP email can use the same SMTP settings.\n"
                ),
                from_email=from_email,
                recipient_list=[to],
                fail_silently=False,
            )
        except Exception as exc:
            raise CommandError(f"Send failed: {exc}") from exc

        self.stdout.write(self.style.SUCCESS(f"Sent test email to {to}"))
