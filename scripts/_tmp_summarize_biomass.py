import json
from pathlib import Path

d = json.loads(Path("scripts/_tmp_pond_biomass_deep_research.json").read_text(encoding="utf-8"))
print("AS_OF", d["as_of"])
print(json.dumps(d["company_totals"], indent=2))
print("\nISSUES")
for i in d["issues"]:
    detail = (i.get("detail") or "")[:300]
    print(f"- [{i['severity']}] {i.get('pond_name')} | {i.get('code')} | {detail}")
print("\nPONDS")
for p in d["ponds"]:
    ps = p["present_stock"]
    print(
        f"{p['pond_name']:22} role={str(p['pond_role']):10} "
        f"heads={ps['book_fish_count']:>8} book_kg={ps['book_weight_kg']:>12} "
        f"eff_kg={ps['effective_biomass_kg']:>12} ok={ps['identity_ok']} "
        f"samp={ps['latest_sample_date']} load={ps['load_level']}"
    )
print("\nPER-POND MOVEMENTS")
for p in d["ponds"]:
    fp = p["fingerling_purchase"]
    ti = p["transfer_in"]
    to = p["transfer_out"]
    h = p["harvest_sales"]
    lg = p["ledger"]
    sm = p["sampling"]
    print(
        f"\n=== {p['pond_name']} (id={p['pond_id']}) ===\n"
        f"  purchase: {fp['fish_count']} pcs / {fp['weight_kg']} kg ({fp['lines']} lines)\n"
        f"  xfer in:  {ti['fish_count']} pcs / {ti['weight_kg']} kg ({ti['lines']} lines)\n"
        f"  xfer out: {to['fish_count']} pcs / {to['weight_kg']} kg ({to['lines']} lines)\n"
        f"  harvest:  {h['fish_count']} pcs / {h['weight_kg']} kg ({h['rows']} sales)\n"
        f"  ledger:   dn={lg['fish_count_delta']} dw={lg['weight_kg_delta']} "
        f"(mort dn={lg['mortality_fish_count_delta']})\n"
        f"  samples:  standing={sm['standing_rows']} lot={sm['lot_rows']} flags={len(sm['flags'])}\n"
        f"  identity: manual_n={p['present_stock']['manual_identity_fish_count']} "
        f"sys_n={p['present_stock']['book_fish_count']} "
        f"manual_w={p['present_stock']['manual_identity_weight_kg']} "
        f"sys_w={p['present_stock']['book_weight_kg']}"
    )
    for b in p["breakdown"]:
        print(
            f"    bucket cy={b['cycle_id']} {b['species']}: "
            f"heads={b['heads']} book={b['book_kg']} eff={b['eff_kg']} "
            f"sale_n={b['sale_n']} sample={b['sample_date']} avg={b['sample_avg_kg']}"
        )
