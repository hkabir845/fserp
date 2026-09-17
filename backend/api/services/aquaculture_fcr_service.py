"""
Feed Conversion Ratio (FCR) from recorded feed consumption and biomass change (sampling-based).

FCR = feed kg consumed ÷ biomass gain (kg) in the period, when gain is positive.
Also exposes feed ÷ harvest kg for the same window.

Production biomass gain adjusts sampling net change for harvest, mortality/losses,
manual biomass adjustments, transfers out/in, and fry stocking inflows so FCR is
not biased when those events sit between samples.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
)
from api.services.aquaculture_biomass_book_revaluation_service import is_book_revaluation_ledger_row
from api.services.aquaculture_partial_harvest import (
    effective_biomass_kg_from_position_row,
    position_row_has_fresh_sample,
)
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

# Live crop is "in place" once heads reach this share of period-end heads.
# Ashari-1: 11 Aug 64,878 fish is only ~55% of the 118,464 present now — that
# 7,408 kg sample is mid-stocking, not the August standing crop (13,739 kg book).
_LIVE_CROP_HEAD_FRACTION = Decimal("0.90")
# Use book kg as opening present when it matches sample mass (pre-reval). After
# AUTO-AQ-BIOMASS-REVAL, book can be 4× the sample (91 t vs 20 t) — never use that.
_BOOK_SANE_VS_SAMPLE = Decimal("1.25")
# Book that is far below the sample (Digonto after harvest: 2,409 vs 6,514)
# is leftover fry cost, not standing crop.
_BOOK_FLOOR_VS_SAMPLE = Decimal("0.80")


def _d(val) -> Decimal:
    if val is None or val == "":
        return Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def _q2(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _q4(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _in_reporting_window(field: str, start: date, end: date, after_date: date | None) -> dict:
    """Inclusive [start, end], or (opening, end] when live-crop opening is known.

    Stocking / opening ledger that built the standing crop must not be subtracted
    again from production — those kilos are already in the opening present weight.
    """
    if after_date is not None:
        return {f"{field}__gt": after_date, f"{field}__lte": end}
    return {f"{field}__gte": start, f"{field}__lte": end}


def sum_feed_kg_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> Decimal:
    """Direct pond feed (purchased + consumed) with feed_weight_kg in the inclusive date window."""
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_category__in=["feed_purchase", "feed_consumed"],
        expense_date__gte=start,
        expense_date__lte=end,
        feed_weight_kg__isnull=False,
        feed_weight_kg__gt=0,
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    agg = qs.aggregate(total=Sum("feed_weight_kg"))
    tagged = _q4(_d(agg.get("total")))
    if production_cycle_id is None:
        return tagged
    from api.services.aquaculture_consumption_batch_allocation_service import (
        sum_soft_allocated_feed_kg_for_cycle,
    )

    soft = sum_soft_allocated_feed_kg_for_cycle(
        company_id,
        start,
        end,
        production_cycle_id=production_cycle_id,
        pond_id=pond_id,
    )
    return _q4(tagged + soft)


def _sample_biomass_kg(sample: AquacultureBiomassSample) -> Decimal | None:
    if sample.extrapolated_biomass_kg is not None and sample.extrapolated_biomass_kg > 0:
        return _d(sample.extrapolated_biomass_kg)
    # Combine sample mean × book heads when extrapolation was not stored.
    ref_n = getattr(sample, "stock_reference_fish_count", None)
    try:
        ref_n_i = int(ref_n) if ref_n is not None else 0
    except (TypeError, ValueError):
        ref_n_i = 0
    fc = sample.estimated_fish_count
    etw = sample.estimated_total_weight_kg
    avg = None
    if fc and fc > 0 and etw is not None and etw > 0:
        avg = _d(etw) / Decimal(int(fc))
    elif sample.avg_weight_kg is not None and sample.avg_weight_kg > 0:
        avg = _d(sample.avg_weight_kg)
    if avg is not None and avg > 0 and ref_n_i > 0:
        return _q4(_d(avg) * Decimal(ref_n_i))
    # Legacy rows stored pond biomass in estimated_total_weight_kg with no seine
    # head count and no book-head snapshot. A net sample (heads + kg, no ref heads)
    # must not use seine kg as pond biomass.
    if (fc is None or fc <= 0) and etw is not None and etw > 0:
        return _d(etw)
    return None


def _choose_live_present_kg(effective_kg: Decimal, book_kg: Decimal) -> Decimal:
    """Stock 'present' for a live crop: book when it still matches the sample, else sample."""
    if (
        book_kg > 0
        and effective_kg > 0
        and effective_kg * _BOOK_FLOOR_VS_SAMPLE <= book_kg <= effective_kg * _BOOK_SANE_VS_SAMPLE
    ):
        return _q4(book_kg)
    if effective_kg > 0:
        return _q4(effective_kg)
    if book_kg > 0:
        return _q4(book_kg)
    return Decimal("0")


def _live_standing_snapshot(
    company_id: int,
    pond_id: int,
    as_of: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, int]:
    """
    Pond present kg and live heads as of ``as_of``.

    Only buckets with fish still in the pond. Closed cycles with 0 heads and
    large negative book kg (Ashari-1 C01/C02) must not enter the total.
    """
    from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

    rows = compute_fish_stock_position_breakdown_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        fish_species_filter=fish_species,
        as_of_date=as_of,
    )
    heads = 0
    book = Decimal("0")
    effective = Decimal("0")
    for row in rows:
        try:
            n = int(row.get("implied_net_fish_count") or 0)
        except (TypeError, ValueError):
            n = 0
        if n <= 0:
            continue
        # Leftover species with only a months-old sample (Digonto Mirka, Feb)
        # must not enter pond present / gain.
        if not position_row_has_fresh_sample(row, as_of):
            continue
        heads += n
        b = _d(row.get("implied_net_weight_kg"))
        if b > 0:
            book += b
        e = effective_biomass_kg_from_position_row(row)
        if e > 0:
            effective += e
    return _choose_live_present_kg(effective, book), heads


def _opening_closing_live_standing(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, Decimal, date, str] | None:
    """
    Opening/closing present weight for the live crop in the period.

    Closing is present as of ``end``. Opening is present on the first day in the
    period when live heads have reached the closing crop (stocking finished).
    Candidate days include sample dates and real stock-ledger dates (not
    AUTO-AQ-BIOMASS-REVAL). Period-end is closing only, not an opening candidate.

    Live Ashari-1 (Aug 2026 → 12 Sep): opening book 13,738.76 kg on 16 Aug
    (118,464 fish), closing sample 20,263.62 kg → gain 6,524.86 kg. Using the
    first sample row (11 Aug, 7,408 kg, 64,878 fish) overstated gain by the
    mid-month stocking.
    """
    close_kg, close_heads = _live_standing_snapshot(
        company_id,
        pond_id,
        end,
        production_cycle_id=production_cycle_id,
        fish_species=fish_species,
    )
    if close_kg <= 0 or close_heads <= 0:
        return None
    need_heads = int((Decimal(close_heads) * _LIVE_CROP_HEAD_FRACTION).to_integral_value(rounding=ROUND_HALF_UP))
    # Do not seed the walk with period-start: Digonto already had heads on 1 Aug
    # (book 4,691 kg) but the crop was first measured 19 Aug (8,555 kg).
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sample_date__gte=start,
        sample_date__lte=end,
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        qs = qs.filter(fish_species=fish_species)
    sample_dates: set[date] = set()
    for s in qs.only("sample_date", "source_fish_sale_id", "source_bill_line_id"):
        if getattr(s, "source_fish_sale_id", None) or getattr(s, "source_bill_line_id", None):
            continue
        sample_dates.add(s.sample_date)
    ledger_qs = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        entry_date__gte=start,
        entry_date__lte=end,
    )
    if production_cycle_id is not None:
        ledger_qs = ledger_qs.filter(production_cycle_id=production_cycle_id)
    ledger_dates: set[date] = set()
    for row in ledger_qs.only("entry_date", "memo"):
        if is_book_revaluation_ledger_row(row):
            continue
        ledger_dates.add(row.entry_date)
    # Period-end is the closing snapshot. Using it as opening makes gain 0
    # when mid-stocking samples never reach the 90% head threshold.
    dates = sample_dates | ledger_dates
    if start != end:
        dates.discard(end)
    opening_kg = Decimal("0")
    opening_on: date | None = None
    for day in sorted(dates):
        kg, heads = _live_standing_snapshot(
            company_id,
            pond_id,
            day,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )
        if heads >= need_heads and kg > 0:
            opening_kg = kg
            opening_on = day
            break
    if opening_on is None or opening_kg <= 0:
        return None
    note = (
        f"Live-crop present {opening_on.isoformat()} {_q4(opening_kg)} kg "
        f"→ {end.isoformat()} {_q4(close_kg)} kg "
        f"({close_heads} fish)."
    )
    return opening_kg, close_kg, opening_on, note


def _sample_row_opening_closing(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, Decimal, Decimal, str]:
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sample_date__gte=start,
        sample_date__lte=end,
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        qs = qs.filter(fish_species=fish_species)
    usable: list[tuple[date, Decimal]] = []
    for s in qs.order_by("sample_date", "id"):
        if getattr(s, "source_fish_sale_id", None):
            continue
        bio = _sample_biomass_kg(s)
        if bio is not None and bio > 0:
            usable.append((s.sample_date, bio))
    if len(usable) < 2:
        note = "Need at least two biomass samples in the period with positive estimated biomass."
        return Decimal("0"), Decimal("0"), Decimal("0"), note
    first = usable[0][1]
    last = usable[-1][1]
    gain = last - first
    if gain <= 0:
        return first, last, Decimal("0"), "Biomass did not increase between first and last sample in period."
    return first, last, _q4(gain), "Last sample biomass − first sample biomass (extrapolated or estimated total)."


def biomass_gain_from_samples_for_pond(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, Decimal, Decimal, str]:
    """
    Returns (opening_kg, closing_kg, inventory_gain_kg, basis_note).

    Prefers live-crop standing present (same idea as the stock 'present weight'
    card) so mid-period stocking is not counted as growth. Falls back to first
    and last sample rows when the pond has no live heads.
    """
    standing = _opening_closing_live_standing(
        company_id,
        pond_id,
        start,
        end,
        production_cycle_id=production_cycle_id,
        fish_species=fish_species,
    )
    if standing is not None:
        first, last, _opening_on, note = standing
        return first, last, _q4(last - first), note
    return _sample_row_opening_closing(
        company_id,
        pond_id,
        start,
        end,
        production_cycle_id=production_cycle_id,
        fish_species=fish_species,
    )


def sum_harvest_kg_for_period(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    after_date: date | None = None,
) -> Decimal:
    qs = AquacultureFishSale.objects.filter(
        company_id=company_id,
        **_in_reporting_window("sale_date", start, end, after_date),
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    total = Decimal("0")
    for s in qs.only("weight_kg", "income_type"):
        if income_type_is_non_biological_for_company(company_id, getattr(s, "income_type", None) or ""):
            continue
        if getattr(s, "income_type", None) == "fish_harvest_sale":
            total += _d(s.weight_kg)
    return _q4(total)


def _sum_stock_ledger_adjustments_kg(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    after_date: date | None = None,
) -> tuple[Decimal, Decimal]:
    """
    Returns (outflow_kg, inflow_kg) from fish stock ledger.

    Losses and negative adjustments are outflows (grown biomass that left).
    Positive adjustments are inflows (biomass that did not come from feed).

    AUTO-AQ-BIOMASS-REVAL rows are book kg rewrites so the ledger matches the
    latest sample. They are not fish arriving or leaving — counting them as
    inflow (Ashari-1 live: +82,041 kg on 2026-09-12) turns a ~6 t sample-to-sample
    gain into −69,165 kg.
    """
    qs = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        **_in_reporting_window("entry_date", start, end, after_date),
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    outflow = Decimal("0")
    inflow = Decimal("0")
    for row in qs.only("entry_kind", "weight_kg_delta", "memo"):
        if is_book_revaluation_ledger_row(row):
            continue
        dw = _d(row.weight_kg_delta)
        kind = (row.entry_kind or "").strip()
        if kind == "loss":
            outflow += abs(dw)
        elif dw < 0:
            outflow += abs(dw)
        elif dw > 0:
            inflow += dw
    return _q4(outflow), _q4(inflow)


def _sum_transfer_kg(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    after_date: date | None = None,
) -> tuple[Decimal, Decimal]:
    """Returns (transfer_out_kg, transfer_in_kg) for the pond/cycle scope."""
    window = _in_reporting_window("transfer__transfer_date", start, end, after_date)
    out_qs = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        **window,
    )
    in_qs = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        **window,
    )
    if pond_id is not None:
        out_qs = out_qs.filter(transfer__from_pond_id=pond_id)
        in_qs = in_qs.filter(to_pond_id=pond_id)
    if production_cycle_id is not None:
        out_qs = out_qs.filter(transfer__from_production_cycle_id=production_cycle_id)
        in_qs = in_qs.filter(to_production_cycle_id=production_cycle_id)
    out_agg = out_qs.aggregate(total=Sum("weight_kg"))
    in_agg = in_qs.aggregate(total=Sum("weight_kg"))
    return _q4(_d(out_agg.get("total"))), _q4(_d(in_agg.get("total")))


def _sum_stocking_in_kg(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    after_date: date | None = None,
) -> Decimal:
    """Fry/stocking expenses that carry feed_weight_kg as stocked biomass."""
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        expense_category__in=["fry_stocking", "stocking", "fingerling_stocking"],
        **_in_reporting_window("expense_date", start, end, after_date),
        feed_weight_kg__isnull=False,
        feed_weight_kg__gt=0,
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    agg = qs.aggregate(total=Sum("feed_weight_kg"))
    return _q4(_d(agg.get("total")))


def compute_fcr_for_scope(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> dict:
    """FCR metrics for one pond (or company-wide when pond_id is None)."""
    feed_kg = sum_feed_kg_for_period(
        company_id, start, end, pond_id=pond_id, production_cycle_id=production_cycle_id
    )

    first_bio = Decimal("0")
    last_bio = Decimal("0")
    gain_kg = Decimal("0")
    gain_note = ""
    events_after: date | None = None
    if pond_id is not None:
        standing = _opening_closing_live_standing(
            company_id,
            pond_id,
            start,
            end,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )
        if standing is not None:
            first_bio, last_bio, events_after, gain_note = standing
            gain_kg = _q4(last_bio - first_bio)
        else:
            first_bio, last_bio, gain_kg, gain_note = _sample_row_opening_closing(
                company_id,
                pond_id,
                start,
                end,
                production_cycle_id=production_cycle_id,
                fish_species=fish_species,
            )
            if first_bio != 0 or last_bio != 0:
                gain_kg = _q4(last_bio - first_bio)
    else:
        ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")
        gains: list[Decimal] = []
        for p in ponds:
            first, last, _, _ = biomass_gain_from_samples_for_pond(
                company_id, p.id, start, end, production_cycle_id=production_cycle_id, fish_species=fish_species
            )
            if first != 0 or last != 0:
                gains.append(last - first)
        if gains:
            gain_kg = _q4(sum(gains, Decimal("0")))
            gain_note = f"Sum of per-pond live-crop present-weight changes ({len(gains)} pond(s))."

    harvest_kg = sum_harvest_kg_for_period(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        after_date=events_after,
    )
    ledger_out_kg, ledger_in_kg = _sum_stock_ledger_adjustments_kg(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        after_date=events_after,
    )
    transfer_out_kg, transfer_in_kg = _sum_transfer_kg(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        after_date=events_after,
    )
    stocking_in_kg = _sum_stocking_in_kg(
        company_id,
        start,
        end,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        after_date=events_after,
    )

    # Inventory change is what the farm compares: present weight − August standing.
    # FCR still adds harvest / deaths / transfers so feed is judged against production.
    net_sample_change_kg = gain_kg
    event_add_kg = _q4(harvest_kg + ledger_out_kg + transfer_out_kg)
    event_sub_kg = _q4(ledger_in_kg + transfer_in_kg + stocking_in_kg)
    production_gain_kg = _q4(net_sample_change_kg + event_add_kg - event_sub_kg)

    fcr_biomass: str | None = None
    if production_gain_kg > 0 and feed_kg > 0:
        fcr_biomass = str(_q2(feed_kg / production_gain_kg))

    fcr_harvest: str | None = None
    if harvest_kg > 0 and feed_kg > 0:
        fcr_harvest = str(_q2(feed_kg / harvest_kg))

    note_bits = [gain_note] if gain_note else []
    if event_add_kg > 0 or event_sub_kg > 0:
        note_bits.append(
            "Adjusted for harvest "
            f"{_q4(harvest_kg)} kg, mortality/loss/neg-adj {_q4(ledger_out_kg)} kg, "
            f"transfer-out {_q4(transfer_out_kg)} kg, transfer-in {_q4(transfer_in_kg)} kg, "
            f"manual gain-adj {_q4(ledger_in_kg)} kg, stocking {_q4(stocking_in_kg)} kg."
        )

    return {
        "feed_kg": str(feed_kg),
        "harvest_kg": str(harvest_kg),
        "mortality_loss_kg": str(ledger_out_kg),
        "manual_biomass_in_kg": str(ledger_in_kg),
        "transfer_out_kg": str(transfer_out_kg),
        "transfer_in_kg": str(transfer_in_kg),
        "stocking_in_kg": str(stocking_in_kg),
        "biomass_first_kg": str(_q4(first_bio)) if pond_id else None,
        "biomass_last_kg": str(_q4(last_bio)) if pond_id else None,
        "biomass_net_change_kg": str(net_sample_change_kg),
        "biomass_gain_kg": str(net_sample_change_kg),
        "biomass_production_kg": str(production_gain_kg),
        "biomass_gain_note": " ".join(note_bits).strip(),
        "fcr_biomass": fcr_biomass,
        "fcr_harvest": fcr_harvest,
        "fcr_biomass_label": (
            "Feed kg ÷ production biomass gain "
            "(sampling ± harvest/mortality/transfers/stocking/adjustments)"
            if fcr_biomass
            else None
        ),
        "fcr_harvest_label": "Feed kg ÷ harvest sale kg" if fcr_harvest else None,
    }


def fcr_period_summary_block(
    company_id: int,
    start: date,
    end: date,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> dict:
    """Standard FCR block attached to date-range aquaculture reports."""
    portfolio = compute_fcr_for_scope(
        company_id, start, end, pond_id=None, production_cycle_id=production_cycle_id
    )
    scoped = None
    if pond_id is not None:
        scoped = compute_fcr_for_scope(
            company_id, start, end, pond_id=pond_id, production_cycle_id=production_cycle_id
        )
    per_pond: list[dict] = []
    if pond_id is None:
        ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")
        for p in ponds:
            row = compute_fcr_for_scope(
                company_id, start, end, pond_id=p.id, production_cycle_id=production_cycle_id
            )
            if (
                _d(row.get("feed_kg")) <= 0
                and _d(row.get("biomass_gain_kg")) <= 0
                and _d(row.get("harvest_kg")) <= 0
                and _d(row.get("mortality_loss_kg")) <= 0
                and _d(row.get("transfer_out_kg")) <= 0
                and _d(row.get("transfer_in_kg")) <= 0
                and _d(row.get("stocking_in_kg")) <= 0
            ):
                continue
            per_pond.append(
                {
                    "pond_id": p.id,
                    "pond_name": (p.name or "").strip(),
                    **row,
                }
            )
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "portfolio": portfolio,
        "scoped": scoped,
        "per_pond": per_pond,
        "methodology": (
            "Biomass gain on the card is live-crop present weight at period end minus "
            "present when that crop finished stocking (book kg if it still matches the "
            "sample; otherwise sample × heads). Mid-stocking samples and "
            "AUTO-AQ-BIOMASS-REVAL book rewrites are not growth. "
            "FCR (biomass) = feed kg ÷ production, where production = that inventory "
            "change + harvest + mortality/losses + transfer-out − transfer-in − stocking "
            "− real manual inbound. FCR (harvest) = same feed kg ÷ harvest sale kg."
        ),
    }
