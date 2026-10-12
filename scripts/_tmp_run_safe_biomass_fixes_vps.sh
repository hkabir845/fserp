#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/vps-export-live-db.sh
cd backend
export FSERP_USE_SQLITE=0
./venv/bin/python manage.py shell <<'PY'
import runpy
ns = runpy.run_path("/home/sas/fserp/fserp/scripts/_tmp_safe_biomass_fixes.py", run_name="x")
print(ns["apply"]())
from api.models import AquacultureBiomassSample
s = AquacultureBiomassSample.objects.filter(pk=68, production_cycle_id__isnull=True).first()
if s:
    s.production_cycle_id = 22
    note = "CORRECTED 2026-09-17: backfilled production_cycle=22 (Ashari-2 C22)."
    s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + note)[:5000]
    s.save(update_fields=["production_cycle", "notes", "updated_at"])
    print("tagged68")
else:
    print("68 already ok or missing")
PY
