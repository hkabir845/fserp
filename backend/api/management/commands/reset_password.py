"""
Reset password for an api.User by username.
Optionally assign company by name, or create a missing tenant user.

Usage:
  python manage.py reset_password superuser@sasfserp.com --password "Admin@123"
  python manage.py reset_password cashier1 --password "cash123" --company "Master Filling Station"
  python manage.py reset_password cashier1 --password "cash123" --company "Master Filling Station" --create-if-missing
"""
from django.core.management.base import BaseCommand
from api.models import Company, User

TENANT_ROLES = frozenset({"admin", "accountant", "cashier"})


class Command(BaseCommand):
    help = "Reset password for an api.User; optional company assignment or --create-if-missing."

    def add_arguments(self, parser):
        parser.add_argument("username", type=str, help="Username (e.g. cashier1)")
        parser.add_argument("--password", type=str, required=True, help="New password")
        parser.add_argument(
            "--company",
            type=str,
            default="",
            help='Company name (e.g. "Master Filling Station") — sets users.company_id',
        )
        parser.add_argument(
            "--create-if-missing",
            action="store_true",
            help="Create the user if not found (tenant roles require --company)",
        )
        parser.add_argument(
            "--role",
            type=str,
            default="cashier",
            help="Role when creating user (default: cashier). Use admin, accountant, or cashier.",
        )

    def handle(self, *args, **options):
        username = (options["username"] or "").strip()
        password = options["password"]
        company_name = (options["company"] or "").strip()
        create_if_missing = options["create_if_missing"]
        role = (options["role"] or "cashier").strip().lower()

        if not username:
            self.stderr.write(self.style.ERROR("Username required."))
            return
        if not password:
            self.stderr.write(self.style.ERROR("Password required (use --password)."))
            return

        company_id = None
        if company_name:
            company = (
                Company.objects.filter(is_deleted=False)
                .filter(name__iexact=company_name)
                .first()
            )
            if not company:
                self.stderr.write(
                    self.style.ERROR(
                        f"No active company found with name matching '{company_name}'."
                    )
                )
                return
            company_id = company.id
            self.stdout.write(f"Resolved company: {company.name!r} (id={company_id})")

        user = User.objects.filter(username__iexact=username).first()

        if not user:
            if not create_if_missing:
                self.stderr.write(self.style.ERROR(f"User '{username}' not found."))
                return
            if role in TENANT_ROLES and company_id is None:
                self.stderr.write(
                    self.style.ERROR(
                        f"Role '{role}' requires --company when creating a new user."
                    )
                )
                return
            if role not in TENANT_ROLES and role != "super_admin":
                self.stderr.write(
                    self.style.ERROR(
                        f"Unknown role '{role}'. Use admin, accountant, cashier, or super_admin."
                    )
                )
                return
            user = User(
                username=username,
                email=f"{username}@localhost",
                full_name=username.replace("_", " ").title(),
                role=role,
                company_id=company_id,
                is_active=True,
            )
            user.set_password(password)
            user.save()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created user '{user.username}' (role={user.role}, company_id={user.company_id})."
                )
            )
            return

        user.set_password(password)
        if company_id is not None:
            user.company_id = company_id
        user.save()
        self.stdout.write(
            self.style.SUCCESS(
                f"Password updated for '{user.username}'"
                + (
                    f"; company_id set to {user.company_id}"
                    if company_id is not None
                    else ""
                )
                + "."
            )
        )
