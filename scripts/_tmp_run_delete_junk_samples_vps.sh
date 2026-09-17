#!/usr/bin/env bash
# Delete leftover historical junk biomass samples on VPS (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy, json
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_delete_historical_junk_samples.py", run_name="x")
print(json.dumps(ns["apply"](), indent=2, default=str))
PY
