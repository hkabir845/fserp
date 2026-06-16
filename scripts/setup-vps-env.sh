#!/usr/bin/env bash
# Create or validate backend/.env for VPS deployment.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env"
TEMPLATE="${REPO_ROOT}/backend/env.production.example"
SQLITE_FILE="${REPO_ROOT}/backend/db.sqlite3"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$TEMPLATE" ]]; then
    echo "Missing template: $TEMPLATE" >&2
    exit 1
  fi
  cp "$TEMPLATE" "$ENV_FILE"
  echo "Created $ENV_FILE from template."
fi

get_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

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

secret="$(get_var DJANGO_SECRET_KEY)"
secret="${secret// /}"

needs_key=0
if [[ -z "$secret" || "$secret" == "CHANGE_ME_generate_with_secrets_token_urlsafe_50" || ${#secret} -lt 32 ]]; then
  needs_key=1
fi

if [[ "$needs_key" -eq 1 ]]; then
  if [[ "${1:-}" == "--generate-key" ]]; then
    new_key="$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")"
    set_var "DJANGO_SECRET_KEY" "$new_key"
    echo "Generated DJANGO_SECRET_KEY in $ENV_FILE"
  else
    echo "ERROR: DJANGO_SECRET_KEY is missing or too short in $ENV_FILE" >&2
    echo "Edit the file, or run: bash scripts/setup-vps-env.sh --generate-key" >&2
    exit 1
  fi
fi

db_url="$(get_var DATABASE_URL)"
use_sqlite="$(get_var FSERP_USE_SQLITE)"
db_is_placeholder=0
if [[ -z "$db_url" || "$db_url" == postgres://USER:PASSWORD@127.0.0.1:5432/fserp ]]; then
  db_is_placeholder=1
fi

sqlite_bytes=0
if [[ -f "$SQLITE_FILE" ]]; then
  sqlite_bytes=$(stat -c%s "$SQLITE_FILE" 2>/dev/null || echo 0)
fi

if [[ "$db_is_placeholder" -eq 1 ]]; then
  if [[ "$use_sqlite" == "1" ]]; then
    echo "WARNING: FSERP_USE_SQLITE=1 — using SQLite. For production, set DATABASE_URL (PostgreSQL)." >&2
    echo "  Migrate safely: bash scripts/migrate-sqlite-to-postgres.sh" >&2
  elif [[ "$sqlite_bytes" -gt 100000 ]]; then
    echo "ERROR: DATABASE_URL is missing but backend/db.sqlite3 has data (${sqlite_bytes} bytes)." >&2
    echo "  1) Set DATABASE_URL in $ENV_FILE (PostgreSQL)" >&2
    echo "  2) Run: bash scripts/migrate-sqlite-to-postgres.sh" >&2
    echo "  Or temporarily: FSERP_USE_SQLITE=1 (not recommended for production)" >&2
    exit 1
  else
    echo "ERROR: DATABASE_URL is missing in $ENV_FILE." >&2
    echo "  Set: DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/fserp" >&2
    echo "  Or: bash scripts/use-postgres-env.sh 'postgres://...'" >&2
    echo "  List databases: sudo -u postgres psql -l" >&2
    exit 1
  fi
fi

echo "backend/.env OK for deployment."
