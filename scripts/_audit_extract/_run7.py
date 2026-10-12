from pathlib import Path
import re
# convert transfers to documents - creates sale + keeps transfer?
root = Path(r"I:/ITProjects/FSERP/backend")
hits = []
for p in root.rglob("*.py"):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if "convert_fish_transfers" in t or "materialize_fish_transfer" in t or "ensure_fish_sale_for_transfer" in t:
        if "def " in t:
            for m in re.finditer(r"def (convert_fish_transfers\w*|materialize_fish_transfer\w*|ensure_fish_sale_for_transfer\w*)", t):
                hits.append(f"{p.relative_to(root)}:{m.group(1)}")
print("defs", hits)
# internal trade posting creates invoice for transfer
itp = (root/"api/services/aquaculture_internal_trade_posting.py").read_text(encoding="utf-8")
print("source_fish_pond_transfer in itp", "source_fish_pond_transfer" in itp)
print("FishSale" in itp, "invoice" in itp.lower())
# sale create - is stock affected before invoice?
# model signal?
for p in (root/"api").rglob("*.py"):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if "post_save" in t and "FishSale" in t:
        print("signal", p)
# views create sale
v = (root/"api/views/aquaculture_views.py").read_text(encoding="utf-8")
i = v.find("AquacultureFishSale(")
print(v[i-200:i+800])
