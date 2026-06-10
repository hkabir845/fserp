"""Post fixed asset acquisition, depreciation, disposal, and reversals to the GL."""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from api.models import ChartOfAccount, FixedAsset, FixedAssetDepreciationRun, Station
from api.services.gl_posting import _create_posted_entry
from api.services.loan_counterparty_opening import resolve_opening_balance_equity

logger = logging.getLogger(__name__)


def _coa_ok(company_id: int, acc: ChartOfAccount | None) -> bool:
    return bool(acc and acc.company_id == company_id and acc.is_active)


def _coa_label(acc: ChartOfAccount | None) -> str:
    if not acc:
        return ""
    code = (acc.account_code or "").strip()
    name = (acc.account_name or "").strip()
    if code and name:
        return f"{code} — {name}"[:200]
    return (code or name)[:200]


def _asset_gl_station_id(asset: FixedAsset) -> Optional[int]:
    sid = getattr(asset, "station_id", None)
    if not sid:
        return None
    if Station.objects.filter(pk=sid, company_id=asset.company_id, is_active=True).exists():
        return int(sid)
    return None


def _asset_aquaculture_meta(asset: FixedAsset) -> Optional[dict]:
    pid = getattr(asset, "aquaculture_pond_id", None)
    if not pid:
        return None
    return {"pond_id": int(pid)}


def post_fixed_asset_acquisition(company_id: int, asset: FixedAsset) -> bool:
    """
    Dr fixed asset / Cr settlement (bank or cash).
    Skipped when settlement_account is unset (mid-life adoption without cash movement).
    """
    if asset.company_id != company_id:
        return False
    if asset.acquisition_journal_entry_id:
        return True
    amt = asset.acquisition_cost or Decimal("0")
    if amt <= 0:
        return False
    settlement = asset.settlement_account
    asset_acc = asset.asset_account
    if not settlement:
        return True
    if not _coa_ok(company_id, settlement) or not _coa_ok(company_id, asset_acc):
        logger.warning("fixed asset %s acquisition: invalid GL accounts", asset.id)
        return False
    entry_number = f"AUTO-FA-ACQ-{asset.id}"
    base = (asset.asset_number or asset.name or "").strip()
    memo_asset = (f"Capitalize · {base}" if base else "Capitalize fixed asset")[:280]
    settle_lbl = _coa_label(settlement)
    memo_settle = (
        (f"Payment {settle_lbl} · {base}" if base else f"Payment {settle_lbl}")
    )[:280]
    lines = [
        (asset_acc, amt, Decimal("0"), memo_asset),
        (settlement, Decimal("0"), amt, memo_settle),
    ]
    je = _create_posted_entry(
        company_id,
        asset.in_service_date or asset.acquisition_date,
        entry_number,
        f"Fixed asset acquisition {asset.asset_number} — {asset.name}"[:500],
        lines,
        gl_station_id=_asset_gl_station_id(asset),
    )
    if not je:
        return False
    with transaction.atomic():
        FixedAsset.objects.filter(pk=asset.pk).update(acquisition_journal_entry_id=je.id)
    return True


def post_fixed_asset_opening_accumulated_depreciation(company_id: int, asset: FixedAsset) -> bool:
    """
    Mid-life adoption: Dr Opening Balance Equity / Cr accumulated depreciation.
    Idempotent via entry_number AUTO-FA-OB-DEP-{asset.id}.
    """
    if asset.company_id != company_id:
        return False
    opening = asset.opening_accumulated_depreciation or Decimal("0")
    if opening <= 0:
        return True
    accum = asset.accumulated_depreciation_account
    equity = resolve_opening_balance_equity(company_id)
    if not _coa_ok(company_id, accum) or not _coa_ok(company_id, equity):
        logger.warning("fixed asset %s opening depr: missing accum or OBE account", asset.id)
        return False
    entry_number = f"AUTO-FA-OB-DEP-{asset.id}"
    base = (asset.asset_number or asset.name or "").strip()
    memo = (f"Opening accumulated depreciation · {base}" if base else "Opening accumulated depreciation")[:280]
    lines = [
        (equity, opening, Decimal("0"), memo),
        (accum, Decimal("0"), opening, memo),
    ]
    je = _create_posted_entry(
        company_id,
        asset.in_service_date or asset.acquisition_date,
        entry_number,
        f"Fixed asset opening depreciation {asset.asset_number}"[:500],
        lines,
        gl_station_id=_asset_gl_station_id(asset),
    )
    return bool(je)


def post_fixed_asset_depreciation(company_id: int, run: FixedAssetDepreciationRun) -> bool:
    """Dr depreciation expense / Cr accumulated depreciation."""
    asset = run.fixed_asset
    if asset.company_id != company_id:
        return False
    amt = run.amount or Decimal("0")
    if amt <= 0:
        return False
    expense = asset.depreciation_expense_account
    accum = asset.accumulated_depreciation_account
    if not _coa_ok(company_id, expense) or not _coa_ok(company_id, accum):
        logger.warning("fixed asset depreciation %s: invalid GL accounts", run.id)
        return False
    memo = (run.memo or asset.asset_number or asset.name or "")[:280]
    entry_number = f"AUTO-FA-DEP-{run.id}"
    gst = _asset_gl_station_id(asset)
    aq_meta = _asset_aquaculture_meta(asset)
    lines = [
        (expense, amt, Decimal("0"), memo, gst),
        (accum, Decimal("0"), amt, memo, None),
    ]
    je = _create_posted_entry(
        company_id,
        run.run_date,
        entry_number,
        f"Depreciation {asset.asset_number} — {asset.name}"[:500],
        lines,
        gl_station_id=gst,
        aquaculture_line_costing=[aq_meta, None],
    )
    if not je:
        return False
    with transaction.atomic():
        FixedAssetDepreciationRun.objects.filter(pk=run.pk).update(journal_entry_id=je.id)
        new_accum = (asset.accumulated_depreciation or Decimal("0")) + amt
        status = asset.status
        salvage = asset.salvage_value or Decimal("0")
        book = (asset.acquisition_cost or Decimal("0")) - new_accum
        if book <= salvage + Decimal("0.005"):
            status = FixedAsset.STATUS_FULLY_DEPRECIATED
        FixedAsset.objects.filter(pk=asset.pk).update(
            accumulated_depreciation=new_accum,
            last_depreciation_date=run.run_date,
            status=status,
        )
    return True


def reverse_fixed_asset_depreciation(company_id: int, run: FixedAssetDepreciationRun, reversal_date) -> bool:
    """Reverse a posted depreciation run and restore asset accumulated depreciation."""
    asset = run.fixed_asset
    if asset.company_id != company_id or run.reversed_at:
        return False
    if not run.journal_entry_id:
        return False
    amt = run.amount or Decimal("0")
    if amt <= 0:
        return False
    expense = asset.depreciation_expense_account
    accum = asset.accumulated_depreciation_account
    if not _coa_ok(company_id, expense) or not _coa_ok(company_id, accum):
        return False
    memo = f"Reverse depreciation #{run.id} {asset.asset_number}"[:280]
    entry_number = f"AUTO-FA-DEP-REV-{run.id}"
    gst = _asset_gl_station_id(asset)
    aq_meta = _asset_aquaculture_meta(asset)
    lines = [
        (expense, Decimal("0"), amt, memo, gst),
        (accum, amt, Decimal("0"), memo, None),
    ]
    je = _create_posted_entry(
        company_id,
        reversal_date,
        entry_number,
        f"Reverse depreciation {asset.asset_number} — {asset.name}"[:500],
        lines,
        gl_station_id=gst,
        aquaculture_line_costing=[aq_meta, None],
    )
    if not je:
        return False
    with transaction.atomic():
        FixedAssetDepreciationRun.objects.filter(pk=run.pk).update(
            reversed_at=timezone.now(),
            reversal_journal_entry_id=je.id,
        )
        new_accum = max((asset.accumulated_depreciation or Decimal("0")) - amt, Decimal("0"))
        FixedAsset.objects.filter(pk=asset.pk).update(
            accumulated_depreciation=new_accum,
            status=FixedAsset.STATUS_ACTIVE,
        )
    return True


def post_fixed_asset_disposal(
    company_id: int,
    asset: FixedAsset,
    *,
    disposal_date,
    proceeds: Decimal,
    proceeds_account: ChartOfAccount | None,
    gain_account: ChartOfAccount | None,
    loss_account: ChartOfAccount | None,
) -> bool:
    """
    Dr accumulated depreciation (+ proceeds + loss) / Cr asset (+ gain).
    """
    if asset.company_id != company_id or asset.disposal_journal_entry_id:
        return False
    cost = asset.acquisition_cost or Decimal("0")
    accum_amt = asset.accumulated_depreciation or Decimal("0")
    book = cost - accum_amt
    proceeds = proceeds or Decimal("0")
    gain_loss = proceeds - book

    asset_acc = asset.asset_account
    accum_acc = asset.accumulated_depreciation_account
    if not _coa_ok(company_id, asset_acc) or not _coa_ok(company_id, accum_acc):
        return False
    if proceeds > 0 and not _coa_ok(company_id, proceeds_account):
        return False
    if gain_loss > Decimal("0.005") and not _coa_ok(company_id, gain_account):
        return False
    if gain_loss < Decimal("-0.005") and not _coa_ok(company_id, loss_account):
        return False

    base = (asset.asset_number or asset.name or "").strip()
    memo = (f"Disposal · {base}" if base else "Asset disposal")[:280]
    gst = _asset_gl_station_id(asset)
    aq_meta = _asset_aquaculture_meta(asset)
    lines: list = []
    aq_costing: list = []

    if accum_amt > 0:
        lines.append((accum_acc, accum_amt, Decimal("0"), memo, None))
        aq_costing.append(None)
    if proceeds > 0 and proceeds_account:
        lines.append((proceeds_account, proceeds, Decimal("0"), memo, gst))
        aq_costing.append(None)
    lines.append((asset_acc, Decimal("0"), cost, memo, None))
    aq_costing.append(None)

    if gain_loss > Decimal("0.005") and gain_account:
        lines.append((gain_account, Decimal("0"), gain_loss, memo, gst))
        aq_costing.append(aq_meta)
    elif gain_loss < Decimal("-0.005") and loss_account:
        loss_amt = abs(gain_loss)
        lines.append((loss_account, loss_amt, Decimal("0"), memo, gst))
        aq_costing.append(aq_meta)

    entry_number = f"AUTO-FA-DISP-{asset.id}"
    je = _create_posted_entry(
        company_id,
        disposal_date,
        entry_number,
        f"Fixed asset disposal {asset.asset_number} — {asset.name}"[:500],
        lines,
        gl_station_id=gst,
        aquaculture_line_costing=aq_costing,
    )
    if not je:
        return False
    with transaction.atomic():
        FixedAsset.objects.filter(pk=asset.pk).update(
            status=FixedAsset.STATUS_DISPOSED,
            disposal_date=disposal_date,
            disposal_journal_entry_id=je.id,
        )
    return True
