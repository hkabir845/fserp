"""Deep-dive anomalies from biomass research."""
from __future__ import annotations

from collections import Counter
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    BillLine,
)
from api.services.aquaculture_partial_harvest import sample_mean_weight_kg_from_fields
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

CID = 2


def main() -> None:
    print("=== DIGONTO ===")
    rows = compute_fish_stock_position_breakdown_rows(CID, pond_id=15)
    for r in rows:
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        if n or w:
            print(
                f"  cy={r.get('production_cycle_id')} {r.get('fish_species')}: "
                f"n={n} book={w} stocked_n={r.get('stocked_fish_count')} "
                f"sale_n={r.get('sale_fish_count')} sale_w={r.get('sale_weight_kg')} "
                f"tin_w={r.get('transfer_in_weight_kg')} bill_w={r.get('vendor_bill_in_weight_kg')} "
                f"led={r.get('ledger_weight_kg_delta')} mort_n={r.get('mortality_fish_count')} "
                f"samp={r.get('latest_sample_date')} avg={r.get('latest_sample_avg_weight_kg')}"
            )

    qs = AquacultureFishSale.objects.filter(company_id=CID, pond_id=15, production_cycle_id__isnull=True)
    print(
        "Digonto sales null cycle:",
        qs.count(),
        "n=",
        sum(int(s.fish_count or 0) for s in qs),
        "kg=",
        sum((Decimal(str(s.weight_kg or 0)) for s in qs), Decimal(0)),
    )
    c: Counter = Counter()
    for s in AquacultureFishSale.objects.filter(company_id=CID, pond_id=15):
        c[s.production_cycle_id] += int(s.fish_count or 0)
    print("sale heads by cycle", dict(c))

    # Closed vs open cycles Digonto
    from api.models import AquacultureProductionCycle

    for cy in AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=15).order_by("id"):
        print(f"  cycle {cy.id} {cy.code!r} {cy.name!r} active={cy.is_active} start={cy.start_date}")

    print("\n=== ASHARI-3 NURSING weight bridge ===")
    for bl in BillLine.objects.filter(
        bill__company_id=CID, aquaculture_pond_id=17, aquaculture_fish_count__gt=0
    ).select_related("bill", "item"):
        print(
            " bill",
            bl.bill.bill_date,
            bl.item.name,
            bl.aquaculture_fish_count,
            bl.aquaculture_fish_weight_kg,
            "cy",
            bl.aquaculture_production_cycle_id,
        )
    for tr in AquacultureFishPondTransfer.objects.filter(company_id=CID, from_pond_id=17).prefetch_related(
        "lines"
    ):
        for ln in tr.lines.all():
            print(
                " xfer",
                tr.transfer_date,
                "to",
                ln.to_pond_id,
                ln.fish_count,
                ln.weight_kg,
                "from_cy",
                tr.from_production_cycle_id,
            )
    for r in AquacultureFishStockLedger.objects.filter(company_id=CID, pond_id=17).order_by(
        "entry_date", "id"
    ):
        print(
            " led",
            r.entry_date,
            r.entry_kind,
            r.fish_count_delta,
            r.weight_kg_delta,
            (r.memo or "")[:100],
            "cy",
            r.production_cycle_id,
        )

    # Weight identity for nursing: purchase 100 + led + xfer
    bill_w = sum(
        (
            Decimal(str(bl.aquaculture_fish_weight_kg or 0))
            for bl in BillLine.objects.filter(
                bill__company_id=CID,
                aquaculture_pond_id=17,
                aquaculture_fish_count__gt=0,
                bill__stock_receipt_applied=True,
                item__pos_category__iexact="fish",
            )
        ),
        Decimal(0),
    )
    xfer_w = Decimal(0)
    xfer_n = 0
    for tr in AquacultureFishPondTransfer.objects.filter(company_id=CID, from_pond_id=17).prefetch_related(
        "lines"
    ):
        for ln in tr.lines.all():
            xfer_w += Decimal(str(ln.weight_kg or 0))
            xfer_n += int(ln.fish_count or 0)
    led_w = sum(
        (Decimal(str(r.weight_kg_delta or 0)) for r in AquacultureFishStockLedger.objects.filter(pond_id=17)),
        Decimal(0),
    )
    led_n = sum(int(r.fish_count_delta or 0) for r in AquacultureFishStockLedger.objects.filter(pond_id=17))
    print(f"bridge: bill_w={bill_w} - xfer_w={xfer_w} + led_w={led_w} = {bill_w - xfer_w + led_w}")
    print(f"heads: purchase then -xfer +led")

    print("\n=== SAMPLE 323 Mynuddin ===")
    s = AquacultureBiomassSample.objects.get(pk=323)
    print(
        s.pond_id,
        s.sample_date,
        s.fish_species,
        s.estimated_fish_count,
        s.estimated_total_weight_kg,
        s.avg_weight_kg,
        getattr(s, "notes", None),
        getattr(s, "memo", None),
    )
    print(
        "mean",
        sample_mean_weight_kg_from_fields(
            fish_count=s.estimated_fish_count,
            total_weight_kg=s.estimated_total_weight_kg,
            avg_weight_kg=s.avg_weight_kg,
        ),
    )
    for x in AquacultureBiomassSample.objects.filter(pond_id=s.pond_id, sample_date=s.sample_date).order_by(
        "id"
    ):
        print(" ", x.id, x.fish_species, x.estimated_fish_count, x.estimated_total_weight_kg, x.avg_weight_kg)

    # Company conservation identity
    print("\n=== COMPANY CONSERVATION ===")
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
    from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

    pos = compute_fish_stock_position_rows(CID)
    purchase_n = 0
    for bl in BillLine.objects.filter(
        bill__company_id=CID,
        bill__stock_receipt_applied=True,
        aquaculture_pond_id__isnull=False,
        aquaculture_fish_count__gt=0,
        item__pos_category__iexact="fish",
    ):
        purchase_n += int(bl.aquaculture_fish_count or 0)
    sale_n = 0
    for s in AquacultureFishSale.objects.filter(company_id=CID):
        if income_type_is_non_biological_for_company(CID, s.income_type or ""):
            continue
        sale_n += int(s.fish_count or 0)
    led_n = sum(int(r.fish_count_delta or 0) for r in AquacultureFishStockLedger.objects.filter(company_id=CID))
    net = purchase_n - sale_n + led_n  # transfers cancel
    book = sum(int(r["implied_net_fish_count"] or 0) for r in pos)
    print(f"purchase {purchase_n} - sale {sale_n} + ledger {led_n} = {net}")
    print(f"sum pond book heads {book} match={net==book}")

    # Digonto C24 tilapia negative heads
    print("\n=== DIGONTO C24 tilapia why negative heads ===")
    r24 = next(
        (
            r
            for r in rows
            if r.get("production_cycle_id") == 24 and r.get("fish_species") == "tilapia"
        ),
        None,
    )
    if r24:
        for k in sorted(r24.keys()):
            if any(x in k for x in ("count", "weight", "sample", "stocked", "mort", "sale", "transfer", "vendor", "implied")):
                print(f"  {k}={r24[k]}")

    # Cycle 128 Digonto current
    r128 = next(
        (
            r
            for r in rows
            if r.get("production_cycle_id") == 128 and r.get("fish_species") == "tilapia"
        ),
        None,
    )
    print("\n=== DIGONTO C128 current tilapia ===")
    if r128:
        for k in sorted(r128.keys()):
            if any(x in k for x in ("count", "weight", "sample", "stocked", "mort", "sale", "transfer", "vendor", "implied")):
                print(f"  {k}={r128[k]}")


if __name__ == "__main__":
    main()
