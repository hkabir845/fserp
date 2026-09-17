#!/usr/bin/env bash
# Apply Ashari-2 paper sampling sync on VPS (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_ashari2_paper_sampling_fix.py", run_name="x")
print(ns["apply"]())
PY
