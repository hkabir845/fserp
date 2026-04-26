"""
Create a super_admin user in the api.User table.
Usage: python manage.py create_superuser
       python manage.py create_superuser --username admin --password admin --email admin@localhost
"""
import getpass
from django.conf import settings
from django.core.management.base import BaseCommand
from api.models import User


def _default_platform_email() -> str:
    return (getattr(settings, "FSERP_PLATFORM_OWNER_EMAIL", None) or "admin@localhost").strip()


class Command(BaseCommand):
    help = "Create a super_admin user for the FSMS API (api.User model)."

    def add_arguments(self, parser):
        parser.add_argument("--username", type=str, default="admin", help="Username (default: admin)")
        parser.add_argument("--password", type=str, help="Password (prompted if not given)")
        parser.add_argument(
            "--email",
            type=str,
            default="",
            help=f"Profile email for password recovery (default: FSERP_PLATFORM_OWNER_EMAIL or admin@localhost)",
        )
        parser.add_argument("--no-input", action="store_true", help="Use defaults and fail if user exists")

    def handle(self, *args, **options):
        username = options["username"]
        email = (options["email"] or "").strip() or _default_platform_email()
        password = options["password"]
        no_input = options["no_input"]

        if User.objects.filter(username__iexact=username).exists():
            self.stderr.write(
                self.style.WARNING(
                    f"User '{username}' already exists.\n"
                    f"To fix SaaS panel listing / super_admin role, run:\n"
                    f"  python manage.py ensure_saas_superuser --username {username}"
                )
            )
            return

        if not password:
            if no_input:
                self.stderr.write(self.style.ERROR("Password required. Use --password or run without --no-input."))
                return
            password = getpass.getpass("Password: ")
            if not password:
                self.stderr.write(self.style.ERROR("Password cannot be empty."))
                return

        user = User(
            username=username,
            email=email,
            full_name="Super Admin",
            role="super_admin",
        )
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Superuser '{username}' created successfully."))
