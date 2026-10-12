#!/usr/bin/env bash
set -euo pipefail
cd ~/fserp/fserp

echo "=== PULL + DEPLOY ==="
git pull
bash scripts/deploy-vps.sh

cd backend
source venv/bin/activate
export FSERP_USE_SQLITE=0

echo "=== APPLY P06 ==="
python manage.py reconcile_nursing_pond_pl_balance \
  --company-id 2 --pond-code P06 \
  --period-start 2025-07-01 --period-end 2026-06-30 2>&1 | tee /tmp/reconcile_p06_apply.txt | tail -40

echo "=== APPLY P08 ==="
python manage.py reconcile_nursing_pond_pl_balance \
  --company-id 2 --pond-code P08 \
  --period-start 2025-07-01 --period-end 2026-06-30 2>&1 | tee /tmp/reconcile_p08_apply.txt | tail -40

echo "=== POST SNAPSHOT ==="
python manage.py shell <<'PY'
from datetime import date
from api.models import AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
start, end = date(2025,7,1), date(2026,6,30)
pl = compute_aquaculture_pl_summary_dict(2, start, end, None, None, None, False)
by = {p["pond_id"]: p for p in pl["ponds"]}
for code in ("P05","P06","P07","P08"):
    pond = AquaculturePond.objects.get(company_id=2, code=code)
    r = by[pond.id]
    print(f"{code}: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']}")
PY

echo "=== POST AUDIT ==="
python manage.py audit_aquaculture_accounting --company-id 2 --period-end 2026-06-30 --json \
  > /tmp/aqua_audit_after.json 2>/tmp/aqua_audit_after_err.txt || true
python - <<'PY'
import json
from pathlib import Path
raw = Path("/tmp/aqua_audit_after.json").read_text(errors="replace")
i = raw.find("{")
d = json.loads(raw[i:])
print("issue_count", d.get("issue_count"), "warning_count", d.get("warning_count"), "gl_gap_total", d.get("gl_gap_total"))
print("ISSUES:")
for x in d.get("issues") or []:
    print(" ", x)
print("NURSING warnings:")
for x in d.get("warnings") or []:
    if x.get("type") == "nursing_pl_gap":
        print(" ", x)
PY

echo "=== GIT AFTER ==="
cd ~/fserp/fserp
git rev-parse --short HEAD
git log -1 --oneline
echo "=== DONE ==="
