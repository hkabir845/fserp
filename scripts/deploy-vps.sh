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

echo "Deploy complete. Verify: curl https://api.mahasoftcorporation.com/health/"
