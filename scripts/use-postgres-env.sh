#!/usr/bin/env bash
# Point backend/.env at PostgreSQL and disable SQLite mode.
# Usage: bash scripts/use-postgres-env.sh 'postgres://user:pass@127.0.0.1:5432/fserp'
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env"

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/use-postgres-env.sh 'postgres://USER:PASSWORD@127.0.0.1:5432/DBNAME'" >&2
  exit 1
fi

DB_URL="$1"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "${REPO_ROOT}/backend/env.production.example" "$ENV_FILE"
fi

set_var() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_var "DATABASE_URL" "$DB_URL"
if grep -q '^FSERP_USE_SQLITE=' "$ENV_FILE"; then
  sed -i.bak '/^FSERP_USE_SQLITE=/d' "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
fi

echo "Set DATABASE_URL in $ENV_FILE and removed FSERP_USE_SQLITE."
echo "Run: cd backend && source venv/bin/activate && python manage.py migrate --noinput"
echo "If moving data from db.sqlite3: bash scripts/migrate-sqlite-to-postgres.sh"
