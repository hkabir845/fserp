"""
Pond production cost capitalization into GL 1581 (Biological Inventory).

When ``Company.aquaculture_capitalize_pond_consumption_to_bioasset`` is enabled, direct pond
inputs (fry, feed, medicine, pond care, equipment, etc.) accumulate as a pond liability/asset
on 1581 and are relieved on harvest, transfer-out, or mortality — aligned with management P&L.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.db.models import F, Sum
from django.db.models.functions import Coalesce

from api.models import AquaculturePond, ChartOfAccount, Company, JournalEntry, JournalEntryLine
from api.services.aquaculture_bill_defaults import expense_category_from_cost_bucket
from api.services.aquaculture_constants import (
    coa_account_code_for_aquaculture_expense_category,
)

logger = logging.getLogger(__name__)

CODE_INV_BIO = "1581"

# Pond cost buckets that stay on operating expense (not capitalized to 1581).
_NO_BIO_CAPITALIZE_BUCKETS = frozenset({"lease", "shop_supplies", "biological_writeoff"})

# Production expense accounts that may be reclassified Dr expense → Cr 1581 before transfers.
_PRODUCTION_EXPENSE_ACCOUNT_CODES = frozenset(
    {
        "6713",
        "6714",
        "6715",
        "6716",
        "6717",
        "6718",
        "6719",
        "6720",
        "6721",
        "6722",
        "6725",
    }
)

_ACCOUNT_CODE_TO_COST_BUCKET: dict[str, str] = {
    "6713": "pond_preparation",
    "6714": "pond_preparation",
    "6715": "fry_stocking",
    "6716": "feed",
    "6717": "electricity",
    "6718": "equipment",
    "6719": "fisherman",
    "6720": "transportation",
    "6721": "medicine",
    "6722": "repair_maintenance",
    "6725": "miscellaneous",
}


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def company_capitalizes_pond_production(company_id: int) -> bool:
    val = (
        Company.objects.filter(pk=company_id)
        .values_list("aquaculture_capitalize_pond_consumption_to_bioasset", flat=True)
        .first()
    )
    return bool(val)


def pond_cost_bucket_capitalizes_to_bio(bucket: str | None) -> bool:
    b = (bucket or "").strip()
    if not b:
        return True
    return b not in _NO_BIO_CAPITALIZE_BUCKETS


def bio_inventory_account(company_id: int) -> ChartOfAccount | None:
    return ChartOfAccount.objects.filter(
        company_id=company_id, account_code=CODE_INV_BIO, is_active=True
    ).first()


def pond_production_expense_balances(
    company_id: int,
    pond_id: int,
    as_of: date,
) -> list[tuple[ChartOfAccount, Decimal, str]]:
    """
    Net debit balances on pond-tagged production expense accounts (6713–6725 excl. lease).
    Used to reclass operating expense into 1581 when inter-pond transfers need full bio cost.
    """
    rows = (
        JournalEntryLine.objects.filter(
            journal_entry__company_id=company_id,
            journal_entry__is_posted=True,
            journal_entry__entry_date__lte=as_of,
            aquaculture_pond_id=pond_id,
            account__account_code__in=_PRODUCTION_EXPENSE_ACCOUNT_CODES,
            account__is_active=True,
        )
        .values("account_id", "account__account_code")
        .annotate(
            net=Coalesce(Sum(F("debit") - F("credit")), Decimal("0")),
        )
        .filter(net__gt=0)
        .order_by("account__account_code")
    )
    account_ids = [int(r["account_id"]) for r in rows]
    accounts = {
        a.id: a
        for a in ChartOfAccount.objects.filter(pk__in=account_ids, company_id=company_id, is_active=True)
    }
    out: list[tuple[ChartOfAccount, Decimal, str]] = []
    for r in rows:
        acc = accounts.get(int(r["account_id"]))
        if not acc:
            continue
        code = (acc.account_code or "").strip()
        bucket = _ACCOUNT_CODE_TO_COST_BUCKET.get(code, "miscellaneous")
        out.append((acc, _money_q(Decimal(str(r["net"] or 0))), bucket))
    return out


def post_pond_expense_reclass_to_1581(
    company_id: int,
    *,
    pond_id: int,
    production_cycle_id: int | None,
    entry_date: date,
    entry_number: str,
    amount_needed: Decimal,
    memo: str = "",
) -> Decimal:
    """
    Dr 1581 / Cr pond production expense accounts up to ``amount_needed``.
    Idempotent when ``entry_number`` already exists. Returns amount posted to 1581.
    """
    if amount_needed <= 0:
        return Decimal("0")
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        existing = (
            JournalEntryLine.objects.filter(
                journal_entry__company_id=company_id,
                journal_entry__entry_number=entry_number,
                account__account_code=CODE_INV_BIO,
                aquaculture_pond_id=pond_id,
                debit__gt=0,
            ).aggregate(t=Coalesce(Sum("debit"), Decimal("0")))["t"]
        )
        return _money_q(Decimal(str(existing or 0)))

    if not AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).exists():
        return Decimal("0")

    bio = bio_inventory_account(company_id)
    if not bio:
        logger.warning("skip reclass %s: missing COA 1581", entry_number)
        return Decimal("0")

    balances = pond_production_expense_balances(company_id, pond_id, entry_date)
    available = sum(amt for _, amt, _ in balances)
    target = _money_q(min(amount_needed, available))
    if target <= 0:
        return Decimal("0")

    from api.services.gl_posting import _create_posted_entry

    lines: list[tuple] = []
    aq_costing: list[Optional[dict]] = []
    line_memo = (memo or "Reclass pond production expense to biological inventory")[:300]
    running = Decimal("0")
    positive = [(acc, amt, bucket) for acc, amt, bucket in balances if amt > 0]
    for i, (acc, bal, bucket) in enumerate(positive):
        if i == len(positive) - 1:
            slice_amt = _money_q(target - running)
        else:
            slice_amt = _money_q(bal * target / available)
            running += slice_amt
        if slice_amt <= 0:
            continue
        cr_meta = {
            "pond_id": pond_id,
            "production_cycle_id": production_cycle_id,
            "cost_bucket": bucket,
        }
        lines.append((bio, slice_amt, Decimal("0"), line_memo))
        aq_costing.append(cr_meta)
        lines.append((acc, Decimal("0"), slice_amt, line_memo))
        aq_costing.append(cr_meta)

    if not lines:
        return Decimal("0")

    desc = f"Aquaculture — capitalize pond production costs to 1581 ({line_memo})"[:500]
    je = _create_posted_entry(
        company_id,
        entry_date,
        entry_number,
        desc,
        lines,
        gl_station_id=None,
        aquaculture_line_costing=aq_costing,
    )
    if je is None:
        return Decimal("0")
    posted = sum(_money_q(ln[1]) for ln in lines if ln[0].id == bio.id and ln[1] > 0)
    return posted


def delete_pond_expense_reclass_to_1581(company_id: int, entry_number: str) -> int:
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=entry_number,
    ).delete()
    return deleted


def expense_account_for_pond_bill_line(
    company_id: int,
    line,
    *,
    fallback,
) -> ChartOfAccount:
    """
    Non-inventory vendor bill debits for pond-tagged lines: aquaculture COA (or 1581 when capitalizing).
    """
    pond_id = getattr(line, "aquaculture_pond_id", None)
    if not pond_id:
        return fallback

    bucket = (getattr(line, "aquaculture_cost_bucket", None) or "").strip()
    if not bucket:
        trc = getattr(line, "tenant_reporting_category", None)
        if trc is not None and getattr(trc, "application", None) == "aquaculture":
            from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket

            cat_code = (getattr(trc, "code", None) or "").strip()
            if cat_code:
                bucket = aquaculture_expense_category_to_cost_bucket(cat_code, company_id=company_id)
    if not bucket:
        bucket = "miscellaneous"

    if company_capitalizes_pond_production(company_id) and pond_cost_bucket_capitalizes_to_bio(bucket):
        bio = bio_inventory_account(company_id)
        if bio:
            return bio

    cat = expense_category_from_cost_bucket(bucket)
    if not cat:
        return fallback
    code = coa_account_code_for_aquaculture_expense_category(cat, company_id=company_id)
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code, is_active=True
    ).first()
    return acc or fallback
