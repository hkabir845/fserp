#!/usr/bin/env bash
set -euo pipefail
cd ~/fserp/fserp
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_fix_all_remaining.py", run_name="x")
ns["main"]()
PY
pm2 restart fserp_backend --update-env
