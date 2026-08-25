#!/usr/bin/env bash
# Restore nobinagro.sascorporationbd.com → FSERP (frontend :3001, API :8001).
# Requires sudo once on VPS: bash ~/fix-nobinagro-site.sh
set -euo pipefail

CONF_NAME="nobinagro.sascorporationbd.com"
CONF_PATH="/etc/nginx/sites-available/${CONF_NAME}"
ENABLED_PATH="/etc/nginx/sites-enabled/${CONF_NAME}"
DOMAIN="nobinagro.sascorporationbd.com"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

write_nginx_conf() {
  $SUDO tee "$CONF_PATH" >/dev/null <<'EOF'
# FSERP tenant — Nobin Agro (Master Filling Station org)
server {
    server_name nobinagro.sascorporationbd.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;

        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' 'https://nobinagro.sascorporationbd.com' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, PATCH, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, X-Requested-With, x-selected-company-id, x-tenant-subdomain, x-request-id, idempotency-key' always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            add_header 'Content-Type' 'text/plain; charset=utf-8' always;
            add_header 'Content-Length' 0 always;
            return 204;
        }

        add_header 'Access-Control-Allow-Origin' 'https://nobinagro.sascorporationbd.com' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Vary' 'Origin' always;

        proxy_pass http://localhost:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/nobinagro.sascorporationbd.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nobinagro.sascorporationbd.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    listen 80;
    server_name nobinagro.sascorporationbd.com;
    return 301 https://$host$request_uri;
}
EOF
  $SUDO ln -sf "$CONF_PATH" "$ENABLED_PATH"
}

echo "==> Writing nginx site ${CONF_NAME}"
write_nginx_conf

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "==> Requesting TLS certificate"
  $SUDO certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m admin@mahasoftcorporation.com || \
  $SUDO certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos -m admin@mahasoftcorporation.com
fi

echo "==> Reload nginx"
$SUDO nginx -t
$SUDO systemctl reload nginx

echo "==> Smoke test"
curl -skI --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/" | head -8
echo "Done: https://${DOMAIN}/"
