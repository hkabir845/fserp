#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
# shellcheck disable=SC1091
source venv/bin/activate

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

# Threaded (gthread) workers so a few processes serve many concurrent requests.
# Plain sync workers handle ONE request each and block on DB I/O, so a handful of
# slow/queued calls (dashboards, lists, side-total refreshes) starve everything —
# a payment POST then waits past the client timeout and users must click twice.
# PostgreSQL + Django are thread-safe, so threads overlap I/O waits safely.
WORKERS="${GUNICORN_WORKERS:-3}"
THREADS="${GUNICORN_THREADS:-4}"

exec python -m gunicorn fsms.wsgi:application \
  --bind 127.0.0.1:8001 \
  --worker-class gthread \
  --workers "${WORKERS}" \
  --threads "${THREADS}" \
  --timeout 180 \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile -
