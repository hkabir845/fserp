#!/usr/bin/env bash
# One-shot: install PostgreSQL (if needed), create DB, migrate SQLite -> PostgreSQL, restart FSERP.
# Run on the VPS from repo root (requires sudo for apt/postgres admin once):
#   cd ~/fserp/fserp && bash scripts/vps-postgres-migrate-all.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
BACKEND="${REPO_ROOT}/backend"
ENV_FILE="${BACKEND}/.env"
CREDS_FILE="${BACKEND}/.postgres_credentials"

DB_NAME="${FSERP_PG_DB:-fserp}"
DB_USER="${FSERP_PG_USER:-fserp_user}"

echo "==> FSERP SQLite -> PostgreSQL migration"
echo "    Repo: $REPO_ROOT"

cd "$BACKEND"
# shellcheck disable=SC1091
source venv/bin/activate
cd "$REPO_ROOT"

# Already on PostgreSQL with data?
if python "$BACKEND/manage.py" shell -c "
from django.conf import settings
from api.models import Company
e = settings.DATABASES['default']['ENGINE']
n = Company.objects.count()
print(e)
print(n)
" 2>/dev/null | head -2 | grep -q postgresql; then
  COMPANIES="$(python "$BACKEND/manage.py" shell -c "from api.models import Company; print(Company.objects.count())" 2>/dev/null || echo 0)"
  if [[ "${COMPANIES:-0}" -ge 1 ]]; then
    echo "Already using PostgreSQL with ${COMPANIES} companies — nothing to do."
    bash "$REPO_ROOT/scripts/diagnose-vps-db.sh"
    exit 0
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "==> Installing PostgreSQL (sudo required)..."
  sudo apt-get update -qq
  sudo apt-get install -y postgresql postgresql-contrib
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
fi

get_env_db_url() {
  grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

DB_URL="$(get_env_db_url)"
if [[ -z "$DB_URL" || "$DB_URL" == postgres://USER:PASSWORD@127.0.0.1:5432/fserp ]]; then
  if [[ -f "$CREDS_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS_FILE"
    DB_URL="${DATABASE_URL:-}"
  fi
fi

if [[ -z "$DB_URL" || "$DB_URL" == postgres://USER:PASSWORD@127.0.0.1:5432/fserp ]]; then
  PG_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  echo "==> Creating PostgreSQL role and database (sudo required)..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${PG_PASS}';
  END IF;
END
\$\$;
SELECT format('CREATE DATABASE %I OWNER %I', '${DB_NAME}', '${DB_USER}')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL
  DB_URL="postgres://${DB_USER}:${PG_PASS}@127.0.0.1:5432/${DB_NAME}"
  {
    echo "# FSERP PostgreSQL credentials — keep private"
    echo "DATABASE_URL=${DB_URL}"
    echo "Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$CREDS_FILE"
  chmod 600 "$CREDS_FILE"
  echo "    Credentials saved: backend/.postgres_credentials"
fi

echo "==> Configuring backend/.env for PostgreSQL"
bash "$REPO_ROOT/scripts/use-postgres-env.sh" "$DB_URL"

echo "==> Migrating data from SQLite (if present)"
bash "$REPO_ROOT/scripts/migrate-sqlite-to-postgres.sh" --yes

echo "==> Restarting FSERP"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart fserp_backend --update-env 2>/dev/null || pm2 startOrReload "$REPO_ROOT/ecosystem.config.js" --update-env
  pm2 save 2>/dev/null || true
fi

echo ""
bash "$REPO_ROOT/scripts/diagnose-vps-db.sh"

echo ""
echo "Migration finished. Test https://mahasoftcorporation.com/payroll"
if [[ -f "$CREDS_FILE" ]]; then
  echo "DB password stored in: backend/.postgres_credentials"
fi
