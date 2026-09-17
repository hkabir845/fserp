#!/usr/bin/env bash
# Ensure FSERP backend (:8001) and frontend (:3001) are online under PM2.
# Safe to run from cron every minute on the live VPS.
#
#   * * * * * /home/sas/fserp/fserp/scripts/ensure-fserp-up.sh >>/home/sas/fserp-backups/ensure-fserp.log 2>&1
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: pm2 not found" >&2
  exit 1
fi

need_start=0
for name in fserp_backend fserp_frontend; do
  status="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
name=sys.argv[1]
try:
    apps=json.load(sys.stdin)
except Exception:
    print('missing'); raise SystemExit
for p in apps:
    if p.get('name')==name:
        print((p.get('pm2_env') or {}).get('status') or 'unknown')
        raise SystemExit
print('missing')
" "$name" 2>/dev/null || echo missing)"
  if [[ "$status" != "online" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name status=${status:-empty} — will start/restart"
    need_start=1
  fi
done

if [[ "$need_start" -eq 1 ]]; then
  pm2 startOrReload "$REPO_ROOT/ecosystem.config.js" --update-env
  pm2 save
  sleep 5
fi

be_ok=0
fe_ok=0
if curl --max-time 8 -sf -H "X-Forwarded-Proto: https" "http://127.0.0.1:8001/health/" >/dev/null; then
  be_ok=1
fi
if curl --max-time 8 -sf -o /dev/null "http://127.0.0.1:3001/"; then
  fe_ok=1
fi

if [[ "$be_ok" -ne 1 ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backend health failed — pm2 restart fserp_backend"
  pm2 restart fserp_backend --update-env
  sleep 6
  curl --retry 4 --retry-connrefused --retry-delay 2 --max-time 10 -sf \
    -H "X-Forwarded-Proto: https" "http://127.0.0.1:8001/health/" >/dev/null \
    || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: backend still unhealthy" >&2
fi

if [[ "$fe_ok" -ne 1 ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) frontend probe failed — pm2 restart fserp_frontend"
  pm2 restart fserp_frontend --update-env
  sleep 5
  curl --retry 4 --retry-connrefused --retry-delay 2 --max-time 10 -sf \
    -o /dev/null "http://127.0.0.1:3001/" \
    || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: frontend still down" >&2
fi

pm2 save >/dev/null 2>&1 || true
