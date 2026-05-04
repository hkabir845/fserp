"""
Create sample SaaS broadcast messages for Master Filling Station (demo / onboarding).

Idempotent: skips any row that already exists with the same title and company_id.

Usage:
  python manage.py seed_master_sample_broadcasts

Also runs automatically from: python manage.py seed_master_full_demo
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from api.models import Broadcast, Company


def resolve_master_company() -> Company:
    master = Company.objects.filter(name__iexact="Master Filling Station", is_deleted=False).first()
    if not master:
        master = Company.objects.filter(is_master="true", is_deleted=False).first()
    if not master:
        raise CommandError(
            'No "Master Filling Station" (or is_master) company found. '
            "Create the tenant first, then run this command."
        )
    return master


# Titles match common categories from the Broadcasting UI (payment, maintenance, etc.).
SAMPLE_BROADCASTS_MASTER: list[tuple[str, str]] = [
    (
        "[Demo] Payment & subscription reminder",
        "Dear station operator,\n\n"
        "This is a sample payment-related broadcast, similar to a subscription or hosting invoice reminder.\n\n"
        "Please ensure any platform fees are settled by the due date to avoid interruption. "
        "Contact your account manager if you need a copy of the invoice.\n\n"
        "— FSERP (sample message)",
    ),
    (
        "[Demo] Scheduled maintenance window",
        "Maintenance notice (sample)\n\n"
        "We may schedule brief maintenance on Sunday nights (example: 02:00–04:00 local time). "
        "During this window you could see short delays on sync or login.\n\n"
        "We will confirm real windows through your production administrator.\n\n"
        "— FSERP Platform",
    ),
    (
        "[Demo] Welcome — Master Filling Station demo tenant",
        "Welcome to the Master Filling Station demo tenant.\n\n"
        "This company is pre-loaded with sample chart of accounts, nozzles, customers, and demo journals "
        "so you can try Cashier, Reports, and Payments without entering everything from scratch.\n\n"
        "You can dismiss broadcasts from your dashboard after reading them.\n\n"
        "— FSERP",
    ),
    (
        "[Demo] Tip: end-of-shift checklist",
        "Operations tip (sample)\n\n"
        "Before closing a shift: reconcile cash and card batches, note any nozzle meter readings if your process requires it, "
        "and record tank dips when policy requires wet-stock verification.\n\n"
        "Use Shifts and Tank Dips in the menu when your site enables those modules.\n\n"
        "— FSERP",
    ),
    (
        "[Demo] Feature highlight — printing from POS",
        "Product update (sample)\n\n"
        "From the POS screen you can print draft invoices, a short POS summary report, and customer A/R statements "
        "when a customer is selected — useful for counter copies and quick reconciliations.\n\n"
        "— FSERP",
    ),
    (
        "[Demo] Service renewal / licence expiry (sample)",
        "Reminder (sample)\n\n"
        "If your deployment includes time-bound licences or annual support, plan renewals before the expiry date "
        "so updates and helpdesk access stay active.\n\n"
        "This message is only an example of how an expiry reminder could look.\n\n"
        "— FSERP",
    ),
]


class Command(BaseCommand):
    help = "Seed sample broadcast messages targeted to Master Filling Station."

    def handle(self, *args, **options):
        master = resolve_master_company()
        cid = master.id
        created = 0
        skipped = 0

        for title, message in SAMPLE_BROADCASTS_MASTER:
            _b, was_created = Broadcast.objects.get_or_create(
                company_id=cid,
                title=title,
                defaults={
                    "message": message,
                    "target": "specific",
                    "is_active": True,
                    "applied_at": None,
                },
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Broadcasts for company id={cid} ({master.name}): created={created}, already present={skipped}."
            )
        )
