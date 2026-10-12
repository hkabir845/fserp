from pathlib import Path
import re
S = Path(r"I:/ITProjects/FSERP/backend/api/services")
O = Path(r"I:/ITProjects/FSERP/scripts/_audit_extract")

# journal lines with cost_bucket summed into pond buckets?
cpk = (S / "aquaculture_cost_per_kg.py").read_text(encoding="utf-8")
for m in re.finditer(r"def \w+\([\s\S]{0,120}JournalEntryLine[\s\S]{0,400}", cpk):
    (O / "cpk_je_funcs.txt").write_text(m.group(0)[:800], encoding="utf-8")
    break
# all defs that reference JournalEntryLine
names = re.findall(r"def (\w+)\([^)]*\):[\s\S]{0,80}", cpk)
# find JournalEntryLine usages with context
chunks = []
for m in re.finditer(r".{0,60}JournalEntryLine.{0,200}", cpk):
    chunks.append(m.group(0))
(O / "cpk_je_uses.txt").write_text("\n---\n".join(chunks[:20]), encoding="utf-8")

# sale create vs finalize - views
v = Path(r"I:/ITProjects/FSERP/backend/api/views/aquaculture_views.py").read_text(encoding="utf-8")
# fish sale create endpoint
i = v.find("def aquaculture_fish_sales")
(O / "sale_views.txt").write_text(v[i:i+2500] if i>=0 else "nf", encoding="utf-8")
for pat in ["finalize_aquaculture_fish_sale_to_invoice", "sync_biomass_sample_from_fish_sale", "AquacultureFishSale("]:
    print(pat, v.count(pat))

# Does elimination filter source_fish_pond_transfer?
elim = (S / "internal_trade_elimination.py").read_text(encoding="utf-8")
print("elim excludes transfer-sourced sales?", "source_fish_pond_transfer" in elim)

# float money in transfer cost / bio asset
for f in ["aquaculture_transfer_cost.py", "aquaculture_bio_asset_cost_service.py", "aquaculture_fcr_service.py", "aquaculture_pl_service.py"]:
    t = (S / f).read_text(encoding="utf-8")
    print(f, "float(", t.count("float("), "round(", t.count("round("))

# nursing: when mirrored sale exists, transfer_out skipped - confirm also for grow-out seller income double
pl = (S / "aquaculture_pl_service.py").read_text(encoding="utf-8")
i = pl.find("mirrored")
print(pl[i-100:i+600])
