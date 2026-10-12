#!/usr/bin/env bash
set -euo pipefail
cd ~/fserp/fserp
echo "=== GIT ==="
git rev-parse --short HEAD
git log -1 --oneline
git status -sb | head -5
cd backend
source venv/bin/activate
export FSERP_USE_SQLITE=0

echo "=== NURSING SNAPSHOT FY ==="
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

echo "=== P06 reconcile dry-run ==="
python manage.py reconcile_nursing_pond_pl_balance \
  --company-id 2 --pond-code P06 \
  --period-start 2025-07-01 --period-end 2026-06-30 --dry-run 2>&1 | tail -25

echo "=== AUDIT ==="
python manage.py audit_aquaculture_accounting --company-id 2 --period-end 2026-06-30 --json \
  > /tmp/aqua_audit_now.json 2>/tmp/aqua_audit_err.txt || true
python - <<'PY'
import json
from pathlib import Path
err = Path("/tmp/aqua_audit_err.txt").read_text(errors="replace")
raw = Path("/tmp/aqua_audit_now.json").read_text(errors="replace")
i = raw.find("{")
if i < 0:
    print("AUDIT FAILED")
    print(err[-2500:])
    raise SystemExit(1)
d = json.loads(raw[i:])
print("issue_count", d.get("issue_count"), "warning_count", d.get("warning_count"), "gl_gap_total", d.get("gl_gap_total"))
print("ISSUES:")
for x in d.get("issues") or []:
    print(" ", x)
print("WARNINGS:")
for x in d.get("warnings") or []:
    print(" ", x)
print("POND nets:")
for p in d.get("pond_pl") or []:
    print(f"  {p.get('pond_name')}: net={p.get('net')} role={p.get('role')}")
PY

echo "=== IPT double BIO ==="
python manage.py repair_aquaculture_ipt_double_bio --company-id 2 --dry-run 2>&1 | tail -15

echo "=== P06 line costs ==="
python manage.py shell <<'PY'
from api.models import AquacultureFishPondTransferLine, AquaculturePond
pond = AquaculturePond.objects.get(company_id=2, code="P06")
for ln in AquacultureFishPondTransferLine.objects.filter(
    transfer__company_id=2, transfer__from_pond=pond,
    transfer__transfer_date__gte="2025-07-01", transfer__transfer_date__lte="2026-06-30",
).select_related("transfer", "to_pond").order_by("id"):
    print(
        f"line {ln.id} xfer#{ln.transfer_id} -> {ln.to_pond.code} "
        f"cost={ln.cost_amount} sale={ln.sale_amount} fish={ln.fish_count}"
    )
PY
echo "=== DONE ==="
