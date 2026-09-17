#!/usr/bin/env bash
# Apply Mynuddin live biomass fix on VPS (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_mynuddin_live_biomass_fix.py", run_name="x")
import json
print(json.dumps(ns["apply"](), indent=2, default=str))
PY
