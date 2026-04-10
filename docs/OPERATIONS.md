# FSERP — Operations, releases, and multi-tenant policy

This document describes how we run FSERP in a **professional, multi-tenant SaaS** style: **one codebase**, **one deployment**, **no routine manipulation of tenant business data** when shipping features or fixes.

---

## 1. Product doctrine

| Principle | Meaning |
|-----------|---------|
| **Single application** | All companies use the same backend and frontend build. Behaviour changes ship to everyone together. |
| **Tenant isolation** | Data is scoped by `company_id` (and super-admin header where applicable). We do not merge tenant A’s data into tenant B. |
| **No data “upgrades” on release** | Standard releases change **code** (features, bugs, security). They do **not** bulk-edit customers, invoices, stock, dips, ledger balances, etc. |
| **Master Filling Station** | Development and QA baseline. It is not a sync source for production tenant **transactions**; use it to validate behaviour before deploy. |

Schema migrations may add tables or columns for **all** tenants; that is structural, not rewriting existing business rows. Avoid data migrations that mass-update tenant facts unless reviewed as a separate, documented change.

---

## 2. Release checklist

1. **Branch / tag** — e.g. `v1.5.0` aligned with `FSERP_APP_VERSION`.
2. **Tests** — `cd backend && pytest` (and frontend checks if you use them).
3. **Migrations** — `python manage.py migrate` in staging, then production.
4. **Build metadata** — set environment variables at deploy (see §4).
5. **Smoke test** — `GET /health/`, `GET /api/version/`, login, one company-scoped list (e.g. stations).
6. **Rollback plan** — previous container/image + DB backup before risky migrations.

---

## 3. Environment variables (backend)

| Variable | Purpose |
|----------|---------|
| `DJANGO_SECRET_KEY` | **Required in production.** Strong random secret. |
| `DJANGO_DEBUG` | `false` in production. |
| `ALLOWED_HOSTS` | Comma-separated hostnames. |
| `CORS_ORIGINS` | Comma-separated frontend origins when `DEBUG` is false. |
| `FSERP_APP_VERSION` | Semantic version string (e.g. `1.5.0`), exposed in `/health/` and `/api/version/`. |
| `GIT_COMMIT_SHA` | Optional short SHA for `/api/version/` traceability. |
| `DJANGO_SECURE_SSL_REDIRECT` | `true` when behind HTTPS terminator. |
| `DJANGO_SESSION_COOKIE_SECURE` | `true` in production HTTPS. |
| `DJANGO_CSRF_COOKIE_SECURE` | `true` in production HTTPS. |
| `DJANGO_SECURE_HSTS_SECONDS` | e.g. `31536000` when site is HTTPS-only (enable deliberately). |

---

## 4. Observability and support

- **`GET /health/`** and **`GET /api/health/`** — Liveness; include `version`.
- **`GET /version/`** and **`GET /api/version/`** — Build metadata: `version`, `commit`, `time_utc`, `debug`, `python` (no secrets).
- **`X-Request-ID`** — Every response echoes a correlation id (client may send `X-Request-ID`); use it when matching logs to user reports.

---

## 5. Security posture

- With **`DEBUG=false`**, Django enables baseline protections (`X_FRAME_OPTIONS`, `SECURE_CONTENT_TYPE_NOSNIFF`, etc.). Opt-in SSL redirect, secure cookies, and HSTS via env vars above.
- Frontend (Next.js) sets **X-Frame-Options**, **X-Content-Type-Options**, **Referrer-Policy**, and a conservative **Permissions-Policy** via `next.config.mjs`.
- **JWT** remains the API auth mechanism; keep tokens short-lived and rotate `SECRET_KEY` only with a planned logout/re-login window.

---

## 6. When a client needs something “special”

Prefer **configuration** (per-company settings or feature flags in the product) over **forking** the codebase. That keeps one deployable artefact and still avoids touching unrelated tenants’ business data.

---

## 7. Demo / seed data (non-production)

Management commands such as `seed_master_full_demo` populate **Master Filling Station** for local QA. Do not run destructive seeds against production without an explicit runbook and backup.

---

*Maintainers: keep this file aligned with actual deploy steps. Update version env vars on every production release.*

---

## 8. Hands-on deployment (Linux: cPanel & VPS)

Step-by-step training guide (Next.js + Django, SQLite default, Nginx/systemd on VPS, cPanel caveats): [`DEPLOYMENT_TRAINING_LINUX_CPANEL_VPS.md`](./DEPLOYMENT_TRAINING_LINUX_CPANEL_VPS.md).
