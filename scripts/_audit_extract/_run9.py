from pathlib import Path
fcr = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_fcr_service.py").read_text(encoding="utf-8")
i = fcr.find("def sum_feed_kg_for_period")
print(fcr[i:i+900])
print("====")
# how feed_purchase vs feed_consumed are used in expenses
# shop issues create feed_purchase; warehouse creates feed_consumed?
pes = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_pl_expense_sum.py").read_text(encoding="utf-8")
print("rollup", [l for l in pes.splitlines() if "feed" in l.lower()][:20])
