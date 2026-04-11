# FSMS Backend (Django)

Single backend: **Django** (`api/`, `fsms/`). FastAPI has been removed. The web UI is a separate app: **Next.js 16** in [`../frontend/`](../frontend/) (this Python project does not embed Next.js).

**Deploy / env:** Configure `backend/.env` or `backend/env/.env` (see [`env.example`](env.example)) — `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ORIGINS`, `FRONTEND_BASE_URL`, etc.

**Deploy metadata:** Set `FSERP_APP_VERSION` and optionally `GIT_COMMIT_SHA`; verify with `GET /api/version/`.

- **Run:** From `backend` folder: `python manage.py runserver 8000`
- **API root:** http://127.0.0.1:8000/api/
- **API docs (simple):** http://127.0.0.1:8000/api/docs/
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
cd backend_django
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Models use **managed = False** and map to the existing database tables. Configure the DB path in `fsms/settings.py`. Run `python manage.py migrate` to create Django’s auth/session tables if you use the admin site.

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
- **Other resources:** List/create and retrieve/update/delete for customers, vendors, employees, items, chart of accounts, bank accounts, journal entries, fund transfers, invoices, bills, payments, taxes, stations, islands, tanks, dispensers, meters, nozzles, shifts, tank dips, payroll, subscriptions, contracts, broadcasts, audit logs. Dashboard, reports, backup, upload, cashier, admin, domains, subscription-ledger are stubbed (501 or []).
- **WebSockets:** Not implemented; use Django Channels if needed.
