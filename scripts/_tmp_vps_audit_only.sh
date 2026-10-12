#!/usr/bin/env bash
set -euo pipefail
cd ~/fserp/fserp/backend
source venv/bin/activate
export FSERP_USE_SQLITE=0
python manage.py audit_aquaculture_accounting --company-id 2 --period-end 2026-06-30 --json \
  > /tmp/aqua_audit_after.json 2>/tmp/aqua_audit_after_err.txt || true
python <<'PY'
import json
from pathlib import Path
err = Path("/tmp/aqua_audit_after_err.txt").read_text(errors="replace")
raw = Path("/tmp/aqua_audit_after.json").read_text(errors="replace")
i = raw.find("{")
print("stderr_tail:", err[-500:].replace("\n", " | "))
if i < 0:
    print("NO JSON", raw[:500])
    raise SystemExit(1)
d = json.loads(raw[i:])
print("issue_count", d.get("issue_count"), "warning_count", d.get("warning_count"), "gl_gap_total", d.get("gl_gap_total"))
print("ISSUES:")
for x in d.get("issues") or []:
    print(" ", x)
print("WARNINGS:")
for x in d.get("warnings") or []:
    print(" ", x)
print("HEAD/health:")
PY
curl -s https://api.mahasoftcorporation.com/health/ || true
echo
cd ~/fserp/fserp && git rev-parse --short HEAD
