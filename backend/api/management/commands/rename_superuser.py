"""
Rename the superuser from admin@afs.com to superuser@sasfserp.com (password unchanged).
Usage: python manage.py rename_superuser
       python manage.py rename_superuser --from admin@afs.com --to superuser@sasfserp.com
"""
from django.core.management.base import BaseCommand
from api.models import User


class Command(BaseCommand):
    help = "Rename superuser (e.g. admin@afs.com -> superuser@sasfserp.com); password unchanged."

    def add_arguments(self, parser):
        parser.add_argument(
            "--from",
            dest="old_username",
            type=str,
            default="admin@afs.com",
            help="Current username to rename (default: admin@afs.com)",
        )
        parser.add_argument(
            "--to",
            dest="new_username",
            type=str,
            default="superuser@sasfserp.com",
            help="New username (default: superuser@sasfserp.com)",
        )

    def handle(self, *args, **options):
        old_username = (options["old_username"] or "").strip()
        new_username = (options["new_username"] or "").strip()
        if not old_username or not new_username:
            self.stderr.write(self.style.ERROR("Both --from and --to must be non-empty."))
            return
        if old_username == new_username:
            self.stdout.write(self.style.WARNING("From and to are the same; nothing to do."))
            return

        user = User.objects.filter(username__iexact=old_username).first()
        if not user:
            self.stderr.write(
                self.style.ERROR(f"No user found with username '{old_username}'. Create one with create_superuser first.")
            )
            return
        if User.objects.filter(username__iexact=new_username).exclude(pk=user.pk).exists():
            self.stderr.write(self.style.ERROR(f"A user with username '{new_username}' already exists."))
            return

        user.username = new_username
        user.email = new_username
        user.save()
        self.stdout.write(
            self.style.SUCCESS(f"Renamed user '{old_username}' to '{new_username}'. Password unchanged.")
        )
