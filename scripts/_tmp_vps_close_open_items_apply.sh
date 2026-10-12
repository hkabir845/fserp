#!/usr/bin/env bash
# Close open aqua items: fix stale IPT GL on transfers 15/16, then re-audit.
set -euo pipefail
cd ~/fserp/fserp

echo "=== PULL + DEPLOY ==="
git pull
bash scripts/deploy-vps.sh

source backend/venv/bin/activate
export FSERP_USE_SQLITE=0
cd backend

echo "=== FIX transfers 15 / 16 (stale Cr 1581 → current cost_amount) ==="
python manage.py shell <<'PY'
from api.models import AquacultureFishPondTransfer
from api.services.aquaculture_fish_transfer_gl_service import (
    sync_aquaculture_fish_pond_transfer_gl,
    transfer_gl_status,
)

cid = 2
for tid in (15, 16):
    tr = AquacultureFishPondTransfer.objects.get(pk=tid, company_id=cid)
    before = transfer_gl_status(cid, tid)
    print(f"T{tid} BEFORE gl={before.get('gl_total_amount')} posted={before.get('gl_posted')}")
    r = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
    after = transfer_gl_status(cid, tid)
    cost = sum(float(ln.cost_amount or 0) for ln in tr.lines.all())
    print(f"T{tid} sync={r}")
    print(f"T{tid} AFTER  gl={after.get('gl_total_amount')} cost={cost:.2f} capped={r.get('gl_capped')}")
PY

echo "=== AUDIT (json summary) ==="
python manage.py audit_aquaculture_accounting --company-id 2 --json > /tmp/aqua_audit_after.json
python - <<'PY'
import json
d = json.load(open("/tmp/aqua_audit_after.json"))
print(f"issues={d['issue_count']} warnings={d['warning_count']} accepted={d.get('accepted_count',0)} gl_gaps={d['gl_gap_total']}")
print("ISSUES:")
for i in d.get("issues") or []:
    print(" ", i.get("type"), {k: i.get(k) for k in ("transfer_id", "pond_code", "line_total", "gl_amount", "note") if k in i})
print("WARNINGS:")
for w in d.get("warnings") or []:
    print(" ", w.get("type"), w.get("pond_code") or w.get("transfer_id"), (w.get("note") or "")[:80])
print("ACCEPTED:")
for a in d.get("accepted") or []:
    print(" ", a.get("type"), a.get("pond_code") or a.get("transfer_id"), (a.get("note") or "")[:90])
PY
