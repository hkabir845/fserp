"""Auto cost for inter-pond fish transfers from source-pond production P&L."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from api.models import AquaculturePond, AquacultureProductionCycle
from api.services.aquaculture_pl_service import _money_q, compute_aquaculture_pl_summary_dict
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

# Costs that stay on the source pond when fish leave (not moved with fingerlings/fish).
_BIO_ASSET_EXCLUDED_FROM_TRANSFER = frozenset({"lease", "shop_supplies"})

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
        live_c = _nursing_stocked_heads_basis(
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


def _nursing_stocked_heads_basis(
    *,
    company_id: int,
    pond_id: int,
    cycle_filter_id: int | None,
) -> int:
    """Fingerlings stocked on nursing pond (vendor fish bills), for per-head transfer costing."""
    pos_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_filter_id,
    )
    if not pos_rows:
        return 0
    row = pos_rows[0]
    bill_heads = int(row.get("vendor_bill_in_fish_count") or 0)
    if bill_heads > 0:
        return bill_heads
    implied = int(row.get("implied_net_fish_count") or 0)
    return implied if implied > 0 else 0


def _production_cost_share_for_line(
    *,
    company_id: int,
    from_pond_id: int,
    transfer_date: date,
    from_cycle: AquacultureProductionCycle | None,
    weight_kg: Decimal,
    transfer_total_weight_kg: Decimal | None,
    fish_count: int | None = None,
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
        share = _bio_asset_transfer_share(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=cycle_obj,
            weight_kg=weight_kg,
            fish_count=fish_count,
            prefer_heads=True,
        )
        if share > 0:
            return share
        # Fallback: P&L production buckets ÷ stocked fingerlings (legacy data).
        cycle_filter_id = cycle_obj.id if cycle_obj is not None else None
        start, end = pl_window_for_transfer_date(transfer_date, cycle_obj)
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
        heads = int(fish_count or 0)
        if heads <= 0:
            return Decimal("0")
        stocked_heads = _nursing_stocked_heads_basis(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
        )
        if stocked_heads <= 0:
            return Decimal("0")
        return _money_q(bio_total * Decimal(heads) / Decimal(stocked_heads))

    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    use_head_basis = (
        fish_count
        and int(fish_count) > 0
        and stocked_heads > 0
        and (role == "nursing" or stocked_heads >= 10000)
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
    """Whether inter-pond transfer cost uses stocked-fingerling head share (nursing-style)."""
    cycle_filter_id = from_cycle.id if from_cycle is not None else None
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=from_pond_id,
        cycle_filter_id=cycle_filter_id,
    )
    heads = int(fish_count or 0)
    if heads <= 0 or stocked_heads <= 0:
        return False, stocked_heads
    pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).only("pond_role").first()
    role = (pond.pond_role or "").strip().lower() if pond else ""
    use_head = role == "nursing" or stocked_heads >= 10000
    return use_head, stocked_heads


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

    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=from_pond_id,
        as_of_date=transfer_date,
        production_cycle=from_cycle,
    )
    bio_total = _transferable_bio_asset_total(summary)
    if bio_total <= 0:
        bio_total = _bio_total_for_transfer_scope(
            company_id=company_id,
            from_pond_id=from_pond_id,
            transfer_date=transfer_date,
            from_cycle=from_cycle,
        )
    if bio_total <= 0:
        return None, "No fry/feed/medicine/preparation costs recorded for this pond in the selected period."
    live_heads = int(summary.get("live_fish_count") or 0)
    if live_heads <= 0:
        live_heads = _nursing_stocked_heads_basis(
            company_id=company_id,
            pond_id=from_pond_id,
            cycle_filter_id=cycle_filter_id,
        )
    if live_heads <= 0:
        return None, "No live fingerling count for per-head transfer cost."
    per_head = _money_q(bio_total / Decimal(live_heads))
    note = (
        f"Transfer cost/head = movable biological asset ({bio_total}) ÷ {live_heads} live fingerlings "
        "(fry vendor bills Dr 1581, feed, medicine, labour on pond; lease stays on source pond). "
        "Shop supplies are not moved with fish."
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
    use_head, stocked_heads = _transfer_uses_head_cost_basis(
        company_id=company_id,
        from_pond_id=from_pond_id,
        from_cycle=from_cycle,
        fish_count=sample_heads,
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
        )
        line_out.append({"cost_amount": str(cost) if cost > 0 else None})

    return {
        "cost_basis": "per_head" if use_head else "per_kg",
        "stocked_heads_basis": stocked_heads if use_head else None,
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
) -> Decimal:
    """Use submitted cost when positive; otherwise this line's share of pond production costs."""
    submitted = _money_q(submitted_cost or Decimal("0"))
    if submitted > 0:
        return submitted
    return _production_cost_share_for_line(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
        weight_kg=weight_kg,
        transfer_total_weight_kg=transfer_total_weight_kg,
        fish_count=fish_count,
    )


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
