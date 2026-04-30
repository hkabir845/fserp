"""
Print station-related data quality metrics for go-live / periodic audits.

Usage:
  python manage.py audit_station_data
  python manage.py audit_station_data --company-id 42
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from api.models import Company, Invoice, Payment, ShiftSession, Station


class Command(BaseCommand):
    help = "Report active/inactive station counts and nullable station FKs on invoices/payments."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company; default is all non-deleted companies.",
        )

    def handle(self, *args, **options):
        cid = options.get("company_id")
        qs = Company.objects.filter(is_deleted=False).order_by("id")
        if cid is not None:
            qs = qs.filter(pk=cid)
        companies = list(qs)
        if not companies:
            self.stdout.write(self.style.WARNING("No companies matched."))
            return

        for c in companies:
            st = Station.objects.filter(company_id=c.id)
            active = st.filter(is_active=True).count()
            inactive = st.filter(is_active=False).count()
            inv_null = Invoice.objects.filter(company_id=c.id).filter(
                Q(station_id__isnull=True) | Q(station_id=0)
            ).count()
            inv_total = Invoice.objects.filter(company_id=c.id).count()
            pay_null = Payment.objects.filter(company_id=c.id).filter(
                Q(station_id__isnull=True) | Q(station_id=0)
            ).count()
            pay_total = Payment.objects.filter(company_id=c.id).count()
            shift_null = ShiftSession.objects.filter(company_id=c.id).filter(
                Q(station_id__isnull=True) | Q(station_id=0)
            ).count()
            shift_total = ShiftSession.objects.filter(company_id=c.id).count()

            self.stdout.write(f"Company {c.id} ({c.name!r})")
            self.stdout.write(f"  stations: {st.count()} total, {active} active, {inactive} inactive")
            self.stdout.write(f"  invoices: {inv_total} total, {inv_null} with null/zero station_id")
            self.stdout.write(f"  payments: {pay_total} total, {pay_null} with null/zero station_id")
            self.stdout.write(f"  shift sessions: {shift_total} total, {shift_null} with null/zero station_id")
            if active == 0 and st.exists():
                self.stdout.write(self.style.ERROR("  ISSUE: station rows exist but none are active."))
            elif inv_null and inv_total:
                self.stdout.write(
                    self.style.WARNING(
                        f"  NOTE: {inv_null} invoice(s) lack station - review before station-scoped analytics."
                    )
                )
