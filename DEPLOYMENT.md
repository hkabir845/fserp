# Production deployment (FSERP)

Use this checklist before and after going live. The codebase ships with automated checks in CI (pytest audit, frontend lint/build).

## 1. Automated verification (run locally)

```bash
# Backend — full suite (auth, tenants, password reset, backup/restore, …)
cd backend
pip install -r requirements-dev.txt
pytest tests/ -q --tb=short

# Backend — Django deployment system check (expects a real SECRET_KEY in prod)
set DJANGO_SECRET_KEY=<paste-50+-char-random>   # Windows; use export on Linux/macOS
python manage.py check --deploy
```

Custom **FSERP deploy warnings** (non-fatal, registered in `api/checks.py`): **fserp.W001** SQLite without `FSERP_USE_SQLITE=1`, **fserp.W002** LocMem cache without Redis, **fserp.W003** missing `EMAIL_HOST`, **fserp.W004** WhiteNoise missing while static is not offloaded (`FSERP_DISABLE_WHITENOISE`). Fix in `.env` / `pip install` or silence a specific id via `FSERP_SILENCED_SYSTEM_CHECKS` (e.g. `fserp.W002` for single-worker hosts).

**Dependencies:** `pip install -r requirements.txt` includes WhiteNoise for static files under Gunicorn. Use `pip install -r requirements-prod.txt` on the API host to add Gunicorn.

You may see **warnings** until HTTPS is fully configured (`FSERP_SECURE_SSL_REDIRECT`, `FSERP_SECURE_HSTS_SECONDS`) — resolve those on the real host behind TLS.

```bash
# Frontend
cd frontend
npm ci
npm run lint
npm run build
```

## 2. Forgot password (production)

- Configure **SMTP** in `.env` (`EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, …). Without `EMAIL_HOST`, Django uses the **console** backend and no email is delivered.
- For **port 465** (implicit SSL), set **`EMAIL_USE_SSL=1`** and usually **`EMAIL_USE_TLS=false`** (see `backend/env.example`).
- Set **`FRONTEND_BASE_URL`** to your live Next.js origin (no trailing slash). **Link** resets use `{FRONTEND_BASE_URL}/reset-password?token=…`. **OTP** resets complete on `/forgot-password` and do not need this URL for delivery.
- **OTP codes** are stored in PostgreSQL (`password_reset_token`), so they work across multiple Gunicorn workers even without Redis; **`DJANGO_CACHE_URL` / `REDIS_URL`** is still recommended for shared rate limits and OTP lockout counters (**fserp.W002** if missing).
- Users must have a **deliverable address**: username that looks like an email, or a non-empty profile **`email`** (see `ensure_platform_owner_email` / user admin for platform accounts).

## 3. Tenant backup & restore

- **Who:** Company **`admin`** (and **`super_admin`** via SaaS or selected company) can download/upload backups.
- **Restore** replaces **all** ERP data for that tenant (destructive). The UI and API require typing **`DELETE_ALL_TENANT_DATA`** before upload.
- **Schema v2** (current): full per-tenant application export — core ERP, forecourt, aquaculture (ponds, cycles, sales, feeding, landlords, Data Bank pond closes), inventory transfers, pond warehouse groups, station/pond stock, payroll pond allocations, custom roles, reporting categories, tenant group (`Organization` portal settings), and related lines.
- **Scope:** One backup file = one **Company** (legal entity). Super admins use `/admin/backup` for any tenant; company admins use `/backup` for their own tenant. Host-level PostgreSQL backups remain the way to snapshot the entire platform database.
- **Schema v1** backups still restore but may omit aquaculture/stock; the API returns a warning when restoring v1 files.
- Large tenants: the frontend uses a **15-minute** Axios timeout for backup/restore; nginx/proxy timeouts should allow the same (or higher).
- Automated tests: `tests/test_password_reset_and_backup.py`, `tests/test_tenant_backup_full.py`, `tests/test_delete_tenant_company.py`.
- **Password reset tokens** are not stored in tenant backups (security). Tenant delete/restore purges pending tokens. Schedule `python manage.py purge_password_reset_tokens` (e.g. daily cron) to remove expired and aged used rows.

## 4. Server environment (`backend/.env` or process manager)

| Variable | Production |
|----------|--------------|
| `DJANGO_SECRET_KEY` | Required: **50+** random characters (see `python -c "import secrets; print(secrets.token_urlsafe(50))"`) |
| `DATABASE_URL` | PostgreSQL URL (omit only for tiny demos) |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated API hostnames (no `https://`) |
| `FSERP_CORS_ALLOWED_ORIGINS` | Exact browser origins (`https://yourapp.com`, …) |
| `FSERP_CSRF_TRUSTED_ORIGINS` | Same schemes as the site (include `www` if used) |
| `FRONTEND_BASE_URL` | Public site URL for emails/links (no trailing slash) |
| `FSERP_SECURE_SSL_REDIRECT` | Set `1` when Django terminates HTTPS (often off if nginx redirects only) |
| `FSERP_SECURE_HSTS_SECONDS` | e.g. `31536000` after you are sure HTTPS is correct everywhere |
| `DJANGO_CACHE_URL` or `REDIS_URL` | Recommended for multiple Gunicorn workers (OTP, rate limits) |

Copy from `backend/env.example` and fill values. Never commit real `.env`.

## 5. Backend release steps (typical Linux VPS)

### First-time VPS setup

```bash
cd /path/to/FSERP
git pull

# Backend env (required — Gunicorn fails without DJANGO_SECRET_KEY)
cp backend/env.production.example backend/.env
nano backend/.env   # DATABASE_URL, SMTP, domains
bash scripts/setup-vps-env.sh --generate-key   # or set DJANGO_SECRET_KEY manually (50+ chars)

chmod +x scripts/*.sh
bash scripts/deploy-vps.sh
```

**PM2** (from repo root, uses `ecosystem.config.js`):

On a **shared VPS** where VIPTAP already uses `8000` / `3000`, FSERP binds to **`8001`** / **`3001`**. Nginx for `api.mahasoftcorporation.com` and `mahasoftcorporation.com` must proxy to those ports (see `deploy/nginx-fserp.example.conf`). Local dev still uses `8000` / `3000`.

| Process | Port | Notes |
|---------|------|--------|
| `fserp_backend` | `127.0.0.1:8001` | Loads `backend/.env` via Django settings |
| `fserp_frontend` | `127.0.0.1:3001` | `npm run start` with `PORT=3001` |

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # optional: survive reboot
```

Nginx example: [`deploy/nginx-fserp.example.conf`](deploy/nginx-fserp.example.conf).

### Routine deploy (after git pull)

```bash
cd /path/to/FSERP
git pull
bash scripts/deploy-vps.sh
```

Manual steps (if not using the script):

```bash
cd /path/to/FSERP/backend
source venv/bin/activate
pip install -r requirements-prod.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput
```

Run the app (example):

```bash
bash scripts/run-gunicorn.sh
```

Put **nginx** (or cPanel/Apache) in front: TLS, `proxy_set_header X-Forwarded-Proto https`, forward `/` and `/api/` to Gunicorn. Do not strip CORS headers if the proxy handles OPTIONS incorrectly — prefer forwarding OPTIONS to Django.

**Static files:** With **WhiteNoise** (default when not using `runserver`), `collectstatic` output is served by Django/Gunicorn at `STATIC_URL`. You can still offload `/static/` to nginx for caching; or set **`FSERP_DISABLE_WHITENOISE=1`** if the proxy serves `STATIC_ROOT` exclusively.

## 6. Frontend release

- Build: `npm run build`
- Serve with **Node** (`next start`), a **static export** (if you use one), or your host’s Next.js integration.
- Set production `NEXT_PUBLIC_*` API URLs in `.env.production` (must **not** point at `localhost` for real users). The Next build fails if public URLs are loopback in production (see `frontend/next.config.mjs`).

## 7. Post-deploy smoke tests

- `GET /health/` — `status: healthy`, `backend: django`
- `GET /api/version/` — version + `X-Request-ID`
- Login from the live frontend; confirm tenant header behaviour if using subdomains.
- `python verify_backend.py` against `VERIFY_BACKEND_URL` (optional; local/dev oriented).

## 8. Operations

- Always run **`python manage.py migrate`** on deploy before restarting workers.
- Re-read `backend/README.md` (CORS headers, master tenant bootstrap, backups).

## 9. Go-live sign-off (pre-deployment audit)

Run these once on the release branch before promoting to production:

| Check | Command / expectation |
|-------|------------------------|
| Backend tests | `pytest tests/ -q` → **364 passed** (4 skipped) |
| Deploy system check | `python manage.py check --deploy` with real `DJANGO_SECRET_KEY` |
| Migrations | `python manage.py showmigrations api` → all `[X]` through **0110** |
| Frontend build | `cd frontend && npm ci && npm run build` |
| Permission defaults | Role `user` must **not** receive `app.users` / `app.backup` (see `tests/test_permission_defaults.py`) |
| Dev-only API | `POST /api/customers/add-dummy/` returns **403** when `DEBUG=False` |

**Code hardening included in this release:** safer default permissions for generic/unknown roles; duplicate `fserp.W001` deploy-check id removed; financial analytics / payroll `Decimal` fixes; route-level `error.tsx`; production error details hidden in UI.
