from pathlib import Path
tc = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_transfer_cost.py").read_text(encoding="utf-8")
# who calls transfer_cost_pools_for_scope and _nursing_fry_pool
import re
for name in ["transfer_cost_pools_for_scope", "_nursing_fry_pool_for_pond_batch", "split_transfer_line_cost"]:
    print(name, "defs/uses in file", tc.count(name))
# search repo
root = Path(r"I:/ITProjects/FSERP/backend")
for name in ["transfer_cost_pools_for_scope", "_nursing_fry_pool_for_pond_batch", "split_transfer_line_cost_amount"]:
    for p in root.rglob("*.py"):
        t = p.read_text(encoding="utf-8", errors="ignore")
        if name in t and p.name != "aquaculture_transfer_cost.py":
            print(name, "->", p.relative_to(root))
# nursing transfer total cost function
i = tc.find("def nursing_transfer")
print(tc[i:i+200] if i>=0 else "no nursing_transfer")
for m in re.finditer(r"def \w*nursing\w*cost\w*\(", tc):
    print(m.group(0), "at", m.start())
i = tc.find("def compute_nursing")
print("====")
# find where fry pool affects total
i = tc.find("fry = max(fry_cycle, fry_pond)")
# who uses return of transfer_cost_pools
print("After pools function, next uses of fry pool in apply cost:")
i = tc.find("def apply_")
# search allocate or line cost
for m in re.finditer(r"transfer_cost_pools_for_scope\(|split_transfer_line_cost_amount\(|_nursing_fry_pool", tc):
    print(m.start(), m.group(0))
