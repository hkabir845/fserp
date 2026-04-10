"""
Ensure the platform SaaS superuser row is correct so it appears in /api/admin/users/
and can open the SaaS control center.

Usage:
  python manage.py ensure_saas_superuser
  python manage.py ensure_saas_superuser --username superuser@sasfserp.com
  python manage.py ensure_saas_superuser --password "Admin@123"
"""
from django.core.management.base import BaseCommand

from api.models import User


class Command(BaseCommand):
    help = "Set role=super_admin and is_active=True for the SaaS platform superuser (fixes missing row in admin user list / access)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            type=str,
            default="superuser@sasfserp.com",
            help="Username (default: superuser@sasfserp.com)",
        )
        parser.add_argument(
            "--password",
            type=str,
            help="Optional: set a new password",
        )

    def handle(self, *args, **options):
        username = (options["username"] or "").strip()
        if not username:
            self.stderr.write(self.style.ERROR("username is required"))
            return

        user = User.objects.filter(username__iexact=username).first()
        if not user:
            self.stderr.write(
                self.style.ERROR(
                    f"No user '{username}'. Create one first:\n"
                    f"  python manage.py create_superuser --username {username} --password YOUR_PASSWORD"
                )
            )
            return

        user.role = "super_admin"
        user.is_active = True
        if not (user.full_name or "").strip():
            user.full_name = "Super Admin"
        pwd = options.get("password")
        if pwd:
            user.set_password(pwd)
        user.save()
        self.stdout.write(
            self.style.SUCCESS(
                f"Updated '{user.username}': role=super_admin, is_active=True. "
                f"Refresh SaaS → All Users; this account should appear at the top."
            )
        )
