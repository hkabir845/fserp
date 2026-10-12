from pathlib import Path
import re
root = Path(r"I:/ITProjects/FSERP/backend/api")
for p in root.rglob("*.py"):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if "cost_bucket" in t and ("Sum(" in t or "annotate" in t) and ("JournalEntryLine" in t or "journal_entry_line" in t.lower() or "JournalEntry" in t):
        if "aquaculture_cost_bucket" in t or "cost_bucket" in t:
            # tighter
            if re.search(r"JournalEntryLine.*cost_bucket|cost_bucket.*Sum|values\([^\)]*cost_bucket", t, re.S):
                print(p.relative_to(root))
