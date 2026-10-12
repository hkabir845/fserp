from pathlib import Path
S = Path(r"I:/ITProjects/FSERP/backend/api/services")
# harvest cost_bucket biological_writeoff consumers that sum JE
for f in sorted(S.glob("*.py")):
    t = f.read_text(encoding="utf-8")
    if "biological_writeoff" in t and ("JournalEntryLine" in t or "journal_entry" in t):
        print("HIT", f.name)
        for line in t.splitlines():
            if "biological_writeoff" in line:
                print(" ", line.strip()[:120])

# Does build_pond_cost_per_kg put harvest COGS journals into biological_writeoff via buckets?
# pond_bucket_amounts gets writeoff from stock ledger only in PL - confirmed

# Check suggest_bio uses float weight
ba = (S/"aquaculture_bio_asset_cost_service.py").read_text(encoding="utf-8")
print("suggest signature has float", "float" in ba)

# Inter-pond sale revenue account - confirm 4245
itp = (S/"aquaculture_internal_trade_posting.py").read_text(encoding="utf-8")
for line in itp.splitlines():
    if "4245" in line or "5245" in line or "INTERNAL" in line:
        print("ITP", line.strip()[:130])

# pl_window still falls back to Jan 1?
tc = (S/"aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def pl_window_for_transfer_date")
print(tc[i:i+700])
