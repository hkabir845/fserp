#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_digonto_mirka_writeoff.py", run_name="x")
ns["main"]()
PY
