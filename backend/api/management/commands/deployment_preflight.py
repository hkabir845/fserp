"""Verify production configuration and SMTP connectivity without sending email."""
from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.core.mail import get_connection


class Command(BaseCommand):
    help = "Check production settings and SMTP authentication; sends no messages."

    def handle(self, *args, **options):
        call_command("check", deploy=True, fail_level="WARNING")
        if settings.EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend":
            raise CommandError("Production password reset requires SMTP; configure EMAIL_HOST.")
        if "REPLACE_WITH" in settings.EMAIL_HOST_PASSWORD:
            raise CommandError("Replace the template EMAIL_HOST_PASSWORD in the server environment.")
        try:
            with get_connection(timeout=15) as connection:
                if connection.connection is None:
                    raise CommandError("SMTP connection was not established.")
        except CommandError:
            raise
        except Exception as exc:
            # Provider responses can contain account details; keep credentials out of logs.
            raise CommandError(f"SMTP connection/authentication failed ({type(exc).__name__}).") from None
        self.stdout.write(self.style.SUCCESS("Production settings and SMTP connection OK (no email sent)."))
