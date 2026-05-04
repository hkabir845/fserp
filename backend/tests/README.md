# FSMS backend tests

## Run

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

Uses **Django** + **pytest-django** (`DJANGO_SETTINGS_MODULE=fsms.settings`). A separate test database is created automatically.

## Scope

`test_api_production_audit.py` covers:

- Health and API docs stub
- Login, refresh token
- Super-admin-only routes (`/api/admin/companies/`)
- Tenant isolation via `X-Selected-Company-Id` (stations, companies/current)
- Invalid tenant header → 403 on scoped routes
- Company admin sees only their tenant’s stations
- Dashboard stats, customers list, dummy customer POST, items list

Extend this file (or add `test_*.py`) for new modules before production deploy.
