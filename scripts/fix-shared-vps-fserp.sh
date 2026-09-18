#!/usr/bin/env bash
# Shared-VPS smoothness fixes for FSERP alongside VIPTAP.
# Run on the VPS as sas (prefer without sudo for PM2; script elevates only for nginx/startup):
#   bash scripts/fix-shared-vps-fserp.sh
# Or with sudo for nginx + pm2-startup (safe — uses script path, not /root):
#   sudo bash /home/sas/fserp/fserp/scripts/fix-shared-vps-fserp.sh
set -euo pipefail

# Resolve repo from this file — do NOT use $HOME (breaks under `sudo`, which is /root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO"

# When invoked via sudo, PM2 must run as the deploy user (sas), not root.
PM2_USER="${SUDO_USER:-${USER:-sas}}"
run_as_app_user() {
  if [[ "$(id -un)" == "$PM2_USER" ]]; then
    "$@"
  else
    sudo -u "$PM2_USER" -H -- "$@"
  fi
}

echo "==> Repo: $REPO (user=$PM2_USER)"

echo "==> Tune Gunicorn for shared 4-vCPU host (leave room for VIPTAP)"
ENVF="$REPO/backend/.env"
touch "$ENVF"
if grep -q '^GUNICORN_WORKERS=' "$ENVF"; then
  sed -i 's/^GUNICORN_WORKERS=.*/GUNICORN_WORKERS=2/' "$ENVF"
else
  echo 'GUNICORN_WORKERS=2' >> "$ENVF"
fi
if grep -q '^GUNICORN_THREADS=' "$ENVF"; then
  sed -i 's/^GUNICORN_THREADS=.*/GUNICORN_THREADS=6/' "$ENVF"
else
  echo 'GUNICORN_THREADS=6' >> "$ENVF"
fi
# Ensure sas owns .env if we created lines under sudo
if [[ -n "${SUDO_USER:-}" ]]; then
  chown "${SUDO_USER}:${SUDO_USER}" "$ENVF" 2>/dev/null || true
fi
grep '^GUNICORN_' "$ENVF" || true

echo "==> Restart FSERP under PM2 with new env"
run_as_app_user bash -lc "
  cd '$REPO'
  pm2 delete fserp_backend fserp_frontend >/dev/null 2>&1 || true
  pm2 start '$REPO/ecosystem.config.js' --update-env
  pm2 save
"
sleep 6
curl -sf -H 'X-Forwarded-Proto: https' http://127.0.0.1:8001/health/ || {
  echo "ERROR: backend health failed" >&2
  exit 1
}
curl -sf -o /dev/null -w "frontend HTTP %{http_code}\n" http://127.0.0.1:3001/ || {
  echo "ERROR: frontend probe failed" >&2
  exit 1
}

need_sudo=0
if [[ "$(id -u)" -eq 0 ]]; then
  need_sudo=1
elif sudo -n true 2>/dev/null; then
  need_sudo=1
fi

if [[ "$need_sudo" -eq 1 ]]; then
  echo "==> Patch nginx: 127.0.0.1 + long proxy timeouts"
  TS="$(date +%Y%m%d%H%M%S)"
  for f in /etc/nginx/sites-enabled/fserp /etc/nginx/sites-enabled/api.mahasoftcorporation.com; do
    sudo cp -a "$f" "${f}.bak.${TS}"
    sudo sed -i \
      -e 's|http://localhost:3001|http://127.0.0.1:3001|g' \
      -e 's|http://localhost:8001|http://127.0.0.1:8001|g' \
      "$f"
  done

  sudo python3 - <<'PY'
from pathlib import Path

api = Path("/etc/nginx/sites-enabled/api.mahasoftcorporation.com")
text = api.read_text()
if "proxy_read_timeout" not in text:
    old = "        proxy_pass http://127.0.0.1:8001;"
    new = (
        "        client_max_body_size 256M;\n"
        "        proxy_read_timeout 900s;\n"
        "        proxy_connect_timeout 60s;\n"
        "        proxy_send_timeout 900s;\n"
        "        proxy_pass http://127.0.0.1:8001;"
    )
    if old not in text:
        raise SystemExit("api proxy_pass marker not found")
    api.write_text(text.replace(old, new, 1))
    print("api timeouts added")
else:
    print("api timeouts already present")

fe = Path("/etc/nginx/sites-enabled/fserp")
text = fe.read_text()
changed = False
if "proxy_read_timeout" not in text:
    old = "    location / {\n        proxy_pass http://127.0.0.1:3001;\n"
    new = (
        "    location / {\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_read_timeout 300s;\n"
        "        proxy_pass http://127.0.0.1:3001;\n"
    )
    if old in text:
        text = text.replace(old, new, 1)
        changed = True
    old2 = "        proxy_pass http://127.0.0.1:8001/;\n"
    new2 = (
        "        client_max_body_size 256M;\n"
        "        proxy_read_timeout 900s;\n"
        "        proxy_connect_timeout 60s;\n"
        "        proxy_send_timeout 900s;\n"
        "        proxy_pass http://127.0.0.1:8001/;\n"
    )
    if old2 in text:
        text = text.replace(old2, new2, 1)
        changed = True
    if changed:
        fe.write_text(text)
        print("fserp site timeouts added")
    else:
        print("fserp site patch skipped (markers missing)")
else:
    print("fserp site timeouts already present")
PY

  sudo nginx -t
  sudo systemctl reload nginx
  echo "nginx reloaded"

  echo "==> Ensure PM2 startup unit is enabled"
  if [[ ! -f /etc/systemd/system/pm2-sas.service ]]; then
    sudo env "PATH=$PATH:/usr/bin" /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u sas --hp /home/sas
  else
    sudo systemctl enable pm2-sas >/dev/null 2>&1 || true
    echo "pm2-sas.service already present"
  fi
  run_as_app_user pm2 save
  echo "pm2 startup done"
else
  echo "NOTE: no sudo — skip nginx/pm2-startup patches."
  echo "Re-run with: sudo bash $REPO/scripts/fix-shared-vps-fserp.sh"
fi

echo "==> Final status"
run_as_app_user pm2 list
ps aux | grep 'gunicorn fsms' | grep -v grep | head -8 || true
echo "Done."
