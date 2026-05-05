# FSMS Backend (Django)

**Production checklist:** [`../DEPLOYMENT.md`](../DEPLOYMENT.md) (env vars, `check --deploy`, Gunicorn, smoke tests).

Single backend: **Django** (`api/`, `fsms/`). The web UI is a separate app: **Next.js 16** in [`../frontend/`](../frontend/) (this Python project does not embed Next.js).

**Deploy / env:** Set **`DJANGO_SECRET_KEY`** (32+ chars) on the host. Copy [`env.example`](env.example) to **`backend/.env`** (loaded on startup) or export the same variables in systemd. Use **`DATABASE_URL`** for PostgreSQL on a real VPS. For **your own domain**, set **`DJANGO_ALLOWED_HOSTS`**, **`FSERP_CORS_ALLOWED_ORIGINS`**, **`FSERP_CSRF_TRUSTED_ORIGINS`**, and **`FRONTEND_BASE_URL`** (see `env.example`). If those are unset, defaults match `mahasoftcorporation.com` / `api.mahasoftcorporation.com`.

**Deploy metadata:** Set `FSERP_APP_VERSION` and optionally `GIT_COMMIT_SHA`; verify with `GET /api/version/`.

### VPS upgrades and existing data

- **Always** run `python manage.py migrate` to apply schema changes. Migrations add or alter tables/columns; they do **not** delete business rows unless a migration explicitly does so (FSERP avoids data-destroying migrations in normal releases).
- **Do not** replace the production database with an empty or demo database during upgrade. Restore from backup only when you intend to roll back.
- After deploy, operators can confirm what is already stored for the selected company via **`GET /api/system/tenant-data-summary/`** (authenticated, company-scoped). The dashboard shows the same snapshot in **“Your stored data”** (read-only).
- Post-migrate bootstrap (`ensure_master_template`) is **additive**: it creates the demo tenant if missing, seeds the chart of accounts **if empty**, adds demo products **by name only if not present**, and wires nozzles — it does **not** wipe user companies, invoices, or inventory. Set `FSERP_SKIP_MASTER_BOOTSTRAP=1` to skip it entirely (e.g. CI).
- Removing, editing, or deleting records remains a **user action** in the app (or an explicit admin backup/restore you run on purpose).

### CORS (production)

Browsers send a **preflight** `OPTIONS` request before cross-origin `POST`/`PATCH` with custom headers. The frontend sends **`X-Selected-Company-Id`** (tenant scope) and **`X-Selected-Station-Id`** (optional report / multi-site filter from `localStorage`) on API calls. The server must respond with **`Access-Control-Allow-Headers`** that includes `x-selected-company-id` and `x-selected-station-id`.

- **Django:** `fsms/settings.py` already extends `CORS_ALLOW_HEADERS` with those headers (and `x-tenant-subdomain`, `x-request-id`). **Redeploy the backend** so production runs this code.
- **CORS origins** are configured in `fsms/settings.py` (`FSERP_CORS_ALLOWED_ORIGINS` when self-hosting, else MahaSoft defaults). Do not add a second `Access-Control-Allow-Origin` in nginx.
- **Nginx / cPanel / reverse proxy:** If the proxy handles `OPTIONS` or injects CORS headers, it must **not** use a narrow `Access-Control-Allow-Headers` list. **Prefer** forwarding `OPTIONS` to Django so `django-cors-headers` sets headers. If you must set CORS in nginx, include at least: `Authorization`, `Content-Type`, `X-CSRFToken`, `X-Selected-Company-Id`, `X-Selected-Station-Id`, `X-Tenant-Subdomain`, `X-Request-Id`.

**Verify:** `python verify_backend.py` (includes a preflight check for `x-selected-company-id`). On the server, `curl -i -X OPTIONS "https://api.example.com/api/auth/login/" -H "Origin: https://localhost:3000 " -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-selected-company-id"` should show `access-control-allow-headers` containing `x-selected-company-id`.

- **Run:** From `backend` folder: `python manage.py runserver 8000`
- **Windows (recommended):** `run-dev.bat` — creates/uses `venv`, installs `requirements.txt`, then starts the server (avoids “missing dj-database-url” when using global Python while `DATABASE_URL` is set in `.env`).
- **API root:** http://localhost:8000/api/
- **API docs (simple):** http://localhost:8000/api/docs/
- **Auth:** POST `/api/auth/login/form/` (JSON or form). Create user: `python manage.py create_superuser`

Endpoints: auth (login, refresh), companies/current, admin/stats, admin/companies, admin/users, dashboard/stats, broadcasts, and stub lists for customers, tanks, items, nozzles (empty until you add full CRUD).

**Obsolete scripts:** Scripts in the backend root that imported from the removed `app` package (e.g. `init_database.py`, `create_tenant_companies.py`, `create_super_admin.py`, `diagnose_login.py`, and others) will raise `ImportError` if run. Use Django management commands and the API instead.

**Built-in demo tenant (FS-000001):** After `python manage.py migrate`, the backend ensures **Master Filling Station** exists with company code **FS-000001** (not `FS-FS-000001` — the human-facing code is exactly `FS-000001`). It loads the fuel-station chart of accounts (if empty), convenience **products and services** for Cashier → General, and the **fuel station / nozzle** demo graph. Re-run or repair anytime: `python manage.py ensure_master_template`. For a richer sandbox (posted GL, vendors, sample P&amp;L), run `python manage.py seed_master_full_demo`. To disable auto-bootstrap (tests, or an empty staging DB), set **`FSERP_SKIP_MASTER_BOOTSTRAP=1`**.

**First run:** Create a super_admin user. The demo company is created by **migrate** (or use `create_default_company` only when the database has **no** companies yet):
```bash
python manage.py migrate
python manage.py create_superuser --username superuser@sasfserp.com --password "Admin@123"
# Optional if migrate did not run (empty DB manual path):
# python manage.py create_default_company
```
If `create_superuser` says the user already exists but they do not appear in **SaaS → All Users**, normalize role and active flag:
```bash
python manage.py ensure_saas_superuser --username superuser@sasfserp.com
```
If you already have a superuser `admin@afs.com` and want to rename to `superuser@sasfserp.com` (password unchanged):
```bash
python manage.py rename_superuser
```

---

## Credentials (login)

- **No users exist by default.** You must create at least one user before you can log in.
- **Login** uses the **api.User** model (username + password). The frontend sends `username` and `password` to `POST /api/auth/login/` (or `/auth/login/form/`, `/auth/login/json/`).

**Option A – Recommended (from first run above):**
- **Username:** `superuser@sasfserp.com`
- **Password:** `Admin@123`

**Option B – Simple local dev:**
```bash
python manage.py create_superuser --username admin --password admin --email admin@localhost
```
- **Username:** `admin`
- **Password:** `admin`

Then log in on the frontend with that username and password.

---

## Setup

**Windows (PowerShell)** — from repo root:

```powershell
pwsh -File backend/scripts/local-setup.ps1
```

**Manual:**

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
```

Optional: copy **`backend/.env.example`** to **`backend/.env`** for `FRONTEND_BASE_URL=http://localhost:3000` and other overrides. You can also use **`backend/env/.env`** (loaded after `.env`).

Use **`DATABASE_URL`** for PostgreSQL (see `env.example`), or omit it to use the default SQLite file `backend/db.sqlite3`. Run `python manage.py migrate` to apply Django migrations.

**Process manager (VPS):** Install **`pip install -r requirements-prod.txt`** (or `requirements.txt` plus Gunicorn), then run the API behind nginx or another reverse proxy, for example: `gunicorn fsms.wsgi:application --bind 127.0.0.1:8001 --workers 3`. Set **`DJANGO_SECRET_KEY`** and **`DATABASE_URL`** in the service environment (or `backend/.env`). Run **`python manage.py collectstatic --noinput`**; **WhiteNoise** serves admin/static from `STATIC_ROOT` unless **`FSERP_DISABLE_WHITENOISE=1`** (nginx-only static).

## Run

```bash
python manage.py runserver 8000
```

- Root: http://localhost:8000/
- Health: http://localhost:8000/health
- API: http://localhost:8000/api/
- Auth: POST /api/auth/login (JSON or form), /api/auth/refresh, /api/auth/me
- Companies: /api/companies/, /api/companies/current, /api/companies/<id>
- Users: /api/users/, /api/users/<id>
- CRUD: /api/customers/, /api/vendors/, /api/items/, /api/invoices/, /api/bills/, etc.

## What’s included

- **Models:** All domain models as Django models (same `db_table`), unmanaged.
- **Auth:** JWT login/refresh/me/register (bcrypt).
- **Companies & users:** List, get, create, update, delete with role-based access.
- **Other resources:** List/create and retrieve/update/delete for customers, vendors, employees, items, chart of accounts, bank accounts, journal entries, fund transfers, invoices, bills, payments, taxes, stations, islands, tanks, dispensers, meters, nozzles, shifts, tank dips, payroll, loans, inventory, subscriptions, contracts, broadcasts, audit logs. Dashboard, reports, backup/restore, cashier, admin, and subscription flows are implemented against the Django API; see `api/urls.py` for the live route list.
- **WebSockets:** Not implemented; use Django Channels if you need server-push.
