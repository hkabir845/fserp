"""Apply all biomass corrections after VPS restore (idempotent)."""
from __future__ import annotations

import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from api.models import AquacultureBiomassSample, AquacultureFishStockLedger
from api.services.aquaculture_biomass_book_revaluation_service import REVAL_MEMO_PREFIX
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

CID = 2


def _q4(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@transaction.atomic
def apply_all() -> dict:
    results: dict = {}

    # 1) Sample 323
    s = AquacultureBiomassSample.objects.select_for_update().get(pk=323)
    if Decimal(str(s.estimated_total_weight_kg or 0)) >= Decimal("100"):
        s.estimated_total_weight_kg = Decimal("16.5000")
        mean = (Decimal("16.5") / Decimal("20")).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        s.avg_weight_kg = mean
        ref_n = int(s.stock_reference_fish_count or 0)
        ref_avg = s.stock_reference_avg_weight_kg
        if ref_n > 0:
            s.extrapolated_biomass_kg = _q4(mean * Decimal(ref_n))
            if ref_avg is not None:
                s.biomass_gain_kg = _q4((mean - Decimal(str(ref_avg))) * Decimal(ref_n))
        note = "CORRECTED 2026-09-17: seine kg 165→16.5 (10× typo); avg 8.25→0.825."
        if note not in (s.notes or ""):
            s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + note)[:5000]
        s.save(
            update_fields=[
                "estimated_total_weight_kg",
                "avg_weight_kg",
                "extrapolated_biomass_kg",
                "biomass_gain_kg",
                "notes",
                "updated_at",
            ]
        )
        results["sample_323"] = "corrected"
    else:
        results["sample_323"] = "already_ok"

    # 2) Digonto mortality #8
    led = AquacultureFishStockLedger.objects.select_for_update().get(pk=8)
    if int(led.fish_count_delta or 0) == -9399:
        rate = Decimal("11748.7500") / Decimal("9399")
        led.fish_count_delta = -4477
        led.weight_kg_delta = _q4(rate * Decimal(4477) * Decimal("-1"))
        note = (
            "CORRECTED 2026-09-17: mortality heads -9399→-4477 "
            "(overstated vs remaining; sale#111=349). Weight at 1.25 kg/fish."
        )
        if note not in (led.memo or ""):
            led.memo = ((led.memo or "").strip() + (" | " if (led.memo or "").strip() else "") + note)[:5000]
        led.save(update_fields=["fish_count_delta", "weight_kg_delta", "memo", "updated_at"])
        results["ledger_8"] = "corrected"
    else:
        results["ledger_8"] = "already_ok"

    # 3) Ashari-3 residual
    pos17 = compute_fish_stock_position_rows(CID, pond_id=17)[0]
    residual17 = Decimal(str(pos17["implied_net_weight_kg"]))
    marker17 = "CORRECTED 2026-09-17: zero empty-pond book kg residual"
    if int(pos17["implied_net_fish_count"] or 0) == 0 and residual17 != 0:
        if not AquacultureFishStockLedger.objects.filter(
            company_id=CID, pond_id=17, memo__startswith=marker17
        ).exists():
            AquacultureFishStockLedger.objects.create(
                company_id=CID,
                pond_id=17,
                production_cycle_id=79,
                entry_date=date(2025, 12, 6),
                entry_kind="adjustment",
                loss_reason="",
                fish_species="tilapia",
                fish_count_delta=0,
                weight_kg_delta=_q4(-residual17),
                book_value=Decimal("0"),
                post_to_books=False,
                memo=f"{marker17} ({residual17} → 0).",
            )
            results["ashari3"] = "corrected"
        else:
            results["ashari3"] = "already_ok"
    else:
        results["ashari3"] = "already_ok"

    # 4) Digonto Nursing rounding
    pos19 = compute_fish_stock_position_rows(CID, pond_id=19)[0]
    residual19 = Decimal(str(pos19["implied_net_weight_kg"]))
    marker19 = "CORRECTED 2026-09-17: zero empty-pond book kg rounding"
    if int(pos19["implied_net_fish_count"] or 0) == 0 and Decimal("0") < abs(residual19) < Decimal("1"):
        if not AquacultureFishStockLedger.objects.filter(
            company_id=CID, pond_id=19, memo__startswith=marker19
        ).exists():
            AquacultureFishStockLedger.objects.create(
                company_id=CID,
                pond_id=19,
                production_cycle_id=121,
                entry_date=date(2026, 7, 22),
                entry_kind="adjustment",
                loss_reason="",
                fish_species="tilapia",
                fish_count_delta=0,
                weight_kg_delta=_q4(-residual19),
                book_value=Decimal("0"),
                post_to_books=False,
                memo=f"{marker19} ({residual19} → 0).",
            )
            results["digonto_nursing"] = "corrected"
        else:
            results["digonto_nursing"] = "already_ok"
    else:
        results["digonto_nursing"] = "already_ok"

    # 5) Ashari-2 bad AUTO revals (sample 394 1.6 kg applied farm-wide)
    pos14 = compute_fish_stock_position_rows(CID, pond_id=14)[0]
    book14 = Decimal(str(pos14["implied_net_weight_kg"]))
    marker14 = "CORRECTED 2026-09-17: replace bad AUTO revals"
    if book14 > Decimal("100000") or AquacultureFishStockLedger.objects.filter(
        company_id=CID, pond_id=14, memo__startswith=REVAL_MEMO_PREFIX, weight_kg_delta__gt=100000
    ).exists():
        AquacultureFishStockLedger.objects.filter(
            company_id=CID, pond_id=14, memo__startswith=REVAL_MEMO_PREFIX
        ).delete()
        AquacultureFishStockLedger.objects.filter(
            company_id=CID, pond_id=14, memo__startswith=marker14
        ).delete()
        r2 = compute_fish_stock_position_rows(CID, pond_id=14)[0]
        book2 = Decimal(str(r2["implied_net_weight_kg"]))
        eff2 = effective_biomass_kg_from_position_row(r2)
        delta = _q4(eff2 - book2)
        latest = (
            AquacultureBiomassSample.objects.filter(company_id=CID, pond_id=14, fish_species="tilapia")
            .order_by("-sample_date", "-id")
            .first()
        )
        AquacultureFishStockLedger.objects.create(
            company_id=CID,
            pond_id=14,
            production_cycle_id=125,
            entry_date=latest.sample_date if latest else date.today(),
            entry_kind="adjustment",
            loss_reason="",
            fish_species="tilapia",
            fish_count_delta=0,
            weight_kg_delta=delta,
            book_value=Decimal("0"),
            post_to_books=False,
            memo=f"{marker14} (sample 394 1.6kg farm-wide). Bridge book→effective {eff2} kg.",
        )
        results["ashari2_reval"] = {"status": "corrected", "bridge_kg": str(delta), "eff_kg": str(eff2)}
    else:
        results["ashari2_reval"] = "already_ok"

    return results


def main() -> None:
    print(json.dumps(apply_all(), indent=2, default=str))
    print("--- AFTER ---")
    total_h = 0
    total_e = Decimal("0")
    for r in compute_fish_stock_position_rows(CID):
        e = effective_biomass_kg_from_position_row(r)
        total_h += int(r["implied_net_fish_count"] or 0)
        total_e += e
        print(
            f"{r['pond_name']:24} heads={r['implied_net_fish_count']:>8} "
            f"book={r['implied_net_weight_kg']:>14} eff={e}"
        )
    print(f"{'TOTAL':24} heads={total_h:>8} eff={total_e}")


if __name__ == "__main__":
    main()
