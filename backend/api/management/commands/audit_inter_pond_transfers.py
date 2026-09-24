"""
List inter-pond transfers that never became sales, and recompute elimination.

Nursing cost stays on the source pond until a sale exists. Pass --apply to
materialize those lines as pond-to-pond sales.

  python manage.py audit_inter_pond_transfers --company-id 1
  python manage.py audit_inter_pond_transfers --company-id 1 --apply
"""
from datetime import date

from django.core.management.base import BaseCommand

from api.models import AquacultureFishPondTransferLine, Company
from api.services.aquaculture_fish_transfer_as_sale import materialize_fish_sales_for_company
from api.services.internal_trade_elimination import internal_trade_elimination


class Command(BaseCommand):
    help = "Recompute inter-pond elimination and list transfers that never became sales."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Turn unconverted transfer lines into pond-to-pond sales.",
        )

    def handle(self, *args, **opts):
        cid = opts["company_id"]
        company = Company.objects.filter(pk=cid).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"No company with id {cid}"))
            return
        pending = list(
            AquacultureFishPondTransferLine.objects.filter(
                transfer__company_id=cid,
                materialized_fish_sale__isnull=True,
            )
            .select_related("transfer")
            .order_by("id")
        )
        self.stdout.write(f"{company.name}: {len(pending)} transfer line(s) never became sales")
        for line in pending:
            self.stdout.write(
                f"  transfer {line.transfer_id} line {line.id} "
                f"date {line.transfer.transfer_date} kg {line.weight_kg} cost {line.cost_amount}"
            )
        if opts["apply"] and pending:
            result = materialize_fish_sales_for_company(cid)
            self.stdout.write(self.style.SUCCESS(f"Materialized sales: {result}"))
        elim = internal_trade_elimination(cid, start=None, end=date.today())
        self.stdout.write(
            "Elimination through today: "
            f"revenue {elim['internal_revenue']} cogs {elim['internal_cogs']} "
            f"unrealized {elim['unrealized_margin']} realized {elim['realized_margin']}"
        )
