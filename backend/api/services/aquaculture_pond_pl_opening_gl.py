"""Optional G/L posting for go-live prior P&L openings (per pond, per category)."""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from api.models import AquaculturePond, AquaculturePondPlOpening, ChartOfAccount, JournalEntry
from api.services.aquaculture_bill_defaults import chart_account_id_for_aquaculture_expense_category
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_constants import coa_account_code_for_aquaculture_income_type
from api.services.aquaculture_cost_per_kg import aquaculture_expense_category_to_cost_bucket
from api.services.aquaculture_pond_pl_opening import PL_EXPENSE_EXCLUDED_CODES
from api.services.gl_posting import _coa, _create_posted_entry
from api.services.loan_counterparty_opening import resolve_opening_balance_equity
from api.services.tenant_reporting_categories import (
    resolve_aquaculture_expense_to_builtin,
    resolve_aquaculture_income_to_builtin,
)

logger = logging.getLogger(__name__)

_MONEY = Decimal("0.01")


def _q(d: Decimal) -> Decimal:
    return d.quantize(_MONEY, rounding=ROUND_HALF_UP)


def pl_opening_gl_fields_for_api(pond: AquaculturePond) -> dict:
    locked = bool(pond.pl_opening_journal_id)
    je_num = ""
    if pond.pl_opening_journal_id and pond.pl_opening_journal:
        je_num = (pond.pl_opening_journal.entry_number or "").strip()
    return {
        "pl_opening_gl_locked": locked,
        "pl_opening_journal_id": pond.pl_opening_journal_id,
        "pl_opening_journal_number": je_num,
    }


def _delete_pl_opening_journal(company_id: int, pond_id: int) -> None:
    JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-POND-PL-OB-{pond_id}",
    ).delete()
    AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).update(pl_opening_journal_id=None)


def _account_for_income(company_id: int, category_code: str) -> ChartOfAccount | None:
    builtin = resolve_aquaculture_income_to_builtin(company_id, category_code)
    code = coa_account_code_for_aquaculture_income_type(builtin, company_id=company_id)
    return _coa(company_id, code)


def _account_for_expense(company_id: int, category_code: str) -> ChartOfAccount | None:
    if category_code in PL_EXPENSE_EXCLUDED_CODES:
        return None
    builtin = resolve_aquaculture_expense_to_builtin(company_id, category_code)
    aid = chart_account_id_for_aquaculture_expense_category(company_id, builtin)
    if not aid:
        return None
    return ChartOfAccount.objects.filter(pk=aid, company_id=company_id, is_active=True).first()


def post_pond_pl_opening_gl(company_id: int, pond_id: int, *, post_to_gl: bool = True) -> bool:
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return False

    entry_number = f"AUTO-POND-PL-OB-{pond_id}"
    rows = list(
        AquaculturePondPlOpening.objects.filter(company_id=company_id, pond_id=pond_id).exclude(amount=0)
    )
    if not rows:
        if pond.pl_opening_journal_id:
            _delete_pl_opening_journal(company_id, pond_id)
            pond.pl_opening_journal_id = None
        return True
    if not post_to_gl:
        return True
    if pond.pl_opening_journal_id:
        return True

    ensure_aquaculture_chart_accounts(company_id)
    equity = resolve_opening_balance_equity(company_id)
    if not equity:
        logger.warning("company %s pond %s: missing opening balance equity for PL opening G/L", company_id, pond_id)
        return False

    entry_date = rows[0].as_of_date
    if not entry_date:
        return False

    lines: list[tuple] = []
    meta: list[dict | None] = []
    pond_label = (pond.name or f"Pond #{pond_id}").strip()[:80]

    for row in rows:
        amt = _q(row.amount or Decimal("0"))
        if amt == 0:
            continue
        code = row.category_code
        if row.pl_kind == AquaculturePondPlOpening.KIND_INCOME:
            acc = _account_for_income(company_id, code)
            if not acc:
                logger.warning("pond %s income %s: missing COA", pond_id, code)
                return False
            memo = f"Prior P&L income opening — {pond_label} — {code}"[:280]
            lines.append((equity, amt, Decimal("0"), memo))
            lines.append((acc, Decimal("0"), amt, memo))
            bucket = f"rev_{code}"[:40]
            meta.extend(
                [
                    {"pond_id": pond_id, "cost_bucket": bucket},
                    {"pond_id": pond_id, "cost_bucket": bucket},
                ]
            )
        else:
            acc = _account_for_expense(company_id, code)
            if not acc:
                logger.warning("pond %s expense %s: missing COA", pond_id, code)
                return False
            memo = f"Prior P&L expense opening — {pond_label} — {code}"[:280]
            lines.append((acc, amt, Decimal("0"), memo))
            lines.append((equity, Decimal("0"), amt, memo))
            bucket = aquaculture_expense_category_to_cost_bucket(code, company_id=company_id)
            meta.extend(
                [
                    {"pond_id": pond_id, "cost_bucket": bucket},
                    {"pond_id": pond_id, "cost_bucket": bucket},
                ]
            )

    if not lines:
        return True

    desc = f"Aquaculture prior P&L opening — {pond_label}"[:500]
    with transaction.atomic():
        _delete_pl_opening_journal(company_id, pond_id)
        je = _create_posted_entry(
            company_id,
            entry_date,
            entry_number,
            desc,
            lines,
            aquaculture_line_costing=meta,
        )
        if not je:
            return False
        AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).update(pl_opening_journal_id=je.id)
    pond.pl_opening_journal_id = je.id
    return True


def apply_pond_pl_opening_gl(company_id: int, pond_id: int, *, post_to_gl: bool = True) -> str | None:
    if not post_pond_pl_opening_gl(company_id, pond_id, post_to_gl=post_to_gl):
        if post_to_gl:
            has_rows = AquaculturePondPlOpening.objects.filter(
                company_id=company_id, pond_id=pond_id
            ).exclude(amount=0).exists()
            if has_rows:
                return (
                    "Could not post prior P&L opening to the general ledger. "
                    "Ensure aquaculture income/expense and 3200 accounts exist, "
                    "or set post_pl_opening_to_gl to false."
                )
    return None
