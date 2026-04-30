# FSERP: Multi-site operations, GL scope, and deployment

This runbook is for **operators, auditors, and deployers**. It aligns behaviour across **single-site preference**, **active stations**, and **reporting/POS**.

## 1. Active sites vs `station_mode` (saved preference)

| Concept | Meaning |
|--------|---------|
| **`Company.station_mode`** | **Preference**: `single` = at most one *active* station allowed by the product rules; `multi` = several active sites allowed. **New companies default to `single`.** Only a **platform Super Admin** can change this value. |
| **Active station count** | **Runtime**: number of rows in `station` with `is_active=true` for the tenant. **POS scope, inter-station transfers, cashier report access**, and many filters use this count—not `station_mode` alone. |
| **API** | `GET /api/companies/current/` returns `station_mode`, `active_station_count`, and `can_edit_station_mode`. |

**Implication:** A company can be `station_mode=multi` with only **one** active site. Transfers that need two sites still fail until a second site is active. The UI explains “preference” vs “active sites” on **Stations** and **Company profile**.

## 2. Minimum one active station

While the company has **any** station rows, **at least one** must stay **active**. Deactivating the last active site, adding only inactive sites when none are active, or deleting the last active row (when other rows exist) is **blocked by the API**. On deactivate, **User.home_station**, **Customer.default_station**, **Vendor.default_station**, and **Employee.home_station** pointing at that site are **repointed** to another active site (lowest id).

**Fallback:** If code ever calls `get_or_create_default_station` and **no** active station exists, the server may **create** an active row named `"Default"` and **log a warning**—investigate tenant setup rather than relying on this silently.

## 3. Reports and `station_id`

- Station-scoped reports call `effective_report_station_id`: **cashier/operator** with **0** active sites → **403**; with **>1** active and **no** `home_station` → **403** (must assign home station); with **1** active → that site is used automatically.
- **Admins / accountants** may pass `?station_id=` or header `X-Selected-Station-Id` where supported; empty often means **all sites** (see each report in the app).
- Automated smoke: `tests/test_deploy_multisite_smoke.py` (five reports + inter-station shop transfer draft with two active sites). Cashier/POS paths are additionally covered in `tests/test_api_production_audit.py`.

## 4. Shifts, POS, and `home_station`

**Opening a shift** (`POST /api/shifts/sessions/open/`):

- **More than one active site** → **`station_id` is required** (active station for this register).
- **Exactly one active site** → `station_id` may be omitted; the server sets it to that site automatically.
- **Inactive** `station_id` is rejected.

This keeps shift/POS/cash drawer data tied to a real location.

If a user has **`home_station`** set, POS sales must match that active station (`enforce_pos_home_station`). If home points to an **inactive** station, POS/report paths return **403** until an admin fixes **Users → Home station**.

## 5. Customer payments and `Payment.station`

`Payment.station` is derived from allocations and defaults. **API rule:** one receipt **cannot** be posted through `/api/payments/received/` to settle invoices on **different** sites (returns **400**); split by site in the UI.

**After posting** (or when rebuilding register metadata), `resolve_payment_station_id` sets the header for reporting as follows:

- One invoice site → that site.
- All allocated invoices have **null** station → company default active station.
- Multiple invoice sites → **customer `default_station`** if it matches one of those sites; otherwise **lowest station id** among the invoices (deterministic register primary; still reconcile by invoice).

**Recommended process:**

1. Prefer **one payment per selling site** when possible.
2. Set **customer default station** so cross-line reporting picks the intended site when the API allows a single combined payment in other flows.
3. Use **payment memo** for anything auditors must know beyond the header.

## 6. Data hygiene: invoices without a station

Some legacy rows may have `invoice.station_id` **NULL**. “Sales by station” and similar analytics can misclassify them.

**Audit (all tenants):**

```bash
cd backend && python manage.py audit_station_data
```

**Per company:**

```bash
python manage.py audit_station_data --company-id 1
```

**SQL (example):**

```sql
SELECT COUNT(*) FROM invoice WHERE station_id IS NULL;
```

**Optional backfill (server):**

```bash
cd backend && python manage.py backfill_invoice_station --company-id 1 --dry-run
python manage.py backfill_invoice_station --company-id 1 --execute
```

Uses: active **customer.default_station** when valid, else **lowest active station id**. Review `--dry-run` output before `--execute`.

## 7. Chart of accounts and GL (optional station dimension)

**`JournalEntry` and `JournalEntryLine` may carry `station_id`** on auto-posted flows (invoices, bills, POS, payments, tank dips, payroll when `PayrollRun.station` is set, inter-station inventory transfers, etc.) so **trial balance, income statement, balance sheet**, and **financial analytics** can filter to one site via `station_id` / `X-Selected-Station-Id` / home station rules (see §3).

**Manual journals:** The API accepts optional **`station_id`** on the entry and per line; the Journal Entries UI can set a default site for new lines. Untagged lines remain **company-wide** for reporting filters that only include matching `station_id`.

**Statements:** `GET /api/chart-of-accounts/<id>/statement/` (and bank register statements backed by a GL account) accept optional **`?station_id=`** and date bounds. Responses include **`opening_balance`** and **`ending_balance`**: company-wide statements roll forward from chart **`opening_balance`** plus journal activity **before** `start_date` when given; **site-only** filters include tagged lines only, use **zero** opening when no `start_date`, and with **`start_date`** use the net on that account+site **before** the range (sub-ledger roll-forward). Lines with **null** `station_id` never appear in a site-only statement.

Site-level economics still also come from **operational documents** (invoice `station`, bill `receipt_station`, shifts, tank/nozzle data, `ItemStationStock`, etc.).

## 8. Payroll and loans (entity-level)

- **Payroll GL** (`post_payroll_salary`): books **company-wide** accounts; optional **`PayrollRun.station`** is for **management / attribution**, not a second GL axis.
- **Loans:** Optional **`Loan.station`** (`station_id` on create/update) tags **auto-posted** disbursement, repayment, accrual, and reversal journals for **segment / site reporting**; settlement still uses the loan’s **settlement** chart account. Omit the field for **pure treasury / entity-level** loans (unchanged behaviour).

## 9. Production deployment checklist

- [ ] Database: **PostgreSQL** (or equivalent), migrations applied, **backups** scheduled, **restore drill** done.
- [ ] `DJANGO_SECRET_KEY` (32+ chars), **`DEBUG=False`** in production.
- [ ] `ALLOWED_HOSTS`, **`CSRF_TRUSTED_ORIGINS`**, **CORS** allowlist match real browser and API origins; **HTTPS** end-to-end.
- [ ] Do not run production on committed **`*.sqlite3`**; keep dev DB out of git.
- [ ] **Rate limiting** or **WAF** on `/api/auth/` and similar.
- [ ] **Structured logging** and log retention; error alerting.
- [ ] Run **`python -m pytest`** (full suite) on the same stack you deploy.

## 10. External integrations (bank, tax, e-invoice)

Not governed by this repo alone. For each integration:

- [ ] Secrets in env / vault, **rotation** plan.
- [ ] **Webhook** signature verification and **idempotency** keys.
- [ ] Timeouts, retries, and **dead-letter** handling for failed posts.
- [ ] **HTTPS** only; no secrets in URLs or client-side code.

---

**Related:** `docs/LOAN_MODULE.md` · `backend/fsms/settings.py` (module docstring) · `api/services/station_scope.py` · `api/services/station_policy.py`
