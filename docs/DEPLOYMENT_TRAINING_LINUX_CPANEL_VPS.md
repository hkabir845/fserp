# FSERP — Hands-on deployment training (Linux: cPanel vs VPS)

This guide is for **Filling Station ERP (FSERP)**: a **Next.js 14** frontend (`frontend/`) and a **Django 5** REST API (`backend/`). The backend defaults to **SQLite** (`backend/db.sqlite3`); you can move to PostgreSQL later on a VPS if you outgrow SQLite.

For **release policy, env var semantics, and health checks**, see [`OPERATIONS.md`](./OPERATIONS.md).

---

## 1. What you are deploying (mental model)

| Piece | Technology | Typical production role |
|-------|------------|-------------------------|
| **Frontend** | Node.js → `next build` → `next start` | Serves the browser UI, static assets under `/_next/` |
| **Backend** | Python → Gunicorn (or host WSGI) + Django | Serves `/api/…`, `/health/`, `/media/` if used |
| **Database** | SQLite file (default) or PostgreSQL | Tenant and ERP data |

**Important:** `NEXT_PUBLIC_*` variables are **baked into the frontend at build time**. If you change API URLs after build, you must **rebuild** the Next.js app (or use runtime config patterns not currently in this repo).

**CORS:** With `DJANGO_DEBUG=false`, Django uses `CORS_ORIGINS`. Every **exact** frontend origin (scheme + host + port) must be listed.

### 1.1 Do you need “Master Filling Station” in production?

**No — it is not a separate package to deploy.** It is optional seed data (a company row with `is_master='true'`) used in some dev flows. For production you can:

- Create tenants only from **SaaS → Companies** (and assign contracts/users as needed), or  
- Run `python manage.py create_default_company` if you want a starter company in the DB.

If the database has **no companies** yet and a **super_admin** hits tenant-scoped APIs, the backend may auto-create a fallback company so `company_id` resolution works — you can rename or remove that row later. **If “New Company” does not save and the console shows `net::ERR_FAILED` or CORS errors, the blocker is almost always networking/CORS (below), not a missing Master tenant.**

### 1.2 Local development vs split production domains — required env

**Local (laptop):** UI `http://localhost:3000`, API `https://fsapi.sascorporationbd.com` (defaults in `frontend/.env.example` and `frontend/src/lib/api.ts`). No `APP_SHELL` hostname quirks on `localhost`.

**Production (split hostnames):** e.g. frontend `https://app.example.com`, API `https://api.example.com`.

On the **frontend** build env (e.g. `.env.production` or host panel), when the UI is on a **three-label** app host (not a tenant vanity subdomain), set:

```bash
NEXT_PUBLIC_APP_SHELL_HOSTNAMES=app.example.com,www.app.example.com
```

That value is your **main app UI** hostname(s), not a tenant slug. Without it, the client can mistakenly send `X-Tenant-Subdomain` from the first label (e.g. `app` on `app.example.com`), which forces a stricter CORS preflight. After adding this variable, **rebuild** Next.js (`npm run build`).

On the **backend** `.env` (production example):

```bash
DJANGO_DEBUG=false
ALLOWED_HOSTS=api.example.com,localhost,127.0.0.1
CORS_ORIGINS=https://app.example.com,https://www.app.example.com
FRONTEND_BASE_URL=https://app.example.com
```

- **`CORS_ORIGINS`** must match the **browser origin** of the Next.js app (scheme + host, no path; no trailing slash). Add more origins separated by commas if you have staging + production UIs.
- After any change to CORS env vars, **restart** the Python app (Passenger, Gunicorn, uWSGI, etc.).

If DevTools shows: **`Request header field x-tenant-subdomain is not allowed by Access-Control-Allow-Headers`**, the API server is not returning the current allow-list for preflight. Deploy the latest `fsms/settings.py` (it extends `corsheaders.defaults.default_headers` and adds `x-tenant-subdomain`, `x-selected-company-id`, `x-request-id`) and restart.

**PWA / service worker:** The app registers `/sw.js?v=3` (see `PwaInstallBanner.tsx`). Legacy workers that used bare `/sw.js` are **unregistered on load** so cross-origin API calls are not intercepted. After deploy, one normal reload is enough; use DevTools → Application → Clear site data only if something still sticks.

#### Copy-paste checklist

| Where | Variable | Local dev example | Production (split domains) example |
|-------|----------|-------------------|-------------------------------------|
| **Frontend** | `NEXT_PUBLIC_API_BASE_URL` | `https://fsapi.sascorporationbd.com` | `https://api.example.com` |
| **Frontend** | `NEXT_PUBLIC_APP_SHELL_HOSTNAMES` | `localhost,127.0.0.1` | `app.example.com,www.app.example.com` |
| **Backend** | `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | `https://app.example.com,https://www.app.example.com` |
| **Backend** | `ALLOWED_HOSTS` | `localhost,127.0.0.1` (+ API host in prod) | `api.example.com,localhost,127.0.0.1` |
| **Backend** | `FRONTEND_BASE_URL` | `http://localhost:3000` | `https://app.example.com` |

Then: **`npm run build`** (frontend) and **restart** the Django process. Templates: `frontend/.env.production.example`, `backend/env/.env.example`.

---

## 2. Prerequisites (both environments)

1. **Linux** host with SSH (VPS) or cPanel File Manager + Terminal (if enabled).
2. **Domain** and DNS:
   - Recommended: `app.example.com` (Next.js) and `api.example.com` (Django), both **HTTPS**.
3. **Versions** (align with project):
   - **Node.js** 18.x or 20.x LTS (Next 14).
   - **Python** 3.10+ (3.12/3.13 OK per `backend/requirements.txt`).
4. **Firewall:** allow **80/443** to the public; backend/Node ports should be **localhost-only** behind the reverse proxy.

**Training exercise:** On your laptop, run through `backend/README.md` and `frontend` dev URLs once so you know login and `/api/docs/` work before touching production.

---

## Part A — VPS deployment (recommended for full control)

VPS is the **straightforward** path for this stack: **Nginx** terminates TLS and reverse-proxies to **Gunicorn** (Django) and **Node** (Next.js), with **systemd** keeping processes alive.

### A.1 Layout on the server

Example directories (adjust user/paths):

```text
/var/www/fserp/
  backend/          # Django project
  frontend/         # Next.js (built artefacts + node_modules for start)
```

Deploy flow:

1. Upload code (git clone, rsync, or CI artifact).
2. Python venv + `pip install -r requirements.txt` + `gunicorn` (add to requirements or `pip install gunicorn`).
3. `manage.py migrate`, `collectstatic`, create superuser.
4. `npm ci` (or `npm install`) in `frontend/`, set `.env.production` or export env, then `npm run build`.
5. Run **Gunicorn** and **`next start`** under systemd (or PM2 for Node only).
6. Configure **Nginx** server blocks for `api` and `app` hostnames.

### A.2 Backend (Django) on VPS

**1) Virtual environment and dependencies**

```bash
cd /var/www/fserp/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt gunicorn
```

**2) Environment file** — create `backend/.env` or `backend/env/.env` (see `backend/env/.env.example`):

```bash
DJANGO_SECRET_KEY='<long-random-string>'
DJANGO_DEBUG=false
ALLOWED_HOSTS=api.example.com,localhost,127.0.0.1
CORS_ORIGINS=https://app.example.com
FRONTEND_BASE_URL=https://app.example.com
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SESSION_COOKIE_SECURE=true
DJANGO_CSRF_COOKIE_SECURE=true
DJANGO_SECURE_HSTS_SECONDS=31536000
FSERP_APP_VERSION=1.0.0
```

**3) Database and static files**

```bash
export DJANGO_SETTINGS_MODULE=fsms.settings
python manage.py migrate
python manage.py collectstatic --noinput
```

Ensure the user running Gunicorn **owns** `db.sqlite3` and can write to `backend/media/` if you use uploads.

**4) Create users for the app** (see `backend/README.md`):

```bash
python manage.py create_superuser --username 'you@example.com' --password 'YourSecurePassword'
python manage.py create_default_company   # if you use this in your workflow
```

**Django `/admin/` vs API login (important):**

| What you use | Database table | Used for |
|--------------|----------------|----------|
| `python manage.py create_superuser` (this repo’s command under `api.management`) | `users` (`api.User`) | Next.js / `/api/auth/login` — JWT, ERP, SaaS UI |
| `python manage.py createsuperuser` (Django default, two words) | `auth_user` | Only `/admin/` (Django admin site) |

If you can sign in at `https://fsapi…/admin/` but the frontend gets **401** on `/api/auth/login/`, you almost certainly have a row in **`auth_user`** but not a matching **`api.User`** (or the password was never set with bcrypt in `users`). Fix on the server:

```bash
cd /path/to/backend && source venv/bin/activate
python manage.py create_superuser --username 'you@example.com' --password 'YourSecurePassword'
# If the user already exists in users but password is wrong:
python manage.py reset_password you@example.com
```

Use the **same username** you type in the app (often the email). Optional: `python manage.py ensure_saas_superuser --username you@example.com` if the role must be `super_admin`.

**5) Gunicorn (systemd)** — example unit `/etc/systemd/system/fserp-api.service`:

```ini
[Unit]
Description=FSERP Django API (Gunicorn)
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/fserp/backend
Environment="DJANGO_SETTINGS_MODULE=fsms.settings"
ExecStart=/var/www/fserp/backend/venv/bin/gunicorn fsms.wsgi:application \
  --bind 127.0.0.1:8001 --workers 3 --timeout 120
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fserp-api
```

Verify: `curl -sS http://127.0.0.1:8001/health/` (or `/api/health/` per your urls).

### A.3 Frontend (Next.js) on VPS

**1) Production environment** — before build, set (example `frontend/.env.production`):

```bash
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api
NEXT_PUBLIC_WS_URL=wss://api.example.com
```

Use **`https://`** and **`wss://`** in production to avoid mixed-content errors in the browser.

**2) Build and run**

```bash
cd /var/www/fserp/frontend
npm ci
npm run build
```

**systemd** example `/etc/systemd/system/fserp-web.service`:

```ini
[Unit]
Description=FSERP Next.js
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/fserp/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=always

[Install]
WantedBy=multi-user.target
```

`npm run start` runs `next start -p 3000` per `package.json`. Next binds to localhost by default; Nginx proxies to `127.0.0.1:3000`.

### A.4 Nginx (TLS + reverse proxy)

Obtain certificates (e.g. **Certbot** with Let’s Encrypt). Two server names:

**API** (`api.example.com`):

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    # ssl_certificate ... (Certbot paths)

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**App** (`app.example.com`):

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Training checkpoint:** Open `https://app.example.com`, log in, open DevTools → Network: API calls should go to `https://api.example.com/api/...` and return **200**, not **301** loops or CORS errors.

### A.5 VPS operations cheatsheet

| Task | Command / action |
|------|-------------------|
| Backend logs | `journalctl -u fserp-api -f` |
| Frontend logs | `journalctl -u fserp-web -f` |
| Deploy new code | pull → migrate → collectstatic → restart api → `npm run build` → restart web |
| Backup SQLite | Stop API briefly or use SQLite backup; copy `backend/db.sqlite3` off-server |
| Smoke test | `GET https://api.example.com/health/`, `GET https://api.example.com/api/version/` |

---

## Part B — cPanel deployment (shared hosting constraints)

cPanel varies by host: some offer **Node.js Selector** and **Setup Python App**, some are too limited for **two** long-running apps. Before promising a date, confirm with your provider:

- [ ] **Python 3.10+** application support (Passenger or `passenger_wsgi.py` / “Application Root”).
- [ ] **Node.js** version 18+ for the frontend **or** ability to run Node on a subdomain.
- [ ] Ability to map **two subdomains** (e.g. `api.` and `app.`) to two different apps.
- [ ] **SSL** (AutoSSL) for both subdomains.

If Node or Python app hosting is **not** available, the practical options are: **upgrade plan**, **use only VPS**, or **static export** (this project uses dynamic Next features; full static export is a separate change — do not assume it works without engineering review).

### B.1 Suggested cPanel topology

1. **`api.yourdomain.com`** → Python (Django) application root = `backend` (where `manage.py` lives).
2. **`app.yourdomain.com`** → Node.js application root = `frontend` (startup: `npm run start` after `npm run build`).

### B.2 Django on cPanel (typical flow)

1. Upload `backend/` (without `venv/` — recreate on server).
2. In **Setup Python App** (or equivalent):
   - Application root: directory containing `manage.py`.
   - Entry point: often `passenger_wsgi.py` **you add** in that folder, importing `application` from `fsms.wsgi` (your host’s docs take precedence — some use `passenger_wsgi.py`, others a `.htaccess` + handler).
3. Install dependencies in the panel’s virtualenv: `pip install -r requirements.txt gunicorn` (if the host runs Gunicorn themselves, follow their template).
4. Set **environment variables** in the Python app UI (same keys as VPS `.env`).
5. Run **migrations** via SSH or the panel terminal:

   ```bash
   python manage.py migrate
   python manage.py collectstatic --noinput
   ```

6. **`ALLOWED_HOSTS`** must include `api.yourdomain.com`.
7. **`CORS_ORIGINS`** must be exactly `https://app.yourdomain.com` (no trailing slash).

**SQLite on cPanel:** Keep `db.sqlite3` **inside** the application directory, **not** in a world-readable web folder. Set file permissions so only the app user can read/write.

### B.3 Next.js on cPanel (Node selector)

1. Upload `frontend/` (exclude `node_modules`; run `npm ci` on server).
2. In **Node.js App**:
   - Application mode: **Production**.
   - Document root / app root per host docs (often the folder with `package.json`).
3. Set **environment variables** in the panel **before** build:

   ```text
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com
   NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com/api
   NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com
   NODE_ENV=production
   ```

4. In SSH (app’s context):

   ```bash
   npm ci
   npm run build
   ```

5. Start command: `npm run start` (port is often assigned by cPanel — if so, use the port they give you and ensure the UI maps the subdomain to that app; you may need to set `PORT` in the environment).

**If the host does not allow custom ports:** you may only get **Apache/Passenger** fronting Node; follow the host’s Node deployment PDF line by line.

### B.4 cPanel pitfalls (trainees: tick these off)

| Symptom | Likely cause |
|---------|----------------|
| Login fails / 401 after redirect | Django **trailing slash** redirect dropping `Authorization` — frontend already normalizes slashes; ensure API base URL is correct |
| CORS error in browser | `CORS_ORIGINS` missing or wrong scheme (`http` vs `https`) |
| Blank page, wrong MIME for `/_next/static` | Reverse proxy not forwarding `/_next/` to Node |
| 500 on API | `DEBUG=false` hides details — check host error log; verify `ALLOWED_HOSTS`, DB path, permissions |
| SQLite “database is locked” | Too many workers or NFS; reduce workers or move to PostgreSQL on VPS |

---

## 3. Post-deploy verification (both targets)

1. **`GET /health/`** and **`GET /api/version/`** on the API host — see [`OPERATIONS.md`](./OPERATIONS.md).
2. **Login** from the frontend; load **Dashboard** and **Reports** (exercises JWT + CORS).
3. **HTTPS everywhere** — no mixed content (browser console).
4. **Backup:** copy `db.sqlite3` (and `media/` if used) on a schedule.

---

## 4. When to choose VPS vs cPanel

| Choose **VPS** when… | Choose **cPanel** when… |
|----------------------|-------------------------|
| You need predictable systemd + Nginx + logs | Host already provides managed Python + Node apps |
| You expect growth, PostgreSQL, workers | Traffic is low and SQLite is acceptable |
| You want one runbook for staging + prod | Budget is tight and the host’s stack is verified compatible |

---

## 5. Reference — env vars quick copy

**Backend** (production): `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `ALLOWED_HOSTS`, `CORS_ORIGINS`, `FRONTEND_BASE_URL`, optional TLS/HSTS vars — details in [`OPERATIONS.md`](./OPERATIONS.md) and `backend/env/.env.example`.

**Frontend** (at **build** time): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL` — see `frontend/.env.example`.

---

*Training tip: Do a dry run on a $5/month VPS before touching production cPanel; the VPS path maps 1:1 to Docker or a larger cloud later.*
