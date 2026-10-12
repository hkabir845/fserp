"""Undo bad reval resync; restore prior AUTO tilapia revals from pre-sync math."""
from __future__ import annotations

from decimal import Decimal
from datetime import date

from django.db import transaction

from api.models import AquacultureFishStockLedger, AquaculturePond
from api.services.aquaculture_biomass_book_revaluation_service import REVAL_MEMO_PREFIX
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

CID = 2

# Known Digonto row from investigation before resync
RESTORE = [
    # pond_id, cycle_id, sample_id, target_kg, delta, entry_date
    {
        "pond_id": 15,
        "cycle_id": 128,
        "sample_id": 355,
        "target_kg": Decimal("8008.9920"),
        "delta": Decimal("39138.7220"),
        "entry_date": date(2026, 8, 19),
    },
]


def main() -> None:
    print("Current AUTO revals:")
    for r in AquacultureFishStockLedger.objects.filter(
        company_id=CID, memo__startswith=REVAL_MEMO_PREFIX
    ).order_by("id"):
        print(f"  id={r.id} pond={r.pond_id} sp={r.fish_species} cy={r.production_cycle_id} dw={r.weight_kg_delta} memo={r.memo[:100]}")

    with transaction.atomic():
        # Delete ALL auto revals created/replaced in the bad sync (ids 82+)
        deleted, _ = AquacultureFishStockLedger.objects.filter(
            company_id=CID, memo__startswith=REVAL_MEMO_PREFIX, id__gte=82
        ).delete()
        print(f"Deleted new AUTO rows: {deleted}")

        # After deleting Digonto's replacement, restore the known prior Digonto reval.
        for spec in RESTORE:
            memo = (
                f"{REVAL_MEMO_PREFIX}:pond={spec['pond_id']}:sample={spec['sample_id']}:"
                f"target_kg={spec['target_kg']}"
            )
            AquacultureFishStockLedger.objects.filter(
                company_id=CID,
                pond_id=spec["pond_id"],
                fish_species="tilapia",
                memo__startswith=REVAL_MEMO_PREFIX,
            ).delete()
            row = AquacultureFishStockLedger.objects.create(
                company_id=CID,
                pond_id=spec["pond_id"],
                production_cycle_id=spec["cycle_id"],
                entry_date=spec["entry_date"],
                entry_kind="adjustment",
                loss_reason="",
                fish_species="tilapia",
                fish_count_delta=0,
                weight_kg_delta=spec["delta"],
                book_value=Decimal("0"),
                post_to_books=False,
                memo=memo[:5000],
            )
            print(f"Restored Digonto reval id={row.id} dw={row.weight_kg_delta}")

        # Reconstruct Mynuddin / Ashari-1 / Ashari-2 prior tilapia AUTO deltas so pond
        # book returns to the verified post-correction, pre-resync snapshot.
        # Snapshot after mortality/sample fixes, before reval sync:
        #   Mynuddin 35779.9450, Ashari-1 23303.5264, Ashari-2 32828.4338, Digonto 5079.3453
        targets = {
            2: Decimal("35779.9450"),
            13: Decimal("23303.5264"),
            14: Decimal("32828.4338"),
            15: Decimal("5079.3453"),
        }
        for pond_id, target_book in targets.items():
            r = compute_fish_stock_position_rows(CID, pond_id=pond_id)[0]
            cur = Decimal(str(r["implied_net_weight_kg"]))
            need = (target_book - cur).quantize(Decimal("0.0001"))
            print(f"pond {pond_id}: cur_book={cur} target={target_book} need_delta={need}")
            if pond_id == 15:
                # Digonto already restored via known row; verify
                continue
            if abs(need) < Decimal("0.01"):
                continue
            # Remove any leftover tilapia AUTO on this pond then add bridging reval
            AquacultureFishStockLedger.objects.filter(
                company_id=CID,
                pond_id=pond_id,
                fish_species="tilapia",
                memo__startswith=REVAL_MEMO_PREFIX,
            ).delete()
            # Recompute need after delete
            r2 = compute_fish_stock_position_rows(CID, pond_id=pond_id)[0]
            cur2 = Decimal(str(r2["implied_net_weight_kg"]))
            need2 = (target_book - cur2).quantize(Decimal("0.0001"))
            latest_sample_id = 0
            memo = f"{REVAL_MEMO_PREFIX}:pond={pond_id}:sample={latest_sample_id}:target_kg={target_book}|RESTORED_2026-09-17_pre_resync_book"
            # Use active tilapia cycle if any
            from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

            brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=pond_id)
            cy = None
            for b in brk:
                if b.get("fish_species") == "tilapia" and int(b.get("implied_net_fish_count") or 0) > 0:
                    cy = b.get("production_cycle_id")
            AquacultureFishStockLedger.objects.create(
                company_id=CID,
                pond_id=pond_id,
                production_cycle_id=cy,
                entry_date=date(2026, 9, 17),
                entry_kind="adjustment",
                loss_reason="",
                fish_species="tilapia",
                fish_count_delta=0,
                weight_kg_delta=need2,
                book_value=Decimal("0"),
                post_to_books=False,
                memo=memo[:5000],
            )
            print(f"  bridged pond {pond_id} delta={need2} cy={cy}")

    print("\n=== RESTORED STATE ===")
    for p in AquaculturePond.objects.filter(company_id=CID, is_active=True).order_by("sort_order", "id"):
        r = compute_fish_stock_position_rows(CID, pond_id=p.id)[0]
        eff = effective_biomass_kg_from_position_row(r)
        print(
            f"{p.name:22} heads={r['implied_net_fish_count']:>8} "
            f"book={r['implied_net_weight_kg']:>12} eff={eff}"
        )


if __name__ == "__main__":
    main()
