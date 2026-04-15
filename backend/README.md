# FSMS Backend (Django)

Single backend: **Django** (`api/`, `fsms/`). FastAPI has been removed. The web UI is a separate app: **Next.js 16** in [`../frontend/`](../frontend/) (this Python project does not embed Next.js).

**Deploy / env:** Configure `backend/.env` or `backend/env/.env` (see [`env.example`](env.example)) — `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS`, `FRONTEND_BASE_URL`, etc. (Production requires the `DJANGO_*` names; `ALLOWED_HOSTS` / `CORS_ORIGINS` alone are not read by `fsms/settings.py`.)

**Deploy metadata:** Set `FSERP_APP_VERSION` and optionally `GIT_COMMIT_SHA`; verify with `GET /api/version/`.

### CORS (production)

Browsers send a **preflight** `OPTIONS` request before cross-origin `POST`/`PATCH` with custom headers. The frontend sends **`X-Selected-Company-Id`** (tenant scope) for many API calls. The server must respond with **`Access-Control-Allow-Headers`** that includes `x-selected-company-id`.

- **Django:** `fsms/settings.py` already extends `CORS_ALLOW_HEADERS` with that header (and `x-tenant-subdomain`, `x-request-id`). **Redeploy the backend** so production runs this code.
- **`DJANGO_CORS_ALLOWED_ORIGINS`** must include your UI origin(s), e.g. `https://mahasoftcorporation.com,https://www.mahasoftcorporation.com` (comma-separated; see `env.example`).
- **Nginx / cPanel / reverse proxy:** If the proxy handles `OPTIONS` or injects CORS headers, it must **not** use a narrow `Access-Control-Allow-Headers` list. **Prefer** forwarding `OPTIONS` to Django so `django-cors-headers` sets headers. If you must set CORS in nginx, include at least: `Authorization`, `Content-Type`, `X-CSRFToken`, `X-Selected-Company-Id`, `X-Tenant-Subdomain`, `X-Request-Id`.

**Verify:** `python verify_backend.py` (includes a preflight check for `x-selected-company-id`). On the server, `curl -i -X OPTIONS "https://api.example.com/api/auth/login/" -H "Origin: https://mahasoftcorporation.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-selected-company-id"` should show `access-control-allow-headers` containing `x-selected-company-id`.

- **Run:** From `backend` folder: `python manage.py runserver 8000`
- **API root:** https://api.mahasoftcorporation.com/api/
- **API docs (simple):** https://api.mahasoftcorporation.com/api/docs/
- **Auth:** POST `/api/auth/login/form/` (JSON or form). Create user: `python manage.py create_superuser`

Endpoints: auth (login, refresh), companies/current, admin/stats, admin/companies, admin/users, dashboard/stats, broadcasts, and stub lists for customers, tanks, items, nozzles (empty until you add full CRUD).

**Obsolete scripts:** Scripts in the backend root that imported from the removed `app` package (e.g. `init_database.py`, `create_tenant_companies.py`, `create_super_admin.py`, `diagnose_login.py`, and others) will raise `ImportError` if run. Use Django management commands and the API instead.

**First run:** Create a super_admin user and a default company:
```bash
python manage.py create_superuser --username superuser@sasfserp.com --password "Admin@123"
python manage.py create_default_company
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

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Use **`DATABASE_URL`** for PostgreSQL (see `env.example`), or omit it to use the default SQLite file `backend/db.sqlite3`. Run `python manage.py migrate` to apply Django migrations.

## Run

```bash
python manage.py runserver 8000
```

- Root: https://api.mahasoftcorporation.com/
- Health: https://api.mahasoftcorporation.com/health
- API: https://api.mahasoftcorporation.com/api/
- Auth: POST /api/auth/login (JSON or form), /api/auth/refresh, /api/auth/me
- Companies: /api/companies/, /api/companies/current, /api/companies/<id>
- Users: /api/users/, /api/users/<id>
- CRUD: /api/customers/, /api/vendors/, /api/items/, /api/invoices/, /api/bills/, etc.

## What’s included

- **Models:** All domain models as Django models (same `db_table`), unmanaged.
- **Auth:** JWT login/refresh/me/register (bcrypt).
- **Companies & users:** List, get, create, update, delete with role-based access.
- **Other resources:** List/create and retrieve/update/delete for customers, vendors, employees, items, chart of accounts, bank accounts, journal entries, fund transfers, invoices, bills, payments, taxes, stations, islands, tanks, dispensers, meters, nozzles, shifts, tank dips, payroll, subscriptions, contracts, broadcasts, audit logs. Dashboard, reports, backup, upload, cashier, admin, domains, subscription-ledger are stubbed (501 or []).
- **WebSockets:** Not implemented; use Django Channels if needed.
