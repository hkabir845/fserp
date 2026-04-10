"""
Create a super_admin user in the api.User table.
Usage: python manage.py create_superuser
       python manage.py create_superuser --username admin --password admin --email admin@localhost
"""
import getpass
from django.core.management.base import BaseCommand
from api.models import User


class Command(BaseCommand):
    help = "Create a super_admin user for the FSMS API (api.User model)."

    def add_arguments(self, parser):
        parser.add_argument("--username", type=str, default="admin", help="Username (default: admin)")
        parser.add_argument("--password", type=str, help="Password (prompted if not given)")
        parser.add_argument("--email", type=str, default="admin@localhost", help="Email (default: admin@localhost)")
        parser.add_argument("--no-input", action="store_true", help="Use defaults and fail if user exists")

    def handle(self, *args, **options):
        username = options["username"]
        email = options["email"]
        password = options["password"]
        no_input = options["no_input"]

        if User.objects.filter(username__iexact=username).exists():
            self.stderr.write(self.style.ERROR(f"User '{username}' already exists."))
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
