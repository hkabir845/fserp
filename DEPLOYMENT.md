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

Custom **FSERP deploy warnings** (non-fatal): **fserp.W001** SQLite without `FSERP_USE_SQLITE=1`, **fserp.W002** LocMem cache without Redis, **fserp.W003** missing `EMAIL_HOST`, **fserp.W004** WhiteNoise missing while static is not offloaded (`FSERP_DISABLE_WHITENOISE`). Fix in `.env` / `pip install` or accept the risk on internal hosts.

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

- Configure **SMTP** in `.env` (`EMAIL_HOST`, `EMAIL_HOST_USER`, …). Without it, Django uses the **console** backend and no email is delivered.
- Set **`FRONTEND_BASE_URL`** to your live Next.js origin (no trailing slash). Reset links are built as `{FRONTEND_BASE_URL}/reset-password?token=…`.
- Users must have a **deliverable address**: username that looks like an email, or a non-empty profile **`email`** (see `ensure_platform_owner_email` / user admin for platform accounts).

## 3. Tenant backup & restore

- **Who:** Company **`admin`** (and **`super_admin`** via SaaS or selected company) can download/upload backups.
- **Restore** replaces **all** ERP data for that tenant (destructive). The UI and API require typing **`DELETE_ALL_TENANT_DATA`** before upload.
- Large tenants: the frontend uses a **15-minute** Axios timeout for backup/restore; nginx/proxy timeouts should allow the same (or higher).
- Automated tests: `tests/test_password_reset_and_backup.py` (link + OTP reset, backup roundtrip, RBAC).

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

```bash
cd /path/to/FSERP/backend
source venv/bin/activate
pip install -r requirements-prod.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput
```

Run the app (example):

```bash
gunicorn fsms.wsgi:application --bind 127.0.0.1:8001 --workers 3
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
