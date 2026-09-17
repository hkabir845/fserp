#!/usr/bin/env bash
# Bridge Mynuddin C02 tilapia negative book on VPS (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy, json
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_mynuddin_c02_book_bridge.py", run_name="x")
print(json.dumps(ns["apply"](), indent=2, default=str))
PY
