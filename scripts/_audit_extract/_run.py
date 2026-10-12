from pathlib import Path
S = Path(r"I:/ITProjects/FSERP/backend/api/services")
O = Path(r"I:/ITProjects/FSERP/scripts/_audit_extract")
bc = (S / "aquaculture_pond_bio_capitalization.py").read_text(encoding="utf-8")
(O / "bio_cap.txt").write_text(bc[:6000], encoding="utf-8")
i = bc.find("SKIP")
(O / "bio_cap_skip.txt").write_text(bc[i : i + 900], encoding="utf-8")
i = bc.find("aquaculture_cost_bucket")
(O / "bio_cap_bucket.txt").write_text(bc[max(0, i - 200) : i + 900], encoding="utf-8")

cpk = (S / "aquaculture_cost_per_kg.py").read_text(encoding="utf-8")
j = cpk.find('values("aquaculture_cost_bucket")')
(O / "cpk_journal_buckets.txt").write_text(cpk[max(0, j - 500) : j + 700], encoding="utf-8")
j = cpk.find("total_cost_per_kg")
(O / "cpk_total.txt").write_text(cpk[max(0, j - 200) : j + 900], encoding="utf-8")

pl = (S / "aquaculture_pl_service.py").read_text(encoding="utf-8")
# find where prior_expense is folded into expense_total / matrix
idxs = []
start = 0
while True:
    k = pl.find("prior_expense", start)
    if k < 0:
        break
    idxs.append(k)
    start = k + 1
chunks = []
for k in idxs:
    chunks.append(pl[k : k + 350])
(O / "pl_prior_expense.txt").write_text("\n====\n".join(chunks), encoding="utf-8")

# nursing double count: when mirrored, is t_out still nonzero for nursing?
i = pl.find("nursing_pond and t_out")
(O / "pl_nursing_rev.txt").write_text(pl[i - 150 : i + 400], encoding="utf-8")

elim = (S / "internal_trade_elimination.py").read_text(encoding="utf-8")
i = elim.find("def _internal_kg_bought")
(O / "elim_bought.txt").write_text(elim[i : i + 1100], encoding="utf-8")

# mortality book value source
views = Path(r"I:/ITProjects/FSERP/backend/api/views/aquaculture_views.py").read_text(encoding="utf-8")
i = views.find("is_write_down")
(O / "mortality_post.txt").write_text(views[i - 400 : i + 900], encoding="utf-8")

print("ok", len(idxs))
