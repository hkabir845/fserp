from pathlib import Path
ba = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_biological_asset_service.py").read_text(encoding="utf-8")
# find journal / writeoff handling
i = ba.find("biological_writeoff")
print(ba[max(0,i-400):i+500])
print("====")
i = ba.find("JournalEntryLine")
print(ba[i:i+800] if i>=0 else "no JEL")
i = ba.find("aquaculture_cost_bucket")
print("==== bucket ====")
print(ba[i-200:i+600] if i>=0 else "no")
