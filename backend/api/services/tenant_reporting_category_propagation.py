"""When a tenant reporting category is edited, propagate label/rollup changes to linked records."""
from __future__ import annotations

import logging
from typing import Any

from django.db import transaction

from api.services.aquaculture_bill_defaults import chart_account_id_for_aquaculture_expense_category
from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket
from api.services.tenant_reporting_categories import (
    APP_AQUACULTURE,
    APP_FUEL_STATION,
    FUEL_STATION_EXPENSE_MAP_CODES,
    KIND_EXPENSE,
    KIND_INCOME,
    resolve_aquaculture_expense_to_builtin,
)

logger = logging.getLogger(__name__)


def _link_unlinked_bill_lines(category) -> int:
    """Link bill lines that store the tenant category code but lack the FK (fuel station only)."""
    from api.models import BillLine

    if category.application != APP_FUEL_STATION or category.kind != KIND_EXPENSE:
        return 0
    linked = BillLine.objects.filter(
        bill__company_id=category.company_id,
        fuel_station_expense_category__iexact=category.code,
        tenant_reporting_category_id__isnull=True,
    ).update(tenant_reporting_category_id=category.id)
    return int(linked or 0)


def _update_bill_lines_for_category(category, *, old_maps_to_code: str) -> set[int]:
    from api.models import BillLine

    bill_ids: set[int] = set()
    qs = BillLine.objects.filter(tenant_reporting_category_id=category.id).select_related("bill")
    if category.application == APP_AQUACULTURE and category.kind == KIND_EXPENSE:
        builtin = resolve_aquaculture_expense_to_builtin(category.company_id, category.code)
        new_bucket = aquaculture_expense_category_to_cost_bucket(
            builtin, company_id=category.company_id
        )
        new_account_id = chart_account_id_for_aquaculture_expense_category(
            category.company_id, builtin
        )
        for line in qs:
            updates: dict[str, Any] = {"aquaculture_cost_bucket": new_bucket}
            if not line.item_id and new_account_id:
                updates["expense_account_id"] = new_account_id
            BillLine.objects.filter(pk=line.pk).update(**updates)
            bill_ids.add(line.bill_id)
    elif category.application == APP_FUEL_STATION and category.kind == KIND_EXPENSE:
        from api.services.fuel_station_coa_constants import (
            chart_account_id_for_fuel_station_expense_rollup,
            resolve_fuel_station_expense_to_rollup,
        )

        rollup = resolve_fuel_station_expense_to_rollup(category.company_id, category.code)
        new_account_id = chart_account_id_for_fuel_station_expense_rollup(
            category.company_id, rollup
        )
        for line in qs:
            updates: dict[str, Any] = {}
            if not line.item_id and new_account_id:
                updates["expense_account_id"] = new_account_id
            if updates:
                BillLine.objects.filter(pk=line.pk).update(**updates)
            bill_ids.add(line.bill_id)
    else:
        for line in qs:
            bill_ids.add(line.bill_id)
    return bill_ids


def _update_journal_lines_for_category(category, *, old_maps_to_code: str) -> int:
    from api.models import JournalEntryLine

    updated = 0
    if category.application == APP_FUEL_STATION and category.kind == KIND_EXPENSE:
        rollup = (category.maps_to_code or "").strip()
        if rollup in FUEL_STATION_EXPENSE_MAP_CODES:
            updated = JournalEntryLine.objects.filter(
                tenant_reporting_category_id=category.id
            ).update(fuel_station_expense_rollup=rollup)
    elif category.application == APP_AQUACULTURE and category.kind == KIND_EXPENSE:
        builtin = resolve_aquaculture_expense_to_builtin(category.company_id, category.code)
        new_bucket = aquaculture_expense_category_to_cost_bucket(
            builtin, company_id=category.company_id
        )
        updated = JournalEntryLine.objects.filter(
            tenant_reporting_category_id=category.id
        ).update(aquaculture_cost_bucket=new_bucket)
    return int(updated or 0)


def _resync_manual_aquaculture_expense_journals(company_id: int, category_code: str) -> int:
    from api.models import AquacultureExpense, JournalEntry
    from api.services.gl_posting import post_aquaculture_manual_expense_journal

    resynced = 0
    expense_rows = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_category__iexact=category_code,
    ).only("id", "expense_date", "funding_account_code")
    for exp in expense_rows:
        if not (exp.funding_account_code or "").strip():
            continue
        entry_number = f"AUTO-AQ-EXP-{exp.id}"
        JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).delete()
        if post_aquaculture_manual_expense_journal(
            company_id, expense_id=exp.id, entry_date=exp.expense_date
        ):
            resynced += 1
    return resynced


def _refresh_bill_journals_for_category(category, bill_ids: set[int]) -> tuple[int, int]:
    from api.models import Bill, JournalEntry, JournalEntryLine
    from api.services.gl_posting import resync_posted_bill_journal_from_lines

    bills_resynced = 0
    journal_lines_updated = 0
    for bill_id in sorted(bill_ids):
        if resync_posted_bill_journal_from_lines(category.company_id, bill_id):
            bills_resynced += 1
            continue
        entry_number = f"AUTO-BILL-{bill_id}"
        je = JournalEntry.objects.filter(
            company_id=category.company_id, entry_number=entry_number
        ).first()
        if not je:
            continue
        if category.application == APP_AQUACULTURE and category.kind == KIND_EXPENSE:
            builtin = resolve_aquaculture_expense_to_builtin(category.company_id, category.code)
            new_bucket = aquaculture_expense_category_to_cost_bucket(
                builtin, company_id=category.company_id
            )
            new_account_id = chart_account_id_for_aquaculture_expense_category(
                category.company_id, builtin
            )
            pond_ids = [
                pid
                for pid in BillLine.objects.filter(
                    bill_id=bill_id, tenant_reporting_category_id=category.id
                ).values_list("aquaculture_pond_id", flat=True)
                if pid
            ]
            if not pond_ids:
                continue
            qs = JournalEntryLine.objects.filter(
                journal_entry_id=je.id,
                debit__gt=0,
                aquaculture_pond_id__in=pond_ids,
            )
            updates: dict[str, Any] = {
                "aquaculture_cost_bucket": new_bucket,
                "tenant_reporting_category_id": category.id,
            }
            if new_account_id:
                updates["account_id"] = new_account_id
            journal_lines_updated += qs.update(**updates)
        elif category.application == APP_FUEL_STATION and category.kind == KIND_EXPENSE:
            from api.services.fuel_station_coa_constants import (
                chart_account_id_for_fuel_station_expense_rollup,
                resolve_fuel_station_expense_to_rollup,
            )

            rollup = resolve_fuel_station_expense_to_rollup(category.company_id, category.code)
            new_account_id = chart_account_id_for_fuel_station_expense_rollup(
                category.company_id, rollup
            )
            if not new_account_id:
                continue
            qs = JournalEntryLine.objects.filter(
                journal_entry_id=je.id,
                debit__gt=0,
                tenant_reporting_category_id=category.id,
            )
            journal_lines_updated += qs.update(
                account_id=new_account_id,
                tenant_reporting_category_id=category.id,
            )
    return bills_resynced, journal_lines_updated


def propagate_tenant_reporting_category_update(
    category,
    *,
    old_maps_to_code: str,
    maps_to_changed: bool,
    label_changed: bool = False,
) -> dict[str, int]:
    """
    Push category definition changes to vendor bills, journals, and pond expenses that
    already reference this category (by FK or stored category code).
    """
    stats = {
        "bill_lines_linked": 0,
        "bill_lines_updated": 0,
        "bills_resynced": 0,
        "journal_lines_updated": 0,
        "aquaculture_expenses_resynced": 0,
    }
    if not maps_to_changed and not label_changed:
        return stats

    with transaction.atomic():
        stats["bill_lines_linked"] = _link_unlinked_bill_lines(category)
        bill_ids = _update_bill_lines_for_category(
            category, old_maps_to_code=old_maps_to_code
        )
        stats["bill_lines_updated"] = len(bill_ids)

        if bill_ids:
            bills_resynced, jl_from_bills = _refresh_bill_journals_for_category(category, bill_ids)
            stats["bills_resynced"] = bills_resynced
            stats["journal_lines_updated"] += jl_from_bills

        if maps_to_changed:
            stats["journal_lines_updated"] += _update_journal_lines_for_category(
                category, old_maps_to_code=old_maps_to_code
            )

        if (
            category.application == APP_AQUACULTURE
            and category.kind == KIND_EXPENSE
            and (maps_to_changed or label_changed)
        ):
            stats["aquaculture_expenses_resynced"] = _resync_manual_aquaculture_expense_journals(
                category.company_id, category.code
            )

    return stats
