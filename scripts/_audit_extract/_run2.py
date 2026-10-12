from pathlib import Path
S = Path(r"I:/ITProjects/FSERP/backend/api/services")
elim = (S / "internal_trade_elimination.py").read_text(encoding="utf-8")
# full bought function
i = elim.find("def _internal_kg_bought")
j = elim.find("\ndef ", i + 1)
print(elim[i:j])
print("==== FRY POOL ====")
tc = (S / "aquaculture_transfer_cost.py").read_text(encoding="utf-8")
i = tc.find("def _nursing_fry_pool_for_pond_batch")
print(tc[i : i + 900])
print("==== capitalized exclude ====")
i = tc.find("capitalized_ids")
print(tc[i - 80 : i + 200])
# Does expense register / journals pull AUTO-AQ-SALE bio?
for f in ["aquaculture_expense_register.py", "aquaculture_cost_per_kg.py", "aquaculture_pl_expense_sum.py"]:
    t = (S / f).read_text(encoding="utf-8")
    if "AUTO-AQ-SALE" in t or "biological_writeoff" in t and "JournalEntry" in t:
        print(f, "mentions sale bio or JE writeoff")
# opening gl posts to P&L accounts?
ogl = (S / "aquaculture_pond_pl_opening_gl.py").read_text(encoding="utf-8")
i = ogl.find("for row in rows")
print("==== OPENING GL LOOP ====")
print(ogl[i : i + 1200])
