#!/usr/bin/env bash
# Report which database FSERP uses and whether it likely contains tenant data.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"

# shellcheck disable=SC1091
source venv/bin/activate

python manage.py shell <<'PY'
from django.conf import settings
from api.models import Company

db = settings.DATABASES["default"]
engine = db.get("ENGINE", "")
name = db.get("NAME", "")

print("=== FSERP database ===")
print(f"ENGINE: {engine}")
print(f"NAME:   {name}")

try:
    total = Company.objects.count()
    print(f"Companies: {total}")
    for c in Company.objects.order_by("id")[:15]:
        print(f"  - id={c.id} code={getattr(c, 'code', '?')} name={c.name}")
except Exception as exc:
    print(f"ERROR querying companies: {exc}")
    raise SystemExit(1)

if total == 0:
    print("")
    print("WARNING: No companies — database is empty or wrong.")
    print("Fix backend/.env DATABASE_URL to your PostgreSQL DB with old data,")
    print("or FSERP_USE_SQLITE=1 if data is in backend/db.sqlite3.")
elif total == 1 and getattr(Company.objects.first(), "is_master", False):
    print("")
    print("WARNING: Only the demo Master tenant exists — likely wrong/empty database.")
PY
