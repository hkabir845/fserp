from pathlib import Path
tc = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def _nursing_batch_cost_pool")
print(tc[i:i+2000])
print("==== ALLOCATE ====")
i = tc.find("def _allocate_nursing_batch_line_costs")
print(tc[i:i+1500])
print("==== fry in nursing batch ====")
# show where _nursing_fry_pool is used inside nursing batch
idx = 0
while True:
    j = tc.find("_nursing_fry_pool_for_pond_batch", idx)
    if j < 0: break
    print(tc[j-200:j+300])
    print("---")
    idx = j+1
