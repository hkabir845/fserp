"""
Print station-related data quality metrics for go-live / periodic audits.

Usage:
  python manage.py audit_station_data
  python manage.py audit_station_data --company-id 42
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from api.models import Company, Invoice, Island, Payment, ShiftSession, Station, Tank
from api.services.entity_gl_scoping import audit_entity_gl_scoping


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

            fuel_mismatch = []
            for s in Station.objects.filter(company_id=c.id, operates_fuel_retail=False).only(
                "id", "station_name"
            ):
                nt = Tank.objects.filter(station_id=s.id, company_id=c.id).count()
                ni = Island.objects.filter(station_id=s.id, company_id=c.id).count()
                if nt or ni:
                    fuel_mismatch.append((s.id, (s.station_name or "").strip() or f"#{s.id}", nt, ni))
            if fuel_mismatch:
                self.stdout.write(
                    self.style.ERROR(
                        f"  ISSUE: {len(fuel_mismatch)} station(s) marked non-fuel but have tanks/islands "
                        f"(run: python manage.py reconcile_station_fuel_flags --company-id {c.id})"
                    )
                )
                for sid, sname, nt, ni in fuel_mismatch[:15]:
                    self.stdout.write(f"      station {sid} {sname!r}: {nt} tank(s), {ni} island(s)")
                if len(fuel_mismatch) > 15:
                    self.stdout.write(f"      … and {len(fuel_mismatch) - 15} more")

            eg = audit_entity_gl_scoping(c.id)
            self.stdout.write(
                f"  entity GL: {eg['active_ponds']} active pond(s); "
                f"{eg['unscoped_pl_line_count']} posted P&L line(s) with no station/pond tag"
            )
            if eg["invoices_posted_missing_station"]:
                self.stdout.write(
                    self.style.WARNING(
                        f"  NOTE: {eg['invoices_posted_missing_station']} posted invoice(s) lack station_id "
                        "(run: python manage.py backfill_invoice_station --company-id "
                        f"{c.id})"
                    )
                )
            if eg["bills_posted_missing_receipt_station"]:
                self.stdout.write(
                    self.style.WARNING(
                        f"  NOTE: {eg['bills_posted_missing_receipt_station']} posted bill(s) lack receipt_station_id"
                    )
                )
            if eg["unscoped_pl_line_count"]:
                self.stdout.write(
                    self.style.WARNING(
                        "  NOTE: untagged P&L lines appear only in Head office / unassigned on entity reports"
                    )
                )
                for sample in eg["unscoped_pl_samples"]:
                    self.stdout.write(
                        f"      JE {sample['entry_number']} ({sample['entry_date']}) "
                        f"{sample['account_code']} {sample['amount']}"
                    )
