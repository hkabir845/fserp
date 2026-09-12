# FSERP application audit — 12 September 2026

This review covered the local Django/PostgreSQL API, Next.js frontend, Capacitor Android
shell, deployment scripts, migrations, and automated checks. Existing uncommitted
aquaculture changes were preserved. This is a verified engineering review, not a claim
that every possible defect has been found or that the deployed service has been certified.

**Deployment follow-up:** release `d976fe1` is now running on the VPS. GitHub CI passed
all **1,373 backend tests with zero skips**, plus frontend and deployment checks.
Production backup restoration, migration 0194, preserved business-table row counts,
and public HTTP smoke checks passed. See `docs/DEPLOYMENT_ACCEPTANCE_2026-09-12.md`
for the active checkout, final backup, rollback details and remaining interactive checks.

## Changes made

| Problem | Result |
|---|---|
| CI started Django without its required PostgreSQL database | Added a PostgreSQL 16 service, health check, and isolated CI environment. CI also checks migration drift and runs the existing frontend regression scripts. |
| Invalid JSON encoding raised an exception; non-object JSON silently became an empty request | Shared request parsing returns HTTP 400 for invalid encoding, arrays, scalars, and null. Empty bodies remain supported. |
| Invalid tax rates silently became zero, negative rates were accepted, and non-finite values caused HTTP 500 | Tax-rate creation validates the amount, four-decimal precision, dates, date ordering, and tenant-owned tax ID before saving. |
| The tax UI allowed 100%, but the database could only hold 99.9999 | Migration 0194 widens the tax-rate field to hold 100.0000 and records four outstanding model-description changes. Existing values are retained. |
| Company management P&L removed harvest COGS, with no explicit ledger view | Added `basis=posted` to the income-statement API and an Accounting / Management selector for the company P&L. The existing management view remains the default. Posted accounting retains harvest COGS; pond operating detail remains available separately. |
| Management P&L reconciliation flags described the old ledger totals after the report changed them | The difference and reconciliation flag are recalculated against the displayed management net income. |
| Custom aquaculture categories were expensed even when mapped to capitalized inputs | Capitalization now includes tenant-defined categories, including inactive categories used by historical records. |
| Removing pond ledger income clamped a negative remaining subtotal to zero | Signed subtotals are preserved, preventing overstated management income. |
| Removing ledger rows without adding register rows left stale profit totals | Row removal now triggers recalculation of gross and net profit. Expense detail also consistently includes its total. |
| A net-loss message suggested resetting demo journals | Replaced it with guidance to review dates, reporting basis, and source transactions. |
| Deployment continued without a backup when pg_dump or DATABASE_URL was missing | Deployment now stops before migrations. The existing explicit `FSERP_SKIP_BACKUP=1` override remains available. |
| Setup documentation still described SQLite, unmanaged models, and Java 17 | Corrected PostgreSQL setup, migration ownership, environment-file location, and Android Java 21 / SDK 36 prerequisites. |
| Windows setup could report success after failed native install or migration commands | Setup now checks exit codes and stops on failure, and handles missing npm without calling Test-Path with a null path. |

## Reproductions and validation

- Before fixes, the new request-parser tests reproduced five failures. Tax API tests
  reproduced twelve failures, including saving invalid input as zero, accepting invalid
  dates, and failing to save 100%.
- Original backend suite: **1,324 passed, one failed, four skipped**. The failure concerned
  harvest COGS being removed by the company management report.
- Focused verification after fixes: **47 passed** across request validation, harvest
  accounting, aquaculture management reporting, and entity-scoped income statements.
  A subsequent harvest run with an additional reconciliation case passed **14 tests**.
- Deployment backup prerequisite tests: **2 passed**. Bash syntax validation passed.
- Frontend TypeScript, ESLint, production build (117 generated pages), financial rounding
  tests, and logout tests passed after the changes.
- HTTP smoke checks returned 200 for the home/login/password pages, apps, dashboard,
  invoices, tax, and aquaculture. Seventeen referenced assets/PWA endpoints returned 200.
  Login responses included frame, MIME-sniffing, and referrer-policy headers.
- Frontend production dependency audit and mobile dependency audit reported zero known
  vulnerabilities. Python `pip check` found no dependency conflicts; this is not a Python
  vulnerability audit. Mobile Capacitor configuration passed TypeScript checking.
- Django migration drift check passed. Deployment checks passed with explicit CI-style
  secret/email settings. The original local configuration warned about secret-key quality
  and missing SMTP; no production settings were inspected or changed.
- Android `assembleDebug` passed with a portable Microsoft JDK 21 downloaded into the
  ignored `.venv-local/tools/jdk21` directory. The existing Adib flavor was built; no
  flavor synchronization or distribution was performed. System Java settings were unchanged.
- Before the concurrent edits, the expanded backend suite passed **1,351 tests**, with
  **four skipped**. This result alone does not verify the subsequently combined changes.
- After resuming, six new management-report tests reproduced four failures and two passes.
  After fixes, all **31 focused tests passed**. The existing capitalization test now uses
  valid feed, medicine, and equipment categories. Frontend checks and build passed again.
- Resumed full backend suite: **1,360 passed, four skipped**, in 19 minutes 47 seconds
  (`backend/logs/application-audit-resumed-20260912.xml`). Invoice and bill line-ordering
  edits arrived from the other session during this run. A fresh affected-test run then
  passed **186 tests** against the latest invoice, bill, and aquaculture advice files
  (`backend/logs/application-audit-latest-ordering-20260912.xml`). These results are
  reported separately rather than claiming a full run against files edited mid-run.

## Reporting choice

The current management view combines register category detail with ledger totals and
honors the configured capitalization policy for pond inputs. The other session's changes
to retain harvest cost of sales and exclude capitalized categories were preserved and
rechecked. The posted view follows the application's recorded journal entries. Register
costs that have not been posted can produce different totals between the views. Use the
explicit Accounting view when reconciling posted profit; a management report should not
claim that differing totals reconcile. The new tests exercise that distinction without
rewriting historical business records.

## Reference comparison

- [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/):
  deployment-system checks, secret configuration, and environment review.
- [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers):
  runner port mapping and service readiness for the CI database.
- [IAS 2 inventory expense recognition](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/):
  reference for matching sold inventory costs to sales. This review does not assess the
  application's overall IFRS compliance or IAS 41 biological-asset valuation policy.
- [Capacitor 7 upgrade requirements](https://capacitorjs.com/docs/updating/7-0#upgrade-android-studio):
  Java 21 is required. The initial Android build reproduced `invalid source release: 21`
  under the PC's Java 17 installation.

## Remaining verification and rollout

Deployment preparation follow-up: added strict production preflight with SMTP
connection/authentication (no messages sent), removed automatic console-email
acceptance, required successful health/login checks, tightened backup permissions,
and added gzip integrity checking. Ten deployment regression tests pass. A local
fresh-database migration and SQL backup/restore rehearsal passed through migration
0194. See `docs/DEPLOYMENT_ACCEPTANCE_2026-09-12.md` for server acceptance and rollback.
Target-server configuration and deployment were subsequently verified; interactive
acceptance remains outstanding.

### Follow-up on the four skipped tests

All four skips were in `tests/test_brain_analytics.py`: three pond/FCR checks
required an existing pond, and the employee-list answer check required an existing
employee. The company fixture creates neither, so their conditional skips prevented
these checks from running. The tests now create isolated records explicitly instead
of relying on demo data. The complete Brain analytics module was rerun:
**43 passed, zero skipped**. This verifies all four formerly skipped cases; the full
suite count above remains the historical result from before this test-setup fix.

- No browser was connected, so interactive browser rendering, accessibility, mobile
  layout, and manual end-to-end user journeys remain unverified. HTTP page availability
  does not prove client-side behavior.
- No physical Android device/emulator session was exercised and no APK was published.
- The initial audit did not deploy or repair production records. The later authorized
  rollout applied migration 0194 after a fresh backup and restore rehearsal. No business
  data repair was performed; business-table row counts were preserved.
- The existing management reporting default was preserved; changing the default across
  company and entity reports remains a product/accounting choice.
- Large report-page size remains a maintainability concern: ESLint reports Babel's
  large-file notice for `frontend/src/app/reports/page.tsx` (over 500 KB).
