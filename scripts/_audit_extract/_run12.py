from pathlib import Path
# views usage of transfer_cost_pools
v = Path(r"I:/ITProjects/FSERP/backend/api/views/aquaculture_views.py").read_text(encoding="utf-8")
i = v.find("transfer_cost_pools_for_scope")
print(v[i-300:i+800])
print("====")
r = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_fingerling_transfer_report.py").read_text(encoding="utf-8")
i = r.find("transfer_cost_pools_for_scope")
print(r[i-200:i+600])
# resync nursing uses what for cost
tc = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def resync_nursing_pond_transfer_costs")
print("==== RESYNC ====")
print(tc[i:i+1200])
