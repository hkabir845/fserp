"""Investigate Digonto C24 oversell and sample 323 correction options."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureProductionCycle,
)

CID = 2
POND = 15


def main() -> None:
    c24 = AquacultureProductionCycle.objects.get(pk=24)
    c128 = AquacultureProductionCycle.objects.get(pk=128)
    print(f"C24 start={c24.start_date} active={c24.is_active}")
    print(f"C128 start={c128.start_date} active={c128.is_active}")

    print("\n--- C24 tilapia sales by month ---")
    by_m: dict[str, list] = defaultdict(lambda: [0, Decimal(0)])
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id=24, fish_species="tilapia"
    ).order_by("sale_date"):
        key = s.sale_date.strftime("%Y-%m")
        by_m[key][0] += int(s.fish_count or 0)
        by_m[key][1] += Decimal(str(s.weight_kg or 0))
    for k in sorted(by_m):
        print(f"  {k}: n={by_m[k][0]} kg={by_m[k][1]}")

    print("\n--- C24 tilapia sales AFTER C128 start ---")
    after = AquacultureFishSale.objects.filter(
        company_id=CID,
        pond_id=POND,
        production_cycle_id=24,
        fish_species="tilapia",
        sale_date__gte=c128.start_date,
    ).order_by("sale_date")
    tot_n = tot_w = 0
    for s in after:
        n = int(s.fish_count or 0)
        w = Decimal(str(s.weight_kg or 0))
        tot_n += n
        tot_w += w
        print(f"  {s.sale_date} id={s.id} n={n} kg={w} type={s.income_type}")
    print(f"  TOTAL after C128: n={tot_n} kg={tot_w}")

    print("\n--- C128 tilapia sales ---")
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id=128, fish_species="tilapia"
    ).order_by("sale_date"):
        print(f"  {s.sale_date} id={s.id} n={s.fish_count} kg={s.weight_kg}")

    print("\n--- C24 mortality ledger ---")
    for r in AquacultureFishStockLedger.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id=24, fish_species="tilapia"
    ).order_by("entry_date"):
        print(
            f"  {r.entry_date} id={r.id} kind={r.entry_kind} "
            f"dn={r.fish_count_delta} dw={r.weight_kg_delta} "
            f"reason={getattr(r,'loss_reason',None)} memo={(r.memo or '')[:80]}"
        )

    print("\n--- Digonto transfer-ins ---")
    for ln in AquacultureFishPondTransferLine.objects.filter(
        to_pond_id=POND, transfer__company_id=CID
    ).select_related("transfer", "transfer__from_pond"):
        tr = ln.transfer
        print(
            f"  {tr.transfer_date} from={tr.from_pond.name} sp={tr.fish_species} "
            f"n={ln.fish_count} kg={ln.weight_kg} to_cy={ln.to_production_cycle_id} "
            f"from_cy={tr.from_production_cycle_id} xfer={tr.id}"
        )

    # Running head balance C24 tilapia chronologically
    print("\n--- C24 tilapia running heads ---")
    events = []
    for ln in AquacultureFishPondTransferLine.objects.filter(
        to_pond_id=POND, to_production_cycle_id=24, transfer__fish_species="tilapia"
    ).select_related("transfer"):
        events.append((ln.transfer.transfer_date, "tin", int(ln.fish_count or 0), f"xfer#{ln.transfer_id}"))
    for s in AquacultureFishSale.objects.filter(
        pond_id=POND, production_cycle_id=24, fish_species="tilapia"
    ):
        events.append((s.sale_date, "sale", -int(s.fish_count or 0), f"sale#{s.id}"))
    for r in AquacultureFishStockLedger.objects.filter(
        pond_id=POND, production_cycle_id=24, fish_species="tilapia"
    ):
        events.append((r.entry_date, r.entry_kind or "led", int(r.fish_count_delta or 0), f"led#{r.id}"))
    events.sort(key=lambda x: (x[0], x[1]))
    bal = 0
    min_bal = 0
    first_neg = None
    for d, kind, dn, ref in events:
        bal += dn
        if bal < min_bal:
            min_bal = bal
        if bal < 0 and first_neg is None:
            first_neg = (d, kind, dn, ref, bal)
        if kind != "sale" or bal < 5000:
            print(f"  {d} {kind:6} {dn:+8} -> {bal:8}  {ref}")
    print(f"final={bal} min={min_bal} first_neg={first_neg}")

    # Sample 323 - is it used as latest for any bucket?
    print("\n--- Sample 323 usage ---")
    s323 = AquacultureBiomassSample.objects.get(pk=323)
    later = AquacultureBiomassSample.objects.filter(
        pond_id=2, fish_species="tilapia", sample_date__gte=s323.sample_date
    ).exclude(pk=323)
    print(f"tilapia samples on/after {s323.sample_date}: {later.count()}")
    # Does any bucket use sample from 2026-08-12 with avg 8.25?
    from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

    for r in compute_fish_stock_position_breakdown_rows(CID, pond_id=2):
        avg = r.get("latest_sample_avg_weight_kg")
        if avg and Decimal(str(avg)) > 5:
            print("BUCKET USING LARGE AVG", r.get("production_cycle_id"), r.get("fish_species"), avg, r.get("latest_sample_date"))

    # Ashari-3: residual weight only — heads OK. Digonto Nursing residual.
    print("\n--- Digonto Nursing residual ---")
    from api.models import BillLine, AquacultureFishPondTransfer

    bill_n = bill_w = 0
    for bl in BillLine.objects.filter(aquaculture_pond_id=19, aquaculture_fish_count__gt=0):
        bill_n += int(bl.aquaculture_fish_count or 0)
        bill_w += Decimal(str(bl.aquaculture_fish_weight_kg or 0))
        print(" bill", bl.bill_id, bl.aquaculture_fish_count, bl.aquaculture_fish_weight_kg)
    for tr in AquacultureFishPondTransfer.objects.filter(from_pond_id=19).prefetch_related("lines"):
        for ln in tr.lines.all():
            print(" xfer", tr.id, ln.fish_count, ln.weight_kg)
    for r in AquacultureFishStockLedger.objects.filter(pond_id=19):
        print(" led", r.id, r.entry_date, r.fish_count_delta, r.weight_kg_delta, (r.memo or "")[:60])


if __name__ == "__main__":
    main()
