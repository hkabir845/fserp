# Application audit — bugs and gaps

Second audit pass, 2026-09-10. The first pass covered accounting correctness (see
`ACCOUNTING_AUDIT_BACKLOG.md`, 36 defects fixed). This pass covers everything that one did not:
repository hygiene, security and tenant isolation, the frontend, the fuel-station / HR / SaaS /
backup / AI modules, and functional gaps.

Findings marked **[verified]** were confirmed by me directly against the code. Findings marked
*[reported]* came from an audit pass with a code citation but were not independently re-checked —
confirm before acting. One finding was checked and **rejected**; it is listed at the end so nobody
re-raises it.

Severity is about consequence, not effort:

- **P0** — platform compromise, cross-tenant data access, or money silently wrong.
- **P1** — a control that should exist and does not.
- **P2** — real defect with contained blast radius.
- **P3** — gap worth planning for.

---

## P0 — fix before anything else

### S-1. Restore lets a tenant admin take over the platform **[verified]**
`api/services/tenant_backup.py:968` checks only the bundle's top-level `company_id`.
`_validate_restore_record_models:375` validates model *labels* only; `_prepare_restore_records:399`
`deepcopy`s records verbatim; then `:984` runs
`serializers.deserialize("python", ...).save()` — honouring every attacker-supplied `pk` and field.

`api.user` is a restorable model (`tenant_backup.py:161`) and `User` stores authority in
unconstrained fields (`api/models.py:320-331`: `role = CharField(default="user")`,
`password_hash`, `company_id = IntegerField`). `_user_can_restore` (`api/views/backup_views.py:47`)
admits any tenant **admin**, not just a platform super admin, and the confirmation phrase is a
constant published to any authenticated caller.

A tenant admin uploads a bundle containing an `api.user` row with `role: "super_admin"` and a
password hash they chose, and owns every tenant on the platform. The same primitive writes rows
carrying another company's `company_id`.

**Fix:** after deserializing and before saving, reject any record whose `company_id` is not the
target, any `pk` that resolves to a row outside the target, and any `api.user` row whose role is
outside `TENANT_USER_ROLES`.

### S-2. `GET /api/companies/<id>/` has no tenant scoping **[verified]**
`api/views/companies_views.py:593-606`. The `PUT` branch checks ownership at `:613`; the `GET`
branch checks nothing. Any authenticated user — a cashier — reads any company by id, returning
`legal_name`, `tax_id`, address, `email`, `phone`, `books_locked_through`, `subdomain`,
`fiscal_year_start`. Enumerate `id=1..N` to walk every tenant on the platform.

**Fix:** apply the same check the PUT branch already makes.

### S-3. The entire financial core has no permission checks **[verified]**
Counted directly: `has_permission` / `require_permission` appears **0 times** in each of
`journal_entries_views.py`, `chart_of_accounts_views.py`, `item_views.py`, `bill_views.py`,
`invoice_views.py`, `payment_views.py`, `loan_views.py`, `inventory_views.py`,
`fixed_asset_views.py`, `tax_views.py`, `vendor_views.py`, `hr_views.py`. For contrast,
`aquaculture_views.py` calls `_aquaculture_access` **62 times**.

`@require_company_id` resolves the tenant and authorizes nothing (`api/views/common.py:82`). So a
role whose only permission is `app.pos` can post journal entries, rewrite the chart of accounts,
change item prices, run and post payroll, settle net pay, and delete invoices, bills and payments.

**Fix:** a `require_permission(...)` decorator applied across the mutating endpoints in these
modules. Aquaculture is the working pattern to copy.

### S-4. Any tenant user can disable their company and unlock the books *[reported, high confidence]*
`api/views/companies_views.py:611` — same-company membership is the whole check for `PUT`, with no
role test. Unguarded writes include `is_active` (`:718`), `billing_plan_code` (`:748`),
`payment_amount` (`:740`) and `books_locked_through` (`:657` — the accounting period lock).
`{"is_active": false}` makes `tenant_company_allows_access` 403 every non-super-admin request for
that tenant: a one-request self-inflicted outage only the platform owner can undo.
A second path to the same billing fields exists at `subscription_portal_views.py:212`, also with
no role gate.

### S-5. Plaintext production SSH password committed to git **[verified]**
27 files under `scripts/` contain `c.connect(HOST, username="sas", password="<literal>")`; 43
`_vps_*` files are tracked, none ignored, all in committed history, and the repo has a GitHub
remote. **Rotate the credential regardless of repository visibility** — it is in every clone and
every fork of the history. Then purge from history and move to key-based auth.

### S-6. Live tenant data and password hashes committed **[verified]**
`backend/db_export.json` (1.0 MB, tracked) holds 1,533 records: **6 user accounts with bcrypt
hashes**, **29 bank accounts with account numbers**, 206 journal lines, 29 customers, plus a named
tenant's pond P&L. Also tracked: `scripts/_vps_audit_result.json` (a named tenant's financials),
`backend/login_response_hex.txt`, `backend/admin_verify.txt`, `backend/api.zip`.
`backend/.env` *is* correctly ignored and `frontend/.env` holds only public `NEXT_PUBLIC_*` config.
**Fix:** `git rm --cached`, `.gitignore`, rotate all six passwords, purge from history.

### S-7. Default super-admin credentials in a committed script *[reported]*
`backend/create_superuser.bat:2` — `superuser@fserp.com` / `Admin@123`. Verify whether that account
exists in production and rotate or disable it.

### F-1. Money rounds the wrong way in the browser **[verified numerically]**
`frontend/src/utils/currency.ts:210` — `roundToDecimals` documents itself as "half-up via
`toFixed`", but `toFixed` rounds the binary double. Measured both sides:

| input | browser | ledger |
|---|---|---|
| 1.005 | **1.00** | 1.01 |
| 2.675 | **2.67** | 2.68 |
| 1.015 | **1.01** | 1.02 |
| 10.075 | **10.07** | 10.08 |

Not display-only: it reaches API payloads through `formatAmountPlain`
(`admin/subscription-billing/page.tsx:544` → `payment_amount`) and `roundToDecimals`
(`aquaculture/transfers/page.tsx:973` → weights, `payments/EditPaymentModal.tsx`).
**Fix:** explicit half-up (`Math.sign(n) * Math.round(Math.abs(n)*10**d + Number.EPSILON) / 10**d`),
or send raw values and render only server-returned strings.

### F-2. POS checkout has no in-flight guard **[verified]**
`frontend/src/app/cashier/page.tsx:1104` — `canCompleteUnifiedSale` contains no busy flag, and the
file contains **zero** occurrences of any `submitting`/`posting` state. The same handler is bound to
F9 and Ctrl+Enter (`:685`). A double-click or held key on a slow link posts two invoices, two GL
postings, double stock depletion. The same gap exists on invoices, bills, fund transfers and loan
disburse/repay. The correct pattern already exists in
`components/payments/PaymentReceivedForm.tsx:698` (guard + `Idempotency-Key`) and is used on only
two endpoints.

---

## P1 — missing controls

### C-1. No audit trail anywhere **[verified]**
No `AuditLog` model. Only **2 of ~120 models** carry `created_by`. Meanwhile **40 endpoints
hard-DELETE**, six of them financial documents (invoices, bills, payments, journals, fixed assets,
loans). You cannot answer "who deleted this payment", "who posted this journal", or "who changed
this price".

### C-2. A request-body flag hides fuel shrinkage from the books **[verified]**
`api/views/tank_dip_views.py:212` and `:245`:
`skip_gl = bool(body.get("skip_variance_gl") or body.get("skip_gl"))`. On an endpoint with no
permission check, any authenticated user records a dip that moves tank stock — and therefore
`Item.quantity_on_hand` and the valuation report — with **no journal and no record that the
bypass happened**.
**Fix:** require an elevated permission, persist `gl_skipped_by` / reason on the row, and surface
skipped dips on the wet-stock report.

### C-3. A POS sale racing a shift close is silently dropped from the drawer **[verified]**
`api/services/shift_sales.py:37` and `:71` — the `.update()` is filtered on
`closed_at__isnull=True`. If the manager closes between shift resolution and the write, it matches
zero rows with no exception and no log, yet `Invoice.shift_session` still points at that shift.
Cash is in the drawer, the sale is attributed to the shift, and `expected_cash_total` never rose —
the variance is understated by exactly that sale.
**Fix:** return the row count and fail the sale loudly with a 400 when it is 0.

### C-4. No document attachments anywhere **[verified]**
Zero `FileField` / `ImageField` in the entire model layer. There is no way to attach a vendor
invoice, a bank slip, a delivery challan, or a dip sheet to the transaction it evidences.

### C-5. Production accounting data repaired by ad-hoc scripts **[verified]**
40+ committed one-off scripts (`_vps_digonto_*`, `_vps_p05_reconcile_apply.py`,
`_vps_restore_lease.py`, …) write directly to live books with no review, no test and no audit
trail. This is a process finding, and it is a likely source of the ledger drift the first audit
found.

### C-6. Unpaid tenants are never restricted *[reported]*
`payment_end_date` is written in four places and read only for display;
`SubscriptionLedgerInvoice.status` gates nothing; `subscriptions_my_subscription` returns
`"status": "active"` as a hardcoded literal. Plan limits (stations, users) are declared and never
enforced.

### C-7. Rate limits bypassable via `X-Forwarded-For`, no per-account lockout *[reported]*
`api/utils/rate_limit.py:22` takes the first XFF hop verbatim with no trusted-proxy depth. Login
counts by IP only — there is no per-username failure counter — so a fresh spoofed header per
request gives unlimited credential stuffing. `rate_limit_exceeded` also fails **open** on cache
errors.

### C-8. Wildcard-subdomain CORS with credentials on a CSRF-exempt cookie refresh *[reported]*
`fsms/settings.py:280` allows `^https://[a-zA-Z0-9-]+\.mahasoftcorporation\.com$` with
`CORS_ALLOW_CREDENTIALS = True`, a `SameSite=None` refresh cookie, and a `@csrf_exempt` refresh
endpoint that reads the token from the cookie. Any page on any subdomain — another tenant's portal,
a dangling DNS record — can mint an access token for whoever is signed in.

---

## P2 — real defects, contained

- **F-3.** Invoice edit silently drops zero-price lines and reports success — the create path has
  the parity guard, the update path does not. `invoices/page.tsx:902`. *[reported]*
- **F-4.** A one-paisa-imbalanced journal passes the client check **[verified]**:
  `Math.abs(3.01 - 3.00) < 0.01` is `true` in float (`journal-entries/page.tsx:490`). It saves as a
  draft and fails at post time days later.
- **F-5.** Pond/station cost splits lose cents between validation and payload — three shares of
  33.333 validate against 100.00 but send 99.99 (`lib/billAllocation.ts:172` vs `:250`). *[reported]*
- **F-6.** Three logout paths clear different keys and none clears
  `superadmin_selected_company`, so on a shared terminal the next user inherits the previous
  entity. *[reported]*
- **F-7.** Reference dropdowns hard-cap at 500 rows with no server-side search — a tenant with more
  than 500 items cannot select the rest, with no message. `lib/pagination.ts:34`, 33 call sites.
  *[reported]*
- **F-8.** Aquaculture sale: a partial multi-line failure discards the user's unsaved lines
  (missing `return`). `AquacultureSaleFormModal.tsx:488`. *[reported]*
- **B-1.** Meter rollover is unhandled — no `max_reading` field anywhere; a wrapped register gives a
  hugely negative delta, and a mid-shift reset discards the pre-reset value. *[reported]*
- **B-2.** Tank dip clamps the physical reading to capacity but posts the **unclamped** variance to
  the GL. *[reported]*
- **B-3.** `DELETE /api/employees/<id>/` has no guard; `EmployeeLedgerEntry` and payroll
  allocations are `CASCADE`, so the subledger is erased while its journals survive. *[reported]*
- **B-4.** Deleting forecourt hardware hard-deletes the Island→Dispenser→Meter→Nozzle subtree and
  nulls `InvoiceLine.nozzle`, destroying historical sales attribution. *[reported]*
- **B-5.** Shift close is a read-check-write race with a full-row overwrite, losing concurrent
  `F()` increments; no partial unique constraint prevents two open shifts on one station.
  *[reported]*
- **B-6.** POS silently discards unparseable cart lines and charges for the rest, returning 201.
  *[reported]*
- **B-7.** A shift closed without counting cash reports `cash_variance: 0`, indistinguishable from
  a balanced close. *[reported]*
- **B-8.** The AI advisor reports month-to-date revenue **including draft and voided invoices**,
  labelled "quoted numbers are authoritative". *[reported]*
- **B-9.** `User.company_id` — the field every tenant check compares against — is a bare
  `IntegerField`, not a ForeignKey: no constraint, no index; a reused company pk silently grants
  access. *[reported]*
- **B-10.** Missing unique constraints on `Employee.employee_code`, `Customer.customer_number`,
  `Vendor.vendor_number`, `Item.item_number`, `Station.station_number` — uniqueness is a racy
  read-then-write in the view. *[reported]*
- **B-11.** Zero test coverage for the entire shift lifecycle — `ShiftSession` appears in 2 of 193
  test files. Every shift defect above sits in untested code. *[reported]*

---

## P3 — functional gaps (each verified as zero references)

Purchase orders · goods receipt / three-way match · budgets · customer statements & dunning ·
approval workflows / segregation of duties · cost centres · asset revaluation · price-change
history.

Multi-currency is absent **by design** (one `currency` per company, no FX table) — a constraint,
not a defect, for a BDT-only business.

---

## Rejected after checking

**"Bill review total omits truck transport."** Raised as CRITICAL. It is not a defect:
`apply_bill_truck_transport` (`api/services/vendor_purchase_terms.py:418`) writes the deduction
into each line's `amount` server-side (`pl["amount"] = net`), so the server's subtotal is already
net of truck and matches what the screen shows.

---

## Controls modernization (2026-09-10, follow-up)

Shipped in code (migration `0189_audit_controls_uniques_indexes_meter` and related views):

- POS idempotency on invoices (already in `0188`) + tests
- Page permissions on financial modules + tank dips
- Cookie refresh Origin allow-list + per-account login failure throttle + trusted-proxy XFF depth (`FSERP_NUM_PROXIES` / `NUM_PROXIES`)
- Append-only `FinancialAuditEvent` with void/unpost reasons on invoices, bills, journals
- PROTECT on employee ledger + forecourt hardware FKs; DELETE soft-deactivates stations/islands/dispensers/meters/nozzles/tanks
- Company-scoped unique codes for station/item/customer/vendor/employee
- Non-negative CheckConstraints on invoice/bill/payment/journal amounts
- Reporting indexes on invoice/bill/payment dates
- Meter `max_reading` + rollover helpers; Brain LLM call moved outside `transaction.atomic()`
- Sensitive `db_export.json`, `_vps_*`, default-superuser bat removed from the git index (rotate any exposed credentials outside the repo)

Still open product work (not a same-day patch): bank reconciliation, credit/debit notes, sales/purchase returns, refunds, bad-debt, fiscal close, full VAT/WHT/Mushak, POs/GRN/3-way match, approvals, attachments, budgets, dunning, full history purge of leaked secrets, production SMTP verify, staging migrate of Adib DB.

Quantified against a realistic 3-year tenant: 200 chart accounts, 2M journal lines, 150k invoices,
2,000 customers, 5,000 SKUs, 40 ponds.

### P-1. An LLM HTTP call runs inside `transaction.atomic()` **[verified]**
`api/views/brain_views.py:237` wraps `append_user_and_assistant_resilient` — which reaches
`gateway.py:166` with `OPENROUTER_TIMEOUT=120`, `retries=2`, plus a fallback model. Worst case
**480 seconds of blocking HTTP with an open write transaction**. Each in-flight Brain chat pins a
PostgreSQL backend as `idle in transaction`; ~100 of them exhaust the cluster and **every POS sale
in every tenant fails on connect**. It also holds the snapshot open, blocking autovacuum on the
busiest tables.
**Fix:** build the reply first, then open a short transaction around only the `BrainMessage` writes.

### P-2. `invoice`, `bill` and `payment` have never received a single index *[reported]*
Verified across all 184 migrations: no `AddIndex` has ever targeted these tables. Only Django's
automatic FK columns exist, and in a single-tenant database `company_id` selects ~100% of rows — so
every date-ranged sales report, aging run, cash-flow report and the dashboard is a sequential scan.
Migration 0177 did exactly this work for the GL tables; the document tables were never given the
same treatment.
**Fix:** one `AddIndexConcurrently` migration for `(company_id, invoice_date)`,
`(company_id, customer_id, invoice_date)`, `(company_id, bill_date)`,
`(company_id, vendor_id, bill_date)`, `(company_id, payment_date)`.

### P-3. The income statement writes journal entries from a GET *[reported]*
`reporting.py:1604` calls `backfill_invoice_cogs_journals` from a `@require_GET` endpoint, running
one `exists()` per invoice in the period plus inserts for each miss — ~50,000 queries on a 1-year
P&L before a number is rendered, and two analysts opening it at once race the same inserts.
(The first audit already stopped this posting COGS for *voided* invoices; the GET-writes-GL
architecture remains.)

### P-4. Four N+1s where the batched implementation already exists in the same file *[reported]*
Balance sheet at `reporting.py:860` runs one full-history aggregate **per chart account** (~200 per
report, 20–60 s) while `_bs_totals_company:3301` does the same job in one query via
`_movements_by_account`. A/R aging (`:2302`) is ~2,000 + 150,000 queries and never uses the
prefetch hook `total_allocated_for_invoice` checks for. The customer list
(`customer_views.py:125`) rebuilds every party's all-time subledger **twice per row** — ~450,000
queries to render 50 rows — while the denormalized `current_balance` column it already sorts on
sits unused. GL account statement (`journal_statement.py:158`) runs 2 queries per line with no
date bound.

### P-5. Four ABBA deadlock pairs on the hottest write paths, no retry anywhere *[reported]*
Pond↔station stock, bill-receipt↔POS-sale (the hottest pair), transfer A→B vs B→A, and payment
allocations iterated in **client payload order**. No `OperationalError` handler exists, so each
surfaces as a 500.
**Fix:** impose one global lock order and `sorted()` the id lists — ordering changes with no
semantic effect.

### P-6. Unlocked read-modify-write on loan principal and AVCO item cost *[reported]*
`loan_views.py:1314` reads outstanding principal *outside* the transaction and writes an absolute
value: two concurrent repayments both pass the check and the loan lands wrong, permanently, with no
error. `gl_posting.py:766` recomputes AVCO without `select_for_update`, so the later bill wins and
one receipt vanishes from the weighted average — which then flows into every subsequent COGS
journal.

### P-7. Tenant backup builds the whole tenant in memory as one indented JSON string *[reported]*
`tenant_backup.py:860` — no `.iterator()`, then a sanitized copy, then `indent=2`, then `.encode()`.
At 2M journal lines this is several GB held simultaneously: **OOM on any realistic mid-size tenant.**

Also reported: chart-of-accounts list runs three `COUNT(DISTINCT)` joins over the 2M-row line table
to compute one boolean; report payloads embed one JSON object per source document unbounded (~40 MB);
serializers re-query lines per row and discard the prefetch the list just paid for; `_coa()` is
uncached and called ~68 times per posting; exactly **one** `bulk_create` exists in the codebase.

---

## Regression found and fixed during this audit

**My migration 0177 turned a silent duplicate into a 500.** Adding the unique constraint on
`(company, entry_number)` was correct, but three manual journal-creation paths allocate the number
with `max(suffix)+1` and then `save()` with no `IntegrityError` handling —
`journal_entries_views.py:399`, `aquaculture_views.py:5000`,
`aquaculture_financing_service.py:299`. Before 0177 a race silently produced duplicate numbers;
after it, the second user got an uncaught 500.

Fixed: `save_with_sequential_code` in `api/services/reference_code.py` retries in a savepoint,
mirroring the recovery already in `gl_posting._create_posted_entry`. Applied to all three sites;
25 targeted tests pass.

## Suggested order

1. **S-5 and S-6 today** — rotate the SSH credential and the six exposed passwords. Everything else
   can wait a day; a leaked production credential cannot.
2. **S-1, S-2, S-4** — each is a single-function authorization change with platform-wide blast
   radius.
3. **S-3** — the permission decorator rollout. Largest piece of work here, and most of the
   fuel-station and HR findings inherit from it.
4. **F-1, F-2** — the two that make money wrong or duplicated on screen.
5. **C-1, C-2, C-3** — the controls whose absence is corrupting numbers right now.
6. **P-1 and P-2** — the LLM transaction is the single most likely cause of a total outage, and the
   index migration is pure upside with no code change.

---

# Third pass — data reconciliation, out-of-request-path code, statutory, test confidence

## Real damage found in the live dev database (read-only reconciliation)

15,924 journals / 32,540 lines / 6,710 invoices checked. **Clean:** zero unbalanced journals, zero
journals without lines, zero duplicate entry numbers, zero lines with both a debit and a credit,
zero negative amounts, zero negative stock, zero posted documents missing a journal. The ledger
mechanics hold.

**Broken, with numbers:**

- **A/R control account is negative 656,164.85.** `AUTO-INV` debits 1100 by 7,074,904.15;
  `AUTO-PAY` credits it by 7,731,069.00. Receipts exceed everything ever invoiced. This is the
  "receipt credited to A/R with no invoice behind it" defect in real money — advances landing in
  A/R instead of a liability.
- **A/P control disagrees with open bills by 1,522,025.55.**
- **16 customers' stored `current_balance` has drifted** from their open documents (one shows
  520,361.45 stored against 64,278.45 open).
- **Inventory valuation is not comparable to the inventory GL.** `Item.quantity_on_hand × cost`
  gives 208.2M against 15.3M in 1200+1220+1581 — because fish SKUs store a *head count* in
  `quantity_on_hand` (Tilapia Fry: 1,329,999) and a per-kg cost. The app's own SKU valuation report
  multiplies exactly those two fields, so it reports a number ~13× the ledger for an aquaculture
  tenant. Fish must be excluded from qty×cost valuation; they are valued via 1581.

**Corrected:** I first reported the balance sheet out by 24,448. It is not — that is account 2410,
typed `loan`, which my reconciliation script did not bucket. The app handles it correctly.

## Period lock was bypassable — FIXED

`assert_period_open` was enforced in exactly one place (`gl_posting._create_posted_entry`). Two
paths build a `JournalEntry` by hand and set `is_posted = True` themselves:
`aquaculture_views.py` (pond profit transfer) and `aquaculture_financing_service.py`. A backdated
transfer restated closed books and the entire period-lock suite stayed green.

Fixed in both, plus `tests/test_period_lock_all_posting_paths.py` — including a **guard test that
fails when any new hand-rolled posting path omits the lock**. Also fixed: fund transfers marked the
document posted and bumped register balances *before* posting the journal, with no transaction.

## Out-of-request-path code (management commands + migrations)

- `assign_customers_to_master.py:25` — `Customer.objects.all()[:12]` reassigned to "master", no
  scoping, no dry-run. Silently breaks two tenants' A/R.
- `digonta_nursing_reconcile.py:89` — deletes posted expenses by *amount equality* without
  unwinding their journals; falls back to "lowest-id aquaculture tenant" when `--company-id` is
  omitted.
- `fix_digonto_growout_pl.py` — `--company-id` **defaults to 2**, deletes ledger entries by
  hardcoded PK.
- **Not one management command respects the period lock** (`grep` across the whole directory).
- Several default to *all tenants*: `clear_fish_pond_warehouse_stock`, `resync_tank_dip_variance_gl`
  (no dry-run at all), `normalize_chart_account_types` (moves accounts between statements).
- Migration `0178`'s reverse is not the inverse of its forward: a routine rollback/replay resets
  every invoice's `stock_relieved` and only restores POS ones.
- **My migration 0177 lacks `atomic = False`** — three indexes on the two largest tables inside one
  transaction holds `ACCESS EXCLUSIVE` for the whole run. Worth fixing before it ships.

## Bangladesh statutory (most consequential first)

1. **POS sales book zero output VAT** — `cashier_views.py:590` hardcodes `tax_total=Decimal("0")`.
   For a VAT-registered station whose volume is overwhelmingly POS, output VAT is systematically
   understated.
2. **`Tax`/`TaxRate` are decorative** — the 15% rate exists as a row nothing reads. No invoice,
   bill or POS path consults a rate.
3. **Tax is header-only and additive-only** — no line-level tax, so mixed-rate documents are
   impossible and VAT-inclusive (MRP) pump pricing cannot be represented.
4. **Input VAT is a residual plug**, not derived from a rate — a purchase with VAT folded into line
   prices posts nothing to the rebate account.
5. **Mushak 6.1 / 6.2 / 6.3 and VDS: entirely absent.** No challan document, no registers, no
   withholding-at-source mechanism.
6. **TDS: absent** — no field on Bill/BillLine/Payment; 2120 is never posted to.
7. **PF and gratuity: absent.** One undifferentiated deduction pool means NBR tax and PF cannot be
   remitted separately.
8. **`fiscal_year_start` has exactly one consumer, and it is not `reporting.py`** — every report is
   calendar-year. A July–June company cannot produce a fiscal-year statement.
9. **Duplicate account code 4244** — biological count gains post to "Empty Sacks & Scrap Sales".
10. **Fixed-asset disposal gains default to "Interest Income — Loans Receivable"**.
11. **All fuel grades collapse into 4100** — 4110/4120/4130/4140 are seeded and never posted to, so
    per-grade margin analysis is impossible.

## Where the test suite gives false confidence

- **144 tests (~12%) are the same status-200 smoke test, duplicated across two files**, run against
  an empty company. They prove 72 report endpoints don't 500 on no data.
- **4 tests skip unconditionally every run** (guarded on data the fixture never creates).
- **COA `account_type` can be changed asset→income with journal lines present**, unguarded and
  untested — silently rewrites every historical statement while the trial balance still ties.
- **`reverse_loan_repayment` is asymmetric with `post_loan_repayment`** — reversing an
  accrual-settling repayment leaves the accrued liability wrong and interest expense negative.
- **Subscription billing has literally zero tests**; float money arithmetic, no proration,
  `payment_end_date` never enforced.
- **Nothing compares a subledger total to its GL control account** — the test that looks like it
  does compares Invoice-derived to Invoice-derived. That is exactly why the 656k A/R gap above went
  unnoticed.
- **No inventory-GL invariant exists at all.**
- `test_bill_void_and_purpose.py:62` wraps its assertions in `if had_je:` — when the fixture lacks
  the COA the test degenerates to a status check and passes on broken reversal logic.
- `payment_detail_update_delete` (the whole edit/delete endpoint), `reverse_payment_made_posting`,
  bank deposits, bill DELETE, and `remove_system_entry` purge of non-payroll `AUTO-*` journals all
  have **zero** coverage.
