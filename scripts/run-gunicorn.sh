#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
# shellcheck disable=SC1091
source venv/bin/activate

# SQLite cannot handle concurrent writers; multiple Gunicorn workers cause "database is locked"
# and API timeouts (e.g. GET /api/payroll/ with many runs). Use one worker unless PostgreSQL.
WORKERS=3
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi
if [[ -z "${DATABASE_URL:-}" ]] || [[ "${FSERP_USE_SQLITE:-}" == "1" ]]; then
  WORKERS=1
  echo "Gunicorn: SQLite detected — using 1 worker (set DATABASE_URL for PostgreSQL + more workers)."
fi

exec python -m gunicorn fsms.wsgi:application \
  --bind 127.0.0.1:8001 \
  --workers "${WORKERS}" \
  --timeout 180 \
  --access-logfile - \
  --error-logfile -
