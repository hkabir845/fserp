from pathlib import Path
tc = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def pl_window_for_transfer_date")
print(tc[i:i+1100])
print("==== callers that omit company_id ====")
import re
# find pl_window_for_transfer_date( calls
for m in re.finditer(r"pl_window_for_transfer_date\([^)]*\)", tc):
    s=m.group(0)
    if "company_id" not in s and "pond_id" not in s:
        print("NO IDS", s[:120])
# also across services
S = Path(r"I:/ITProjects/FSERP/backend/api/services")
for f in S.glob("*.py"):
    t=f.read_text(encoding="utf-8")
    if "pl_window_for_transfer_date" in t and f.name != "aquaculture_transfer_cost.py":
        for m in re.finditer(r"pl_window_for_transfer_date\([\s\S]{0,200}?\)", t):
            s=re.sub(r"\s+"," ",m.group(0))
            print(f.name, s[:180])
