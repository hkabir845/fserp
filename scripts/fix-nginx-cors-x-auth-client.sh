#!/usr/bin/env bash
# Add x-auth-client (and related auth headers) to nginx Access-Control-Allow-Headers.
# Login from https://mahasoftcorporation.com sends X-Auth-Client; older nginx CORS
# snippets omitted it and browsers blocked the preflight.
#
# Run on the VPS:
#   bash scripts/fix-nginx-cors-x-auth-client.sh
# Or:
#   sudo bash /home/sas/fserp/fserp/scripts/fix-nginx-cors-x-auth-client.sh
set -euo pipefail

OLD="Authorization, Content-Type, X-Requested-With, x-selected-company-id, x-tenant-subdomain, x-request-id, idempotency-key"
NEW="Authorization, Content-Type, X-Requested-With, X-CSRFToken, x-selected-company-id, x-selected-station-id, x-tenant-subdomain, x-request-id, idempotency-key, x-auth-client"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

TS="$(date +%Y%m%d%H%M%S)"
patched=0

for f in \
  /etc/nginx/sites-enabled/api.mahasoftcorporation.com \
  /etc/nginx/sites-enabled/fserp \
  /etc/nginx/sites-available/api.mahasoftcorporation.com \
  /etc/nginx/sites-available/fserp \
  /etc/nginx/sites-available/nobinagro.sascorporationbd.com \
  /etc/nginx/sites-enabled/nobinagro.sascorporationbd.com
do
  [[ -f "$f" ]] || continue
  if grep -Fq "$OLD" "$f"; then
    $SUDO cp -a "$f" "${f}.bak.${TS}"
    $SUDO sed -i "s|${OLD}|${NEW}|g" "$f"
    echo "patched: $f"
    patched=1
  elif grep -Fq "x-auth-client" "$f"; then
    echo "already has x-auth-client: $f"
  elif grep -Fq "Access-Control-Allow-Headers" "$f"; then
    echo "WARN: $f has Allow-Headers but unexpected value — inspect manually"
    grep -n "Access-Control-Allow-Headers" "$f" || true
  fi
done

if [[ "$patched" -eq 1 ]]; then
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  echo "nginx reloaded"
else
  echo "No files needed the old-header rewrite (or none matched)."
fi

echo "==> Verify preflight"
curl -sI -X OPTIONS "https://api.mahasoftcorporation.com/api/auth/login/json/" \
  -H "Origin: https://mahasoftcorporation.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-auth-client" \
  | tr -d '\r' | grep -i "access-control-allow-headers" || true
