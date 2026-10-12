"""Write off Digonto Mirka 2884 @ year close; end C01/C02 cycles.

Idempotent. Apply on local then VPS.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from django.db import transaction

from api.models import AquacultureFishStockLedger, AquacultureProductionCycle
from api.services.aquaculture_data_bank_service import pond_live_data_after_date
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 15  # Digonto
LOCK = date(2026, 2, 20)
MIRKA_CYCLE = 118
C01_CYCLE = 24
MEMO = (
    "CORRECTED 2026-09-17: year-close write-off Mirka/Mrigal (C02) — "
    "2,884 pcs / 240.3333 kg as of Digonto FY close 2026-02-20. "
    "Fish not present; leftover fry bill never harvested before lock."
)


@transaction.atomic
def apply() -> dict:
    out: dict = {}

    # 1) Write off Mirka if still present in lifetime books
    brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    mirka = next(
        (
            r
            for r in brk
            if r.get("production_cycle_id") == MIRKA_CYCLE and r.get("fish_species") == "other"
        ),
        None,
    )
    heads = int((mirka or {}).get("implied_net_fish_count") or 0)
    book_kg = Decimal(str((mirka or {}).get("implied_net_weight_kg") or 0))
    out["mirka_before"] = {"heads": heads, "book_kg": str(book_kg)}

    already = AquacultureFishStockLedger.objects.filter(
        company_id=CID, pond_id=POND, memo__startswith="CORRECTED 2026-09-17: year-close write-off Mirka"
    ).exists()
    if heads > 0 and not already:
        AquacultureFishStockLedger.objects.create(
            company_id=CID,
            pond_id=POND,
            production_cycle_id=MIRKA_CYCLE,
            entry_date=LOCK,
            entry_kind="loss",
            loss_reason="other",
            fish_species="other",
            fish_count_delta=-heads,
            weight_kg_delta=-book_kg if book_kg > 0 else Decimal("-240.3333"),
            book_value=Decimal("0"),
            post_to_books=False,
            memo=MEMO[:5000],
        )
        out["mirka_writeoff"] = "created"
    elif already:
        out["mirka_writeoff"] = "already_done"
    else:
        out["mirka_writeoff"] = "nothing_to_write_off"

    # 2) End C01 / C02 if still open
    for cy_id, code in ((C01_CYCLE, "C01"), (MIRKA_CYCLE, "C02")):
        cy = AquacultureProductionCycle.objects.filter(pk=cy_id, company_id=CID, pond_id=POND).first()
        if not cy:
            out[f"cycle_{code}"] = "missing"
            continue
        changed = []
        if cy.end_date is None or cy.end_date > LOCK:
            cy.end_date = LOCK
            changed.append("end_date")
        if cy.is_active:
            cy.is_active = False
            changed.append("is_active")
        note = f"Ended by Digonto year close correction ({LOCK.isoformat()})."
        if note not in (cy.notes or ""):
            cy.notes = ((cy.notes or "").strip() + ("\n" if (cy.notes or "").strip() else "") + note)[:5000]
            changed.append("notes")
        if changed:
            cy.save(update_fields=changed + (["updated_at"] if hasattr(cy, "updated_at") else []))
            out[f"cycle_{code}"] = f"ended:{','.join(changed)}"
        else:
            out[f"cycle_{code}"] = "already_ended"

    # 3) Verify live vs lifetime
    after = pond_live_data_after_date(CID, POND)
    live = compute_fish_stock_position_rows(CID, pond_id=POND, entries_after_date=after)[0]
    life = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    live_brk = compute_fish_stock_position_breakdown_rows(
        CID, pond_id=POND, entries_after_date=after
    )
    life_brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    out["live_after"] = str(after)
    out["live_heads"] = live["implied_net_fish_count"]
    out["lifetime_heads"] = life["implied_net_fish_count"]
    out["live_buckets"] = [
        {
            "cy": b.get("production_cycle_id"),
            "sp": b.get("fish_species"),
            "heads": b.get("implied_net_fish_count"),
        }
        for b in live_brk
        if int(b.get("implied_net_fish_count") or 0) != 0
    ]
    out["lifetime_mirka"] = next(
        (
            {
                "heads": b.get("implied_net_fish_count"),
                "book_kg": b.get("implied_net_weight_kg"),
            }
            for b in life_brk
            if b.get("production_cycle_id") == MIRKA_CYCLE and b.get("fish_species") == "other"
        ),
        None,
    )
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, default=str))


if __name__ == "__main__":
    main()
