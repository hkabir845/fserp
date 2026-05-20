"""
Delete expired and aged password-reset token rows.

Usage:
  python manage.py purge_password_reset_tokens
  python manage.py purge_password_reset_tokens --retention-days 14
  python manage.py purge_password_reset_tokens --company-id 3
"""
from django.core.management.base import BaseCommand

from api.utils.password_reset_tokens import (
    STALE_USED_RETENTION_DAYS,
    purge_password_reset_tokens_for_company,
    purge_stale_password_reset_tokens,
)


class Command(BaseCommand):
    help = "Purge expired password reset tokens and optionally wipe a tenant's token rows."

    def add_arguments(self, parser):
        parser.add_argument(
            "--retention-days",
            type=int,
            default=STALE_USED_RETENTION_DAYS,
            help=f"Delete used tokens older than N days (default {STALE_USED_RETENTION_DAYS}).",
        )
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="If set, delete all reset tokens for users in this company (ignores retention).",
        )

    def handle(self, *args, **options):
        company_id = options.get("company_id")
        if company_id is not None:
            n = purge_password_reset_tokens_for_company(int(company_id))
            self.stdout.write(self.style.SUCCESS(f"Deleted {n} token row(s) for company_id={company_id}."))
            return

        counts = purge_stale_password_reset_tokens(retention_days=int(options["retention_days"]))
        self.stdout.write(
            self.style.SUCCESS(
                f"Purged expired={counts['expired']}, used_old={counts['used_old']} password reset token(s)."
            )
        )
