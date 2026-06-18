#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
# shellcheck disable=SC1091
source venv/bin/activate
exec python -m gunicorn fsms.wsgi:application \
  --bind 127.0.0.1:8001 \
  --workers 3 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
