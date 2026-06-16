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
python manage.py collectstatic --noinput

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
curl -sf "http://127.0.0.1:8001/health/" | head -c 200 || echo "WARN: backend health check failed"
curl -sf -o /dev/null -w "frontend HTTP %{http_code}\n" "http://127.0.0.1:3001/" || echo "WARN: frontend check failed"

echo "Deploy complete. Verify: curl https://api.mahasoftcorporation.com/health/"
