"""Auto cost for inter-pond fish transfers from source-pond production P&L."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import models

from api.models import AquaculturePond, AquacultureProductionCycle
from api.services.aquaculture_pl_service import _money_q, compute_aquaculture_pl_summary_dict
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

# Costs that stay on the source pond when fish leave (not moved with fingerlings/fish).
_BIO_ASSET_EXCLUDED_FROM_TRANSFER = frozenset({"lease", "shop_supplies"})

# Nursing pond fixed assets / overhead — stay on source when fingerlings move to grow-out ponds.
_NURSING_FIXED_POND_BUCKETS = frozenset(
    {
        "lease",
        "shop_supplies",
        "electricity",
        "equipment",
        "repair_maintenance",
    }
)

# Legacy P&L bucket subset (fallback when bio-asset summary is empty).
_TRANSFER_COST_BUCKETS = frozenset(
    {
        "fry_stocking",
        "pond_preparation",
        "feed",
        "medicine",
        "fish_transfer_in",
        "labor",
        "electricity",
        "equipment",
        "repair_maintenance",
        "transportation",
        "fisherman",
        "day_labor",
        "miscellaneous",
        "ancillary",
    }
)


def pl_window_for_transfer_date(
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> tuple[date, date]:
    """Match frontend /aquaculture/transfers plWindowForTransferDate."""
    if from_cycle and from_cycle.start_date:
        start = from_cycle.start_date
        end = transfer_date
        if from_cycle.end_date and from_cycle.end_date < end:
            end = from_cycle.end_date
        if start > end:
            start = end
        return start, end
    return date(transfer_date.year, 1, 1), transfer_date


def _biological_production_cost_total(costing_lines: list[dict]) -> Decimal:
    total = Decimal("0")
    for row in costing_lines or []:
        code = str(row.get("cost_bucket") or "")
        if code not in _TRANSFER_COST_BUCKETS:
            continue
        total += Decimal(str(row.get("amount") or 0))
    return _money_q(total)


def _nursing_transferable_cost_total(costing_lines: list[dict]) -> Decimal:
    """Fry + feed + medicine + labor + … movable with fingerlings; fixed pond overhead excluded."""
    total = Decimal("0")
    for row in costing_lines or []:
        code = str(row.get("cost_bucket") or "")
        if code not in _TRANSFER_COST_BUCKETS:
            continue
        if code in _NURSING_FIXED_POND_BUCKETS:
            continue
        total += Decimal(str(row.get("amount") or 0))
    return _money_q(total)


def transfer_cost_pools_for_scope(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> tuple[Decimal, Decimal]:
    """Return (fry_stocking pool, other production pool) for splitting transfer line cost display."""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    cost_as_of = _nursing_cost_as_of_date(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=transfer_date,
    )
    start, end = pl_window_for_transfer_date(cost_as_of, from_cycle)
    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        from_pond_id,
        cycle_filter_id,
        from_cycle,
        include_cycle_breakdown=False,
    )
    fry = Decimal("0")
    other = Decimal("0")
    ponds = payload.get("ponds") or []
    if ponds:
        for row in ponds[0].get("cost_per_kg", {}).get("costing_lines") or []:
            code = str(row.get("cost_bucket") or "")
            if code not in _TRANSFER_COST_BUCKETS or code in _NURSING_FIXED_POND_BUCKETS:
                continue
            amt = Decimal(str(row.get("amount") or 0))
            if amt <= 0:
                continue
            if code == "fry_stocking":
                fry += amt
            else:
                other += amt
    if fry <= 0 and other <= 0:
        from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary

        summary = compute_pond_biological_asset_summary(
            company_id,
            pond_id=from_pond_id,
            as_of_date=cost_as_of,
            production_cycle=from_cycle,
        )
        skip = _NURSING_FIXED_POND_BUCKETS | frozenset(
            {"fish_transfer_in", "fish_transfer_out", "biological_writeoff", "prior_pl_opening"}
        )
        for row in summary.get("cost_buckets") or []:
            code = str(row.get("cost_bucket") or "").strip()
            if code in skip or code in _BIO_ASSET_EXCLUDED_FROM_TRANSFER:
                continue
            amt = Decimal(str(row.get("amount") or 0))
            if amt <= 0:
                continue
            if code == "fry_stocking":
                fry += amt
            else:
                other += amt
    return _money_q(fry), _money_q(other)


def split_transfer_line_cost_amount(
    line_cost: Decimal,
    fry_pool: Decimal,
    other_pool: Decimal,
) -> tuple[Decimal, Decimal]:
    """Split line cost_amount into fry purchase share and feed/medicine/labor share."""
    total = _money_q(line_cost or Decimal("0"))
    if total <= 0:
        return Decimal("0"), Decimal("0")
    movable = _money_q(fry_pool + other_pool)
    if movable <= 0:
        return total, Decimal("0")
    fry_share = _money_q(total * fry_pool / movable)
    other_share = _money_q(total - fry_share)
    return fry_share, other_share


def _transferable_bio_asset_total(summary: dict) -> Decimal:
    """Pond biological asset value movable with fish (excludes lease, shop supplies)."""
    total = Decimal(str(summary.get("total_biological_asset_value") or 0))
    for row in summary.get("cost_buckets") or []:
        code = str(row.get("cost_bucket") or "")
        if code in _BIO_ASSET_EXCLUDED_FROM_TRANSFER:
            total -= Decimal(str(row.get("amount") or 0))
    return max(Decimal("0"), _money_q(total))


def _bio_asset_transfer_share(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    weight_kg: Decimal,
    fish_count: int | None,
    prefer_heads: bool,
) -> Decimal:
    """
    Move a proportional slice of the source pond biological asset with the fish.

    Uses live fish count (or live kg for grow-out) as the denominator so partial
    transfers and mortality redistribution stay aligned with survivor economics.
    """
    from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary

    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=from_pond_id,
        as_of_date=transfer_date,
        production_cycle=from_cycle,
    )
    movable = _transferable_bio_asset_total(summary)
    if movable <= 0:
        return Decimal("0")

    live_c = int(summary.get("live_fish_count") or 0)
    live_kg = Decimal(str(summary.get("live_weight_kg") or 0))
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    if live_c <= 0:
        live_c = _live_fingerling_heads_basis(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
        )
    heads = int(fish_count or 0)
    wk = _money_q(weight_kg)

    if prefer_heads and heads > 0 and live_c > 0:
        return _money_q(movable * Decimal(heads) / Decimal(live_c))
    if wk > 0 and live_kg > 0:
        return _money_q(movable * wk / live_kg)
    if heads > 0 and live_c > 0:
        return _money_q(movable * Decimal(heads) / Decimal(live_c))
    return Decimal("0")


def _transfer_denominator_kg(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
    cpk: dict,
    line_weight_kg: Decimal | None,
    transfer_total_weight_kg: Decimal | None = None,
) -> tuple[Decimal, str]:
    """Kg basis for transfer cost — at least total transfer kg when sale kg is too small."""
    sale_denom = Decimal(str(cpk.get("denominator_kg") or 0))
    if sale_denom < 0:
        sale_denom = Decimal("0")

    on_hand = Decimal("0")
    pos_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_filter_id,
    )
    if pos_rows:
        on_hand = _money_q(Decimal(str(pos_rows[0].get("implied_net_weight_kg") or 0)))

    xfer_kg = transfer_total_weight_kg if transfer_total_weight_kg and transfer_total_weight_kg > 0 else line_weight_kg

    candidates: list[tuple[Decimal, str]] = []
    if sale_denom > 0:
        basis = str(cpk.get("weight_basis") or "sale")
        if basis == "harvest_sale":
            label = "harvest sale kg in period"
        elif basis == "bio_sales":
            label = "biological sale kg in period"
        else:
            label = "sale kg in period"
        candidates.append((sale_denom, label))
    if on_hand > 0:
        candidates.append((on_hand, "on-hand fish kg (stock position)"))
    if xfer_kg is not None and xfer_kg > 0:
        label = (
            "kg on this transfer (all lines)"
            if transfer_total_weight_kg and transfer_total_weight_kg > 0
            else "kg on this transfer line"
        )
        candidates.append((_money_q(xfer_kg), label))

    if not candidates:
        return Decimal("0"), ""

    denom, note = max(candidates, key=lambda x: x[0])
    if xfer_kg and sale_denom > 0 and xfer_kg > sale_denom:
        return denom, (
            f"Uses {note} ({denom} kg) because transfer kg ({xfer_kg} kg) is larger than "
            f"fingerling/harvest sale kg ({sale_denom} kg) — avoids inflating cost/kg."
        )
    return denom, note


def lookup_transfer_cost_per_kg(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    line_weight_kg: Decimal | None = None,
    transfer_total_weight_kg: Decimal | None = None,
) -> tuple[Decimal | None, str]:
    """
    Production cost per kg for inter-pond transfers.
    Uses fry/feed/medicine/preparation (+ transfer-in) over a kg basis that is at least transfer kg.
    """
    start, end = pl_window_for_transfer_date(transfer_date, from_cycle)
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        from_pond_id,
        cycle_filter_id,
        from_cycle,
        include_cycle_breakdown=False,
    )
    ponds = payload.get("ponds") or []
    if not ponds:
        return None, ""
    cpk = ponds[0].get("cost_per_kg") or {}
    bio_total = _biological_production_cost_total(cpk.get("costing_lines") or [])
    if bio_total <= 0:
        return None, "No fry/feed/medicine/preparation costs recorded for this pond in the selected period."

    denom, denom_note = _transfer_denominator_kg(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        cpk=cpk,
        line_weight_kg=line_weight_kg,
        transfer_total_weight_kg=transfer_total_weight_kg,
    )
    if denom <= 0:
        return None, "No kg basis (sales, on-hand fish, or transfer weight) for transfer cost."

    per_kg = _money_q(bio_total / denom)
    note = (
        f"Transfer cost/kg = production costs ({bio_total}) ÷ {denom} kg ({denom_note}). "
        "Shop supplies, lease, and other overhead are excluded from fish transfer cost."
    )
    return per_kg, note


def _nursing_cost_as_of_date(
    *,
    company_id: int,
    from_pond_id: int,
    cycle_filter_id: int | None,
    transfer_date: date,
    exclude_transfer_id: int | None = None,
) -> date:
    """Use the latest transfer date in the batch so fry + later feed/medicine costs are included."""
    from api.models import AquacultureFishPondTransfer

    q = AquacultureFishPondTransfer.objects.filter(
        company_id=company_id,
        from_pond_id=from_pond_id,
    )
    if cycle_filter_id is not None:
        q = q.filter(from_production_cycle_id=cycle_filter_id)
    else:
        q = q.filter(from_production_cycle_id__isnull=True)
    if exclude_transfer_id is not None:
        q = q.exclude(pk=exclude_transfer_id)
    latest = q.order_by("-transfer_date").values_list("transfer_date", flat=True).first()
    if latest and latest > transfer_date:
        return latest
    return transfer_date


def _nursing_fry_pool_for_pond_batch(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> Decimal:
    """
    Fry purchase total for a nursing batch — any production_cycle tag on the same pond.

    Fry is usually bought once per batch before cycle tags are aligned; cycle-scoped P&L
    alone often misses fry posted on sibling cycles or left untagged.
    """
    from django.db.models import Sum

    from api.models import AquacultureExpense
    from api.services.aquaculture_cost_per_kg import (
        fry_stocking_capitalized_manual_expense_ids,
        pond_fry_stocking_capitalized_journal_total,
    )

    start, end = pl_window_for_transfer_date(transfer_date, from_cycle)
    capitalized_ids = fry_stocking_capitalized_manual_expense_ids(company_id)
    exp_total = (
        AquacultureExpense.objects.filter(
            company_id=company_id,
            pond_id=from_pond_id,
            expense_category="fry_stocking",
            expense_date__gte=start,
            expense_date__lte=end,
        )
        .exclude(pk__in=capitalized_ids)
        .aggregate(s=Sum("amount"))["s"]
    )
    fry_exp = _money_q(Decimal(str(exp_total or 0)))
    fry_gl = pond_fry_stocking_capitalized_journal_total(
        company_id=company_id,
        pond_id=from_pond_id,
        start=start,
        end=end,
        cycle_filter_id=None,
    )
    return _money_q(max(fry_exp, fry_gl))


def _nursing_batch_cost_pool(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> Decimal:
    """Full fry + production costs on nursing pond (not reduced by prior transfer-out relief)."""
    start, end = pl_window_for_transfer_date(transfer_date, from_cycle)
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        from_pond_id,
        cycle_filter_id,
        from_cycle,
        include_cycle_breakdown=False,
    )
    ponds = payload.get("ponds") or []
    fry_cycle = Decimal("0")
    other = Decimal("0")
    if ponds:
        cpk = ponds[0].get("cost_per_kg") or {}
        for row in cpk.get("costing_lines") or []:
            code = str(row.get("cost_bucket") or "")
            if code not in _TRANSFER_COST_BUCKETS or code in _NURSING_FIXED_POND_BUCKETS:
                continue
            amt = Decimal(str(row.get("amount") or 0))
            if amt <= 0:
                continue
            if code == "fry_stocking":
                fry_cycle += amt
            else:
                other += amt
    fry_pond = _nursing_fry_pool_for_pond_batch(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
    )
    fry = max(fry_cycle, fry_pond)
    total = _money_q(other + fry)
    if total > 0:
        return total
    return _bio_total_for_transfer_scope(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
    )


def _cumulative_transfer_fish_out(
    *,
    company_id: int,
    from_pond_id: int,
    cycle_filter_id: int | None,
    exclude_transfer_id: int | None = None,
) -> int:
    """Sum fish_count on all inter-pond transfer lines out of this pond/cycle (entire batch)."""
    from django.db.models import Sum

    from api.models import AquacultureFishPondTransferLine

    q = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        transfer__from_pond_id=from_pond_id,
        fish_count__gt=0,
    )
    if cycle_filter_id is not None:
        q = q.filter(transfer__from_production_cycle_id=cycle_filter_id)
    if exclude_transfer_id is not None:
        q = q.exclude(transfer_id=exclude_transfer_id)
    total = q.aggregate(s=Sum("fish_count"))["s"]
    return int(total or 0)


def _latest_sample_fish_count(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
    as_of_date: date,
) -> int:
    from api.models import AquacultureBiomassSample

    def _pick_count(qs) -> int:
        row = (
            qs.order_by("-sample_date", "-id")
            .values_list("stock_reference_fish_count", "estimated_fish_count")
            .first()
        )
        if not row:
            return 0
        ref, est = row
        if ref is not None and int(ref) > 0:
            return int(ref)
        return int(est or 0)

    base = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sample_date__lte=as_of_date,
    ).filter(
        models.Q(stock_reference_fish_count__gt=0) | models.Q(estimated_fish_count__gt=0)
    )
    if cycle_filter_id is not None:
        scoped = _pick_count(base.filter(production_cycle_id=cycle_filter_id))
        if scoped > 0:
            return scoped
        # Cycle sample may be a seine subsample — prefer pond-wide extrapolated reference.
        pond_wide = _pick_count(base)
        if pond_wide > scoped:
            return pond_wide
        return scoped
    return _pick_count(base)


def _nursing_fingerling_allocation_denominator(
    *,
    company_id: int,
    from_pond_id: int,
    cycle_filter_id: int | None,
    transfer_date: date,
    fish_count: int | None,
    transfer_total_fish_count: int | None = None,
    exclude_transfer_id: int | None = None,
) -> int:
    """
    Survivor fingerling pool for spreading accumulated nursing costs (fry + feed + …).

    Uses fish already moved out plus live survivors still on the nursing pond (or a
    biomass / vendor-bill stocking estimate when the ledger is stale). The fish count
    on the transfer line being priced is never part of this pool — it only multiplies
    cost/head in the numerator.
    """
    del fish_count, transfer_total_fish_count  # draft line counts must not inflate the pool

    prior_out = _cumulative_transfer_fish_out(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        exclude_transfer_id=exclude_transfer_id,
    )
    sample = _latest_sample_fish_count(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        as_of_date=transfer_date,
    )
    live = _nursing_pond_survivor_live_heads(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        as_of_date=transfer_date,
    )
    stocked = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )

    # Mortality keeps full fry+feed cost on survivors: pool = already moved + still on hand.
    survivor_pool = prior_out + live
    if sample > 0 and survivor_pool < sample:
        survivor_pool = max(survivor_pool, sample)
    if prior_out <= 0 and live <= 0 and sample > 0:
        survivor_pool = sample
    elif prior_out <= 0 and live <= 0 and stocked > 0:
        survivor_pool = stocked
    elif prior_out <= 0 and stocked > survivor_pool:
        # Vendor fry bill shows full batch; ledger live not reconciled yet.
        survivor_pool = max(survivor_pool, stocked)

    if survivor_pool > 0:
        return survivor_pool
    if sample > 0:
        return sample
    if live > 0:
        return live
    return stocked


def _nursing_line_cost_from_per_head(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    fish_count: int | None,
    transfer_total_fish_count: int | None = None,
    exclude_transfer_id: int | None = None,
) -> Decimal:
    """line cost = fish_count × (fry + production expenses) ÷ survivor fingerling pool."""
    heads = int(fish_count or 0)
    if heads <= 0:
        return Decimal("0")
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    cost_as_of = _nursing_cost_as_of_date(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=transfer_date,
        exclude_transfer_id=exclude_transfer_id,
    )
    bio_total = _nursing_batch_cost_pool(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=cost_as_of,
        from_cycle=from_cycle,
    )
    if bio_total <= 0:
        return Decimal("0")
    denom = _nursing_fingerling_allocation_denominator(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=transfer_date,
        fish_count=heads,
        transfer_total_fish_count=transfer_total_fish_count,
        exclude_transfer_id=exclude_transfer_id,
    )
    if denom <= 0:
        return Decimal("0")
    return _money_q(bio_total * Decimal(heads) / Decimal(denom))


def _nursing_pond_survivor_live_heads(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
    as_of_date: date,
) -> int:
    """Best live-fingerling estimate for nursing cost/head when cycle tags disagree."""
    live = _live_fingerling_heads_basis(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    sample = _latest_sample_fish_count(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_filter_id,
        as_of_date=as_of_date,
    )
    stocked = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    if sample > 0 and (live <= 0 or live > sample * 3):
        return sample
    if live > 0:
        if stocked > 0 and live > stocked * 2:
            return max(sample, stocked) if sample > 0 else stocked
        return live
    if sample > 0:
        return sample
    return stocked


def _live_fingerling_heads_basis(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
) -> int:
    """
    Live fingerlings at source pond (survivors after mortality/sales), for per-head transfer cost.

    Uses implied net fish count from stock position; falls back to latest biomass sample estimate.
    Never uses original vendor-bill stocked count — mortality cost stays on survivors.
    """
    def _live_for_scope(scope_cycle_id: int | None) -> int:
        pos_rows = compute_fish_stock_position_rows(
            company_id,
            pond_id=pond_id,
            production_cycle_id=scope_cycle_id,
        )
        if not pos_rows:
            return 0
        row = pos_rows[0]
        live = int(row.get("implied_net_fish_count") or 0)
        if live > 0:
            return live
        samp_fc = row.get("latest_sample_estimated_fish_count")
        if samp_fc is not None:
            try:
                n = int(samp_fc)
                if n > 0:
                    return n
            except (TypeError, ValueError):
                pass
        return 0

    live = _live_for_scope(cycle_filter_id)
    if live > 0:
        return live
    if cycle_filter_id is not None:
        return _live_for_scope(None)
    return 0


def _nursing_stocked_heads_basis(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
) -> int:
    """Fingerlings stocked on nursing pond (vendor fish bills), for per-head transfer costing."""
    def _stocked_for_scope(scope_cycle_id: int | None) -> int:
        pos_rows = compute_fish_stock_position_rows(
            company_id,
            pond_id=pond_id,
            production_cycle_id=scope_cycle_id,
        )
        if not pos_rows:
            return 0
        row = pos_rows[0]
        bill_heads = int(row.get("vendor_bill_in_fish_count") or 0)
        if bill_heads > 0:
            return bill_heads
        implied = int(row.get("implied_net_fish_count") or 0)
        return implied if implied > 0 else 0

    stocked = _stocked_for_scope(cycle_filter_id)
    if stocked > 0:
        return stocked
    if cycle_filter_id is not None:
        return _stocked_for_scope(None)
    return 0


def _production_cost_share_for_line(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    weight_kg: Decimal,
    transfer_total_weight_kg: Decimal | None,
    fish_count: int | None = None,
    transfer_total_fish_count: int | None = None,
    exclude_transfer_id: int | None = None,
) -> Decimal:
    """Compute this line's BDT share of fry/feed/medicine costs; tries cycle scope then YTD fallback."""

    def _share_for_scope(cycle_obj: AquacultureProductionCycle | None) -> Decimal:
        share = _bio_asset_transfer_share(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=cycle_obj,
            weight_kg=weight_kg,
            fish_count=fish_count,
            prefer_heads=False,
        )
        if share > 0:
            return share
        start, end = pl_window_for_transfer_date(transfer_date, cycle_obj)
        cycle_filter_id = cycle_obj.id if cycle_obj is not None else None
        payload = compute_aquaculture_pl_summary_dict(
            company_id,
            start,
            end,
            from_pond_id,
            cycle_filter_id,
            cycle_obj,
            include_cycle_breakdown=False,
        )
        ponds = payload.get("ponds") or []
        if not ponds:
            return Decimal("0")
        cpk = ponds[0].get("cost_per_kg") or {}
        bio_total = _biological_production_cost_total(cpk.get("costing_lines") or [])
        if bio_total <= 0:
            return Decimal("0")
        wk = _money_q(weight_kg)
        if wk <= 0:
            return Decimal("0")
        total_w = transfer_total_weight_kg if transfer_total_weight_kg and transfer_total_weight_kg > 0 else wk
        denom, _note = _transfer_denominator_kg(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
            cpk=cpk,
            line_weight_kg=wk,
            transfer_total_weight_kg=total_w,
        )
        if denom <= 0:
            return Decimal("0")
        return _money_q(bio_total * wk / denom)

    def _nursing_share_for_scope(cycle_obj: AquacultureProductionCycle | None) -> Decimal:
        return _nursing_line_cost_from_per_head(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=cycle_obj,
            fish_count=fish_count,
            transfer_total_fish_count=transfer_total_fish_count,
            exclude_transfer_id=exclude_transfer_id,
        )

    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    live_heads = _live_fingerling_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    head_basis_heads = stocked_heads if stocked_heads > 0 else live_heads
    use_head_basis = (
        fish_count
        and int(fish_count) > 0
        and (role == "nursing" or (head_basis_heads > 0 and head_basis_heads >= 10000))
    )
    if use_head_basis:
        share = _nursing_share_for_scope(from_cycle)
        if share > 0 or from_cycle is None:
            return share
        share_ytd = _nursing_share_for_scope(None)
        if share_ytd > share:
            return share_ytd
        return share

    share = _share_for_scope(from_cycle)
    if share > 0 or from_cycle is None:
        return share
    # Production cycle selected but fry/feed costs sit outside cycle dates — use YTD pond view.
    return _share_for_scope(None)


def _transfer_uses_head_cost_basis(
    *,
    company_id: int,
    from_pond_id: int,
    from_cycle: AquacultureProductionCycle | None,
    fish_count: int | None = None,
) -> tuple[bool, int]:
    """Whether inter-pond transfer cost uses live-fingerling head share (nursing-style)."""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    live_heads = _live_fingerling_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    heads = int(fish_count or 0)
    head_basis_heads = stocked_heads if stocked_heads > 0 else live_heads
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    if role == "nursing":
        return True, head_basis_heads or heads or stocked_heads or live_heads
    if head_basis_heads >= 10000:
        return True, head_basis_heads
    if heads <= 0:
        return False, live_heads or stocked_heads
    if head_basis_heads <= 0:
        return False, live_heads or stocked_heads
    use_head = head_basis_heads >= 10000
    return use_head, head_basis_heads


def _bio_total_for_transfer_scope(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> Decimal:
    from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary

    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=from_pond_id,
        as_of_date=transfer_date,
        production_cycle=from_cycle,
    )
    movable = _transferable_bio_asset_total(summary)
    if movable > 0:
        return movable
    start, end = pl_window_for_transfer_date(transfer_date, from_cycle)
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        from_pond_id,
        cycle_filter_id,
        from_cycle,
        include_cycle_breakdown=False,
    )
    ponds = payload.get("ponds") or []
    if not ponds:
        return Decimal("0")
    cpk = ponds[0].get("cost_per_kg") or {}
    return _biological_production_cost_total(cpk.get("costing_lines") or [])


def _transfer_cost_context(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> dict:
    """Live fish, biomass, and movable cost pool for transfer UI and cost preview."""
    from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary

    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=from_pond_id,
        as_of_date=transfer_date,
        production_cycle=from_cycle,
    )
    movable = _transferable_bio_asset_total(summary)
    if movable <= 0:
        movable = _bio_total_for_transfer_scope(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=from_cycle,
        )
    live_heads = int(summary.get("live_fish_count") or 0)
    if live_heads <= 0:
        live_heads = _live_fingerling_heads_basis(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
        )
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    pos_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=from_pond_id,
        production_cycle_id=cycle_filter_id,
    )
    row = pos_rows[0] if pos_rows else {}
    return {
        "live_fingerling_count": live_heads if live_heads > 0 else None,
        "stocked_fingerling_count": stocked_heads if stocked_heads > 0 else None,
        "movable_bio_asset_total": str(_money_q(movable)) if movable > 0 else None,
        "implied_net_weight_kg": row.get("implied_net_weight_kg"),
        "effective_net_weight_kg": row.get("effective_net_weight_kg"),
        "current_fish_per_kg": row.get("current_fish_per_kg"),
        "current_avg_weight_kg": row.get("current_avg_weight_kg"),
        "cost_per_fish": summary.get("cost_per_fish"),
        "cost_per_kg": summary.get("cost_per_kg"),
        "stock_density_kg_per_decimal": row.get("stock_density_kg_per_decimal"),
    }


def lookup_transfer_cost_per_head(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
) -> tuple[Decimal | None, str]:
    """Production cost per live fingerling for nursing-style inter-pond transfers."""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary

    cost_as_of = _nursing_cost_as_of_date(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=transfer_date,
    )
    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=from_pond_id,
        as_of_date=cost_as_of,
        production_cycle=from_cycle,
    )
    bio_total = _nursing_batch_cost_pool(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=cost_as_of,
        from_cycle=from_cycle,
    )
    if bio_total <= 0:
        bio_total = _bio_total_for_transfer_scope(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=cost_as_of,
            from_cycle=from_cycle,
        )
    if bio_total <= 0:
        return None, "No fry/feed/medicine/preparation costs recorded for this pond in the selected period."
    live_heads = int(summary.get("live_fish_count") or 0)
    if live_heads <= 0:
        live_heads = _live_fingerling_heads_basis(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
        )
    if live_heads <= 0:
        return None, "No live fingerling count for per-head transfer cost."
    denom = _nursing_fingerling_allocation_denominator(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=transfer_date,
        fish_count=live_heads,
        transfer_total_fish_count=None,
        exclude_transfer_id=None,
    )
    if denom <= 0:
        denom = live_heads
    per_head = _money_q(bio_total / Decimal(denom))
    note = (
        f"Transfer cost/head = movable biological asset ({bio_total}) ÷ {denom} survivor fingerlings "
        "(fish already moved + still in pond, or biomass sample; "
        "fry + feed + medicine + pond care + day labor on the nursing pond). "
        "Each line = fish count × cost/head. Lease, electricity, aerators/equipment stay on the source pond."
    )
    return per_head, note


def preview_transfer_line_costs(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    lines: list[dict],
) -> dict:
    """
    Preview auto production cost for each transfer line (matches save-time resolve_auto_transfer_line_cost).
    Each line dict must include weight_kg (Decimal) and fish_count (int, optional).
    """
    parsed: list[tuple[Decimal, int | None]] = []
    for ln in lines:
        wk = _money_q(ln.get("weight_kg") or Decimal("0"))
        fc_raw = ln.get("fish_count")
        fc: int | None = None
        if fc_raw not in (None, ""):
            fc = int(fc_raw)
        parsed.append((wk, fc))

    total_w = _money_q(sum(wk for wk, _ in parsed if wk > 0))
    sample_heads = next((fc for _, fc in parsed if fc and fc > 0), None)
    use_head, live_heads = _transfer_uses_head_cost_basis(
        company_id=company_id,
        from_pond_id=from_pond_id,
        from_cycle=from_cycle,
        fish_count=sample_heads,
    )
    ctx = _transfer_cost_context(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
    )

    transfer_cost_per_kg: str | None = None
    transfer_cost_per_head: str | None = None
    basis_note = ""

    if use_head:
        per_head, head_note = lookup_transfer_cost_per_head(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=from_cycle,
        )
        if per_head is not None:
            transfer_cost_per_head = str(per_head)
        basis_note = head_note
    else:
        per_kg, kg_note = lookup_transfer_cost_per_kg(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=from_cycle,
            line_weight_kg=None,
            transfer_total_weight_kg=total_w if total_w > 0 else None,
        )
        if per_kg is not None:
            transfer_cost_per_kg = str(per_kg)
        basis_note = kg_note

    line_out: list[dict] = []
    total_fish = sum(int(fc or 0) for _, fc in parsed if fc and fc > 0)
    for wk, fc in parsed:
        if wk <= 0 and not (fc and fc > 0):
            line_out.append({"cost_amount": None})
            continue
        cost = resolve_auto_transfer_line_cost(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=from_cycle,
            weight_kg=wk,
            submitted_cost=Decimal("0"),
            transfer_total_weight_kg=total_w if total_w > 0 else None,
            fish_count=fc,
            transfer_total_fish_count=total_fish if total_fish > 0 else None,
        )
        line_out.append({"cost_amount": str(cost) if cost > 0 else None})

    return {
        "cost_basis": "per_head" if use_head else "per_kg",
        "live_fingerling_count": ctx.get("live_fingerling_count"),
        "stocked_fingerling_count": ctx.get("stocked_fingerling_count"),
        "stocked_heads_basis": live_heads if use_head else None,
        "movable_bio_asset_total": ctx.get("movable_bio_asset_total"),
        "implied_net_weight_kg": ctx.get("implied_net_weight_kg"),
        "effective_net_weight_kg": ctx.get("effective_net_weight_kg"),
        "current_fish_per_kg": ctx.get("current_fish_per_kg"),
        "current_avg_weight_kg": ctx.get("current_avg_weight_kg"),
        "pond_cost_per_fish": ctx.get("cost_per_fish"),
        "pond_cost_per_kg": ctx.get("cost_per_kg"),
        "stock_density_kg_per_decimal": ctx.get("stock_density_kg_per_decimal"),
        "transfer_cost_per_kg": transfer_cost_per_kg,
        "transfer_cost_per_head": transfer_cost_per_head,
        "transfer_cost_basis_note": basis_note or None,
        "lines": line_out,
    }


def resolve_auto_transfer_line_cost(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    weight_kg: Decimal,
    submitted_cost: Decimal,
    transfer_total_weight_kg: Decimal | None = None,
    fish_count: int | None = None,
    transfer_total_fish_count: int | None = None,
    exclude_transfer_id: int | None = None,
) -> Decimal:
    """Use submitted cost when positive (grow-out kg basis only); nursing always auto-calculates."""
    submitted = _money_q(submitted_cost or Decimal("0"))
    use_head, _ = _transfer_uses_head_cost_basis(
        company_id=company_id,
        from_pond_id=from_pond_id,
        from_cycle=from_cycle,
        fish_count=fish_count,
    )
    if submitted > 0 and not use_head:
        return submitted
    return _production_cost_share_for_line(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
        weight_kg=weight_kg,
        transfer_total_weight_kg=transfer_total_weight_kg,
        fish_count=fish_count,
        transfer_total_fish_count=transfer_total_fish_count,
        exclude_transfer_id=exclude_transfer_id,
    )


def pond_uses_nursing_batch_costing(
    *,
    company_id: int,
    from_pond_id: int,
    from_production_cycle_id: int | None = None,
) -> bool:
    """
    Nursing ponds and fingerling source ponds (large head-count batches) use batch cost spreading:
    total fry + feed + medicine ÷ survivor fingerlings × each line's fish_count.
    """
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    if role == "nursing":
        return True

    from_cycle = None
    if from_production_cycle_id is not None:
        from_cycle = AquacultureProductionCycle.objects.filter(
            pk=from_production_cycle_id, company_id=company_id
        ).first()
    use_head, _ = _transfer_uses_head_cost_basis(
        company_id=company_id,
        from_pond_id=from_pond_id,
        from_cycle=from_cycle,
    )
    if use_head:
        return True

    from django.db.models import Sum

    from api.models import AquacultureFishPondTransferLine

    q = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        transfer__from_pond_id=from_pond_id,
        fish_count__gt=0,
    )
    if from_production_cycle_id is not None:
        q = q.filter(transfer__from_production_cycle_id=from_production_cycle_id)
    total_heads = int(q.aggregate(s=Sum("fish_count"))["s"] or 0)
    return total_heads >= 10000


def _sync_transfer_batch_gl(
    *,
    company_id: int,
    from_pond_id: int,
    from_production_cycle_id: int | None,
) -> None:
    """Repost 1581 journals after nursing batch line costs change."""
    from api.models import AquacultureFishPondTransfer
    from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl

    qs = AquacultureFishPondTransfer.objects.filter(company_id=company_id, from_pond_id=from_pond_id)
    if from_production_cycle_id is not None:
        qs = qs.filter(from_production_cycle_id=from_production_cycle_id)
    else:
        qs = qs.filter(from_production_cycle__isnull=True)
    for tr in qs.order_by("transfer_date", "id"):
        sync_aquaculture_fish_pond_transfer_gl(company_id, tr)


def resync_nursing_pond_transfer_costs(
    *,
    company_id: int,
    from_pond_id: int,
    from_production_cycle_id: int | None,
    after_transfer_date: date | None = None,
    sync_gl: bool = False,
) -> int:
    """
    Recompute line costs on every inter-pond transfer out of this nursing pond/cycle.

    Fry + feed + medicine on the nursing pond are spread across all fingerlings moved out:
    line cost = fish_count × (total batch bio-cost ÷ total fish moved). Uses the latest
    transfer date in the batch for the cost pool so later expenses are included on every line.
    """
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    uses_batch = pond_uses_nursing_batch_costing(
        company_id=company_id,
        from_pond_id=from_pond_id,
        from_production_cycle_id=from_production_cycle_id,
    )

    if uses_batch or role == "nursing":
        from api.models import AquacultureFishPondTransfer

        cycle_ids = AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            from_pond_id=from_pond_id,
        ).values_list("from_production_cycle_id", flat=True).distinct()
        if from_production_cycle_id is not None:
            cycle_ids = [from_production_cycle_id]

        updated = 0
        for cycle_id in cycle_ids:
            updated += _resync_nursing_batch_group(
                company_id=company_id,
                from_pond_id=from_pond_id,
                from_production_cycle_id=cycle_id,
                after_transfer_date=after_transfer_date,
            )
        if sync_gl and updated > 0:
            for cycle_id in cycle_ids:
                _sync_transfer_batch_gl(
                    company_id=company_id,
                    from_pond_id=from_pond_id,
                    from_production_cycle_id=cycle_id,
                )
        return updated

    from api.models import AquacultureFishPondTransfer

    qs = AquacultureFishPondTransfer.objects.filter(
        company_id=company_id,
        from_pond_id=from_pond_id,
    )
    if from_production_cycle_id is not None:
        qs = qs.filter(from_production_cycle_id=from_production_cycle_id)
    else:
        qs = qs.filter(from_production_cycle__isnull=True)
    if after_transfer_date is not None:
        qs = qs.filter(transfer_date__gte=after_transfer_date)
    updated = 0
    for tr in qs.order_by("transfer_date", "id"):
        updated += sync_transfer_line_production_costs(tr)
    return updated


def _resync_nursing_batch_group(
    *,
    company_id: int,
    from_pond_id: int,
    from_production_cycle_id: int | None,
    after_transfer_date: date | None = None,
) -> int:
    """Spread one nursing batch cost pool across all transfer lines by fish count."""
    from api.models import AquacultureFishPondTransfer, AquacultureProductionCycle

    qs = AquacultureFishPondTransfer.objects.filter(
        company_id=company_id,
        from_pond_id=from_pond_id,
    )
    if from_production_cycle_id is not None:
        qs = qs.filter(from_production_cycle_id=from_production_cycle_id)
    else:
        qs = qs.filter(from_production_cycle__isnull=True)
    if after_transfer_date is not None:
        qs = qs.filter(transfer_date__gte=after_transfer_date)

    transfers = list(qs.prefetch_related("lines").order_by("transfer_date", "id"))
    if not transfers:
        return 0

    from_cycle = None
    if from_production_cycle_id is not None:
        from_cycle = AquacultureProductionCycle.objects.filter(
            pk=from_production_cycle_id, company_id=company_id
        ).first()

    max_date = max(t.transfer_date for t in transfers)
    line_refs: list = []
    total_fish = 0
    for tr in transfers:
        for ln in tr.lines.all():
            fc = int(ln.fish_count or 0)
            if fc <= 0:
                continue
            total_fish += fc
            line_refs.append(ln)

    if total_fish <= 0:
        return 0

    bio_total = _nursing_batch_cost_pool(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=max_date,
        from_cycle=from_cycle,
    )
    if bio_total <= 0:
        return 0

    cycle_filter_id = from_production_cycle_id
    denom = _nursing_fingerling_allocation_denominator(
        company_id=company_id,
        from_pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
        transfer_date=max_date,
        fish_count=total_fish,
        transfer_total_fish_count=None,
        exclude_transfer_id=None,
    )
    if denom <= 0:
        denom = total_fish

    updated = 0
    for ln in line_refs:
        fc = int(ln.fish_count or 0)
        new_cost = _money_q(bio_total * Decimal(fc) / Decimal(denom))
        if new_cost <= 0:
            continue
        if _money_q(ln.cost_amount or Decimal("0")) == new_cost:
            continue
        ln.cost_amount = new_cost
        ln.save(update_fields=["cost_amount"])
        updated += 1
    return updated


def sync_transfer_line_production_costs(transfer) -> int:
    """
    Recompute auto production cost on every line (nursing: per stocked fingerling).
    Returns count of lines updated.
    """
    from api.models import AquacultureFishPondTransfer

    if not isinstance(transfer, AquacultureFishPondTransfer):
        return 0
    lines = list(transfer.lines.all())
    total_w = _money_q(sum((ln.weight_kg or Decimal("0")) for ln in lines))
    total_fish = sum(int(ln.fish_count or 0) for ln in lines if int(ln.fish_count or 0) > 0)
    updated = 0
    for ln in lines:
        wk = _money_q(ln.weight_kg or Decimal("0"))
        fc = int(ln.fish_count or 0) or None
        if wk <= 0 and not fc:
            continue
        new_cost = resolve_auto_transfer_line_cost(
            company_id=transfer.company_id,
            from_pond_id=transfer.from_pond_id,
            transfer_date=transfer.transfer_date,
            from_cycle=transfer.from_production_cycle,
            weight_kg=wk,
            submitted_cost=Decimal("0"),
            transfer_total_weight_kg=total_w,
            fish_count=ln.fish_count,
            transfer_total_fish_count=total_fish if total_fish > 0 else None,
            exclude_transfer_id=transfer.id,
        )
        if new_cost <= 0:
            continue
        if _money_q(ln.cost_amount or Decimal("0")) == new_cost:
            continue
        ln.cost_amount = new_cost
        ln.save(update_fields=["cost_amount"])
        updated += 1
    return updated


def backfill_missing_transfer_line_costs(transfer) -> int:
    """Alias: sync all line costs (including fixing nursing double-count)."""
    return sync_transfer_line_production_costs(transfer)


def resync_fingerling_transfers_for_pond(
    *,
    company_id: int,
    pond_id: int,
    production_cycle_id: int | None = None,
    sync_gl: bool = True,
) -> int:
    """
    After fry/feed/medicine is posted on a nursing source pond, re-spread costs across
    all fingerling transfer lines (and repost 1581 GL when sync_gl=True).
    """
    if not pond_uses_nursing_batch_costing(
        company_id=company_id,
        from_pond_id=pond_id,
        from_production_cycle_id=production_cycle_id,
    ):
        return 0
    return resync_nursing_pond_transfer_costs(
        company_id=company_id,
        from_pond_id=pond_id,
        from_production_cycle_id=production_cycle_id,
        sync_gl=sync_gl,
    )
