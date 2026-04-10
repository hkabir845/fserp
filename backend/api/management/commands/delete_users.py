"""
Deactivate users by email or username (soft delete: sets is_active=False).
Usage: python manage.py delete_users admin@afs.com admin@localhost
       python manage.py delete_users --email admin@afs.com --email admin@localhost
"""
from django.core.management.base import BaseCommand
from api.models import User


class Command(BaseCommand):
    help = "Deactivate users by email or username (soft delete)."

    def add_arguments(self, parser):
        parser.add_argument(
            "emails_or_usernames",
            nargs="*",
            type=str,
            help="Emails or usernames to deactivate (e.g. admin@afs.com admin@localhost)",
        )
        parser.add_argument(
            "--email",
            action="append",
            dest="emails",
            type=str,
            help="Email to deactivate (can be repeated)",
        )
        parser.add_argument(
            "--username",
            action="append",
            dest="usernames",
            type=str,
            help="Username to deactivate (can be repeated)",
        )
        parser.add_argument(
            "--hard",
            action="store_true",
            help="Permanently delete from DB instead of deactivating",
        )

    def handle(self, *args, **options):
        emails = list(options["emails"] or [])
        usernames = list(options["usernames"] or [])
        for x in options.get("emails_or_usernames") or []:
            x = (x or "").strip()
            if not x:
                continue
            if "@" in x:
                emails.append(x)
            else:
                usernames.append(x)

        if not emails and not usernames:
            # Default: remove the two legacy super admins
            emails = ["admin@afs.com", "admin@localhost"]
            usernames = ["admin"]

        hard = options.get("hard", False)
        updated = 0
        seen_ids = set()

        for email in emails:
            qs = User.objects.filter(email__iexact=email)
            for u in qs:
                if u.id in seen_ids:
                    continue
                seen_ids.add(u.id)
                if hard:
                    u.delete()
                    self.stdout.write(self.style.WARNING(f"Deleted user: {u.username} ({u.email})"))
                else:
                    u.is_active = False
                    u.save(update_fields=["is_active"])
                    self.stdout.write(self.style.SUCCESS(f"Deactivated user: {u.username} ({u.email})"))
                updated += 1

        for username in usernames:
            qs = User.objects.filter(username__iexact=username)
            for u in qs:
                if u.id in seen_ids:
                    continue
                seen_ids.add(u.id)
                if hard:
                    u.delete()
                    self.stdout.write(self.style.WARNING(f"Deleted user: {u.username} ({u.email})"))
                else:
                    u.is_active = False
                    u.save(update_fields=["is_active"])
                    self.stdout.write(self.style.SUCCESS(f"Deactivated user: {u.username} ({u.email})"))
                updated += 1

        if updated == 0:
            self.stdout.write(self.style.NOTICE("No matching users found."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Done. {updated} user(s) {'deleted' if hard else 'deactivated'}."))
