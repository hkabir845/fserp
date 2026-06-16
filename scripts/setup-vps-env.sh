#!/usr/bin/env bash
# Create or validate backend/.env for VPS deployment.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env"
TEMPLATE="${REPO_ROOT}/backend/env.production.example"

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

secret="$(get_var DJANGO_SECRET_KEY)"
secret="${secret// /}"

needs_key=0
if [[ -z "$secret" || "$secret" == "CHANGE_ME_generate_with_secrets_token_urlsafe_50" || ${#secret} -lt 32 ]]; then
  needs_key=1
fi

if [[ "$needs_key" -eq 1 ]]; then
  if [[ "${1:-}" == "--generate-key" ]]; then
    new_key="$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")"
    if grep -q '^DJANGO_SECRET_KEY=' "$ENV_FILE"; then
      sed -i.bak "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=${new_key}|" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
    else
      echo "DJANGO_SECRET_KEY=${new_key}" >> "$ENV_FILE"
    fi
    echo "Generated DJANGO_SECRET_KEY in $ENV_FILE"
  else
    echo "ERROR: DJANGO_SECRET_KEY is missing or too short in $ENV_FILE" >&2
    echo "Edit the file, or run: bash scripts/setup-vps-env.sh --generate-key" >&2
    exit 1
  fi
fi

db_url="$(get_var DATABASE_URL)"
if [[ -z "$db_url" || "$db_url" == postgres://USER:PASSWORD@127.0.0.1:5432/fserp ]]; then
  echo "WARNING: Set DATABASE_URL in $ENV_FILE before going live." >&2
fi

echo "backend/.env OK for deployment."
