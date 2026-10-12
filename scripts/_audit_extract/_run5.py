from pathlib import Path
tc = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def pl_window_for_transfer_date")
print(tc[i:i+900])
print("====")
# suggest_bio_asset_relief float path
ba = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_bio_asset_cost_service.py").read_text(encoding="utf-8")
i = ba.find("def suggest_bio_asset_relief")
print(ba[i:i+600])
print("====")
# build_pond_cost_per_kg denom assignment
cpk = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_cost_per_kg.py").read_text(encoding="utf-8")
i = cpk.find("def build_pond_cost_per_kg_block")
print(cpk[i:i+500])
print("---denom---")
print(cpk[i+500:i+900])
# FCR company scope: events_after None includes all harvest from start - but gain is inventory-only sum
# That's OK if harvest is added. Verified earlier.

# One more: does P&L count transfer-mirrored Fingerling sale income AND nursing t_out?
# mirrored => t_out not added. Fingerling sale in AquacultureFishSale counts as income. Good.

# Bill/expense double count in pl_expense_sum
pes = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_pl_expense_sum.py").read_text(encoding="utf-8")
print(pes[:2000])
