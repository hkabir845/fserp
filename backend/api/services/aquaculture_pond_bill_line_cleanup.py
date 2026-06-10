"""Remove legacy vendor bill lines tagged to ponds without a reporting category link."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from api.models import Bill, BillLine, PaymentBillAllocation
from api.services.document_posting_lifecycle import reconcile_bill_after_material_edit
from api.services.gl_posting import cleanup_vendor_bill_posting_effects


def _refresh_bill_totals_from_lines(bill: Bill) -> None:
    sub = bill.lines.aggregate(s=Sum("amount"))["s"] or Decimal("0")
    tax = bill.tax_total or Decimal("0")
    bill.subtotal = sub
    bill.total = sub + tax
    bill.save(update_fields=["subtotal", "total", "updated_at"])


def uncategorized_pond_bill_lines_qs(
    company_id: int,
    *,
    before_date: date | None = None,
    bill_ids: list[int] | None = None,
):
    """Pond-tagged bill lines with no tenant reporting category (pre–reporting-categories data)."""
    qs = BillLine.objects.filter(
        bill__company_id=company_id,
        aquaculture_pond_id__isnull=False,
        tenant_reporting_category_id__isnull=True,
    ).select_related("bill")
    if before_date is not None:
        qs = qs.filter(bill__bill_date__lt=before_date)
    if bill_ids:
        qs = qs.filter(bill_id__in=bill_ids)
    return qs.order_by("bill_id", "id")


def cleanup_old_uncategorized_pond_bill_lines(
    company_id: int,
    *,
    before_date: date | None = None,
    bill_ids: list[int] | None = None,
    dry_run: bool = True,
) -> dict[str, int | list[int]]:
    """
    Delete pond-tagged vendor bill lines that never received a reporting category FK,
    then reconcile or remove affected bills.

    Skips bills with vendor payment allocations.
    """
    stats: dict[str, int | list[int]] = {
        "lines_matched": 0,
        "lines_removed": 0,
        "bills_reconciled": 0,
        "bills_deleted": 0,
        "bills_skipped_paid": 0,
        "bill_ids_affected": [],
    }
    line_qs = uncategorized_pond_bill_lines_qs(
        company_id, before_date=before_date, bill_ids=bill_ids
    )
    by_bill: dict[int, list[int]] = {}
    for row in line_qs.values("id", "bill_id"):
        by_bill.setdefault(int(row["bill_id"]), []).append(int(row["id"]))

    stats["lines_matched"] = sum(len(v) for v in by_bill.values())
    stats["bill_ids_affected"] = sorted(by_bill.keys())
    if dry_run or not by_bill:
        return stats

    with transaction.atomic():
        for bill_id, line_ids in sorted(by_bill.items()):
            if PaymentBillAllocation.objects.filter(bill_id=bill_id).exists():
                stats["bills_skipped_paid"] = int(stats["bills_skipped_paid"]) + 1
                continue

            bill = Bill.objects.select_for_update().filter(pk=bill_id, company_id=company_id).first()
            if not bill:
                continue

            removed, _ = BillLine.objects.filter(pk__in=line_ids, bill_id=bill_id).delete()
            stats["lines_removed"] = int(stats["lines_removed"]) + int(removed)

            if not bill.lines.exists():
                cleanup_vendor_bill_posting_effects(company_id, bill)
                bill.delete()
                stats["bills_deleted"] = int(stats["bills_deleted"]) + 1
                continue

            _refresh_bill_totals_from_lines(bill)
            bill.refresh_from_db()
            reconcile_bill_after_material_edit(company_id, bill)
            stats["bills_reconciled"] = int(stats["bills_reconciled"]) + 1

    return stats
