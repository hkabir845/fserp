#!/usr/bin/env bash
# Safely switch FSERP from SQLite (backend/db.sqlite3) to PostgreSQL.
#
# Prerequisites:
#   1. PostgreSQL running; database + user created.
#   2. DATABASE_URL set in backend/.env (real credentials, not the template placeholder).
#
# Usage:
#   nano backend/.env   # set DATABASE_URL=postgres://user:pass@127.0.0.1:5432/fserp
#   bash scripts/migrate-sqlite-to-postgres.sh
#   bash scripts/migrate-sqlite-to-postgres.sh --yes   # skip confirmation prompt
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
ENV_FILE="${BACKEND}/.env"
SQLITE_FILE="${BACKEND}/db.sqlite3"
EXPORT_FILE="${BACKEND}/sqlite_export.json"
BACKUP_FILE="${BACKEND}/db.sqlite3.pre-postgres-$(date +%Y%m%d%H%M%S)"

AUTO_YES=0
if [[ "${1:-}" == "--yes" ]]; then
  AUTO_YES=1
fi

get_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

remove_sqlite_flag() {
  if grep -q '^FSERP_USE_SQLITE=' "$ENV_FILE"; then
    sed -i.bak '/^FSERP_USE_SQLITE=/d' "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    echo "Removed FSERP_USE_SQLITE from $ENV_FILE"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE — copy backend/env.production.example first." >&2
  exit 1
fi

db_url="$(get_var DATABASE_URL)"
if [[ -z "$db_url" || "$db_url" == postgres://USER:PASSWORD@127.0.0.1:5432/fserp ]]; then
  echo "ERROR: Set a real DATABASE_URL in $ENV_FILE before migrating." >&2
  exit 1
fi

if [[ ! -f "$SQLITE_FILE" ]]; then
  echo "No $SQLITE_FILE — nothing to migrate. Set DATABASE_URL and run: pm2 restart fserp_backend --update-env"
  remove_sqlite_flag
  exit 0
fi

sqlite_bytes=$(stat -c%s "$SQLITE_FILE" 2>/dev/null || echo 0)
if [[ "$sqlite_bytes" -lt 1024 ]]; then
  echo "SQLite file is tiny (${sqlite_bytes} bytes) — likely empty. Skipping data export."
  remove_sqlite_flag
  exit 0
fi

cd "$BACKEND"
# shellcheck disable=SC1091
source venv/bin/activate

echo "==> Testing PostgreSQL connection (DATABASE_URL)"
python manage.py migrate --noinput

pg_companies="$(python manage.py shell -c "from api.models import Company; print(Company.objects.count())")"
echo "PostgreSQL companies before import: $pg_companies"

if [[ "$pg_companies" -gt 1 ]] && [[ "$AUTO_YES" -ne 1 ]]; then
  echo "WARNING: PostgreSQL already has $pg_companies companies."
  echo "Import may duplicate data. Use --yes only if you intend to merge/overwrite."
  read -r -p "Continue anyway? [y/N] " ans
  if [[ "${ans,,}" != "y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Backing up SQLite -> $BACKUP_FILE"
cp -a "$SQLITE_FILE" "$BACKUP_FILE"

echo "==> Exporting data from SQLite"
FSERP_USE_SQLITE=1 python manage.py dumpdata \
  --natural-foreign --natural-primary \
  -e contenttypes -e auth.Permission -e sessions -e admin.LogEntry \
  --indent 2 -o "$EXPORT_FILE"

export_lines=$(wc -l < "$EXPORT_FILE" | tr -d ' ')
echo "Export written: $EXPORT_FILE ($export_lines lines)"

if [[ "$export_lines" -lt 5 ]]; then
  echo "ERROR: Export looks empty. SQLite backup kept at $BACKUP_FILE" >&2
  exit 1
fi

echo "==> Importing into PostgreSQL"
remove_sqlite_flag
python manage.py migrate --noinput
python manage.py loaddata "$EXPORT_FILE"

pg_companies_after="$(python manage.py shell -c "from api.models import Company; print(Company.objects.count())")"
echo "PostgreSQL companies after import: $pg_companies_after"

if [[ "$pg_companies_after" -lt 1 ]]; then
  echo "ERROR: Import may have failed — no companies in PostgreSQL." >&2
  echo "Restore SQLite backup: cp $BACKUP_FILE $SQLITE_FILE" >&2
  exit 1
fi

echo "==> Renaming old SQLite (kept as backup)"
mv "$SQLITE_FILE" "${SQLITE_FILE}.migrated-$(date +%Y%m%d%H%M%S)"

echo ""
echo "Migration complete."
echo "  - PostgreSQL: $db_url"
echo "  - SQLite backup: $BACKUP_FILE"
echo "  - Export file: $EXPORT_FILE (delete after you verify the app)"
echo ""
echo "Next: pm2 restart fserp_backend --update-env"
echo "      bash scripts/diagnose-vps-db.sh"
