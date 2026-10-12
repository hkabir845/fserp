from pathlib import Path

p = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_fcr_service.py")
text = p.read_text(encoding="utf-8")
start = text.index("def _opening_closing_live_standing(")
end = text.index("def _sample_row_opening_closing(")
new = r'''def _standing_sample_on_day(
    company_id: int,
    pond_id: int,
    day: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> AquacultureBiomassSample | None:
    """Best non-derived standing sample on ``day`` (prefer highest extrapolated kg)."""
    qs = AquacultureBiomassSample.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sample_date=day,
        source_fish_sale__isnull=True,
        source_bill_line__isnull=True,
        source_fish_pond_transfer_line__isnull=True,
    )
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if fish_species:
        qs = qs.filter(fish_species=fish_species)
    best: AquacultureBiomassSample | None = None
    best_kg = Decimal("0")
    for s in qs.order_by("-id"):
        kg = _sample_biomass_kg(s)
        if kg is None or kg <= 0:
            continue
        if kg >= best_kg:
            best_kg = kg
            best = s
    return best


def _opening_closing_live_standing(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    *,
    production_cycle_id: int | None = None,
    fish_species: str | None = None,
) -> tuple[Decimal, Decimal, date, str, bool] | None:
    """
    Opening/closing present weight for the live crop in the period.

    Returns (opening_kg, closing_kg, opening_on, note, opening_from_standing_sample).

    Closing is present as of ``end``. Opening prefers the standing sample
    extrapolated biomass on the first day the live crop is in place (Ashari-2
    11 Aug vertical sample 41,500 kg — not end-of-day heads after the same-day
    harvest). Falls back to the live snapshot when no standing sample exists.

    When opening is from a standing sample, same-day harvest must be included in
    production (``include_after_date`` on harvest).
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
    dates = sample_dates | ledger_dates
    if start != end:
        dates.discard(end)
    opening_kg = Decimal("0")
    opening_on: date | None = None
    opening_from_sample = False
    for day in sorted(dates):
        kg, heads = _live_standing_snapshot(
            company_id,
            pond_id,
            day,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )
        if heads < need_heads or kg <= 0:
            continue
        standing = _standing_sample_on_day(
            company_id,
            pond_id,
            day,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
        )
        sample_kg = _sample_biomass_kg(standing) if standing is not None else None
        if sample_kg is not None and sample_kg > 0:
            opening_kg = _q4(sample_kg)
            opening_from_sample = True
        else:
            opening_kg = kg
            opening_from_sample = False
        opening_on = day
        break
    if opening_on is None or opening_kg <= 0:
        return None
    src = "standing sample" if opening_from_sample else "live present"
    note = (
        f"Live-crop {src} {opening_on.isoformat()} {_q4(opening_kg)} kg "
        f"→ {end.isoformat()} {_q4(close_kg)} kg "
        f"({close_heads} fish)."
    )
    return opening_kg, close_kg, opening_on, note, opening_from_sample


'''
text = text[:start] + new + text[end:]
old_unpack = """    if standing is not None:
        first, last, _opening_on, note = standing
        return first, last, _q4(last - first), note"""
new_unpack = """    if standing is not None:
        first, last, _opening_on, note, _from_sample = standing
        return first, last, _q4(last - first), note"""
if old_unpack not in text:
    raise SystemExit("unpack not found")
text = text.replace(old_unpack, new_unpack, 1)
p.write_text(text, encoding="utf-8")
print("ok")
