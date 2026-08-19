#!/usr/bin/env bash
# Deploy FSERP to a Linux VPS (run from repo root after git pull).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Validating backend environment"
bash scripts/setup-vps-env.sh

echo "==> Backend: venv + dependencies"
cd "$REPO_ROOT/backend"
if [[ ! -d venv ]]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-prod.txt

# Release stamp so /health/ and /api/version/ report what is actually running instead of
# 0.0.0-dev. run-gunicorn.sh sources .env.release after .env.
RELEASE_VERSION="$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || echo "unknown")"
RELEASE_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo "")"
RELEASE_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
{
  echo "# Written by scripts/deploy-vps.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) - do not edit by hand."
  echo "FSERP_APP_VERSION=${RELEASE_VERSION}"
  echo "GIT_COMMIT_SHA=${RELEASE_COMMIT}"
} > "$REPO_ROOT/backend/.env.release"
echo "==> Release: ${RELEASE_VERSION} (${RELEASE_COMMIT}) on ${RELEASE_BRANCH}"

echo "==> Backend: database backup"
# DATABASE_URL lives in backend/.env, not in the shell. Running pg_dump without it fails with
# `role "<login user>" does not exist`, which is how a deploy once went out with no backup.
set -a
# shellcheck disable=SC1091
[[ -f "$REPO_ROOT/backend/.env" ]] && source "$REPO_ROOT/backend/.env"
set +a
BACKUP_DIR="${FSERP_BACKUP_DIR:-$HOME/fserp-backups}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/fserp-$(date -u +%Y%m%d-%H%M%S).sql.gz"
if [[ "${FSERP_SKIP_BACKUP:-0}" == "1" ]]; then
  echo "SKIPPED (FSERP_SKIP_BACKUP=1)"
elif [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARN: DATABASE_URL is not set in backend/.env - no backup taken." >&2
elif ! command -v pg_dump >/dev/null 2>&1; then
  echo "WARN: pg_dump not installed - no backup taken. Install postgresql-client." >&2
elif pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"; then
  echo "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  # Keep the last 10 so the disk does not fill silently. Never let pruning abort a deploy:
  # under `set -euo pipefail` an unmatched glob makes ls exit 2 and kills the script.
  (ls -1t "$BACKUP_DIR"/fserp-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm --) || true
else
  rm -f "$BACKUP_FILE"
  echo "ERROR: backup failed - refusing to migrate. Fix DATABASE_URL or set FSERP_SKIP_BACKUP=1." >&2
  exit 1
fi

echo "==> Backend: migrate + static"
python manage.py migrate --noinput
# Shared cache table when DJANGO_CACHE_URL/REDIS_URL is unset (DatabaseCache).
# No-op for Redis. Must not be skipped: auth rate limiting reads the cache on every login.
python manage.py createcachetable
python manage.py collectstatic --noinput

echo "==> Backend: cache read/write check"
python manage.py shell -c "
from django.core.cache import cache
cache.set('fserp:deploy:probe', 'ok', 30)
assert cache.get('fserp:deploy:probe') == 'ok', 'cache read-back failed'
print('cache OK')
"

echo "==> Backend: database sanity check"
bash "$REPO_ROOT/scripts/diagnose-vps-db.sh" || true

echo "==> Backend: deployment check"
python manage.py check --deploy || true

echo "==> Frontend: install + build"
cd "$REPO_ROOT/frontend"
npm ci
npm run build

echo "==> PM2: reload processes"
cd "$REPO_ROOT"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm install -g pm2" >&2
  exit 1
fi

pm2 startOrReload ecosystem.config.js --update-env
pm2 save

echo "==> Smoke tests"
cd "$REPO_ROOT/backend"
sleep 2
# X-Forwarded-Proto mirrors nginx so SECURE_SSL_REDIRECT does not 301 the loopback check.
curl -sf -H "X-Forwarded-Proto: https" "http://127.0.0.1:8001/health/" | head -c 200 \
  || echo "WARN: backend health check failed"
echo
curl -sf -o /dev/null -w "frontend HTTP %{http_code}\n" "http://127.0.0.1:3001/" || echo "WARN: frontend check failed"

# Login must answer 400 (missing credentials), not 500 — 500 means cache/DB is broken.
login_code="$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" -H "X-Forwarded-Proto: https" \
  -d '{}' "http://127.0.0.1:8001/api/auth/login/json/" || echo "000")"
echo "login endpoint HTTP $login_code"
if [[ "$login_code" == "5"* || "$login_code" == "000" ]]; then
  echo "ERROR: login endpoint is failing (HTTP $login_code). Check backend logs: pm2 logs fserp-backend" >&2
fi

# The FastAPI/Alembic stack was removed; if its bookkeeping table ever appears, something
# outside this repo is writing to the database.
python - <<'PY' || true
import django, os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()
from django.db import connection
with connection.cursor() as c:
    c.execute("select to_regclass('public.alembic_version')")
    found = c.fetchone()[0]
print(f"alembic_version table: {found or 'absent (expected)'}")
PY

echo "Deploy complete. Verify: curl https://api.mahasoftcorporation.com/health/"
