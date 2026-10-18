# Report and accounting review — 18 October 2026

**Final BDT scope:** historical inventory and report fixes are implemented; the
foreign-currency additions have been removed as requested. See
[BDT historical inventory](HISTORICAL_INVENTORY_BDT.md) for the current behavior,
local migration/backfill and outstanding source-data reconciliation. The sections
below record earlier review stages; this final scope supersedes their feature boundaries.

## Scope

Local PostgreSQL-backed automated checks and source review of reporting, posting,
financial rounding, and report exports. Tests use an isolated Django test database.
Production tenant balances and browser interactions were not audited in this review.

The checks cover registered report endpoints and permissions, trial balance and
balance-sheet identities, P&L/COGS reconciliation, AR/AP aging at historical dates,
cash movement reconciliation, entity filters, purchase/sales reports, inventory
valuation, period locks, and aquaculture accounting under the repository's locked
policy. Endpoint smoke tests establish availability; populated accounting tests
provide the separate evidence for numerical correctness.

## Changes

- Growth intervals now use the latest recorded sample for each date within a
  cycle/species. Previously, two observations on the same date invented a one-day
  interval and could distort daily growth and feed conversion. A regression checks
  duplicate dates, unordered input, exact growth, elapsed days, and FCR.
- The growth integration fixture now records actual feed consumption and separately
  records a warehouse purchase, verifying that purchased stock is not counted again
  as feed consumed.
- The inter-pond end-to-end fixture now supplies its agreed sale price explicitly.
  GL synchronization preserves agreed prices and defaults missing prices to cost;
  the fixture previously expected an unrequested margin.
- Live SKU valuation now compares with the current-date GL and discloses that date.
  Previously, selecting a historical sales period compared today's warehouse stock
  with that period's historical GL balance, creating a misleading discrepancy.
  The regression uses receipts in two months to verify matching measurement dates.
- Additional fixtures now provide the required production cycle for fish-related
  custom income and linked invoices for completed harvest sales. The FCR opening
  assertion uses the measured seine mean rather than a rounded frozen extrapolation.

## Boundaries and follow-up

- Passing automated tests cannot certify every dataset or every country's accounting
  and tax requirements. This review does not establish worldwide statutory compliance.
- Reports use a single company book currency; the report audit explicitly tests that
  there is no FX conversion layer. Multi-currency consolidation needs separate design.
- SKU valuation uses live quantities and current item costs, while period sales use
  the selected dates. It is not a historical inventory valuation; the GL comparison
  now explicitly uses the current date.
- The aquaculture cost model and inter-pond eliminations follow
  `AQUACULTURE_ACCOUNTING_POLICY.md`; do not change that policy to make an entity loss
  or accepted nursing surplus disappear.
- Production acceptance still needs representative tenant reconciliations, browser
  verification of filters/drills/printed exports, and jurisdiction-specific sign-off.
- Harvest recognition is now the same in standing stock, FCR, and cost per kg:
  a harvest counts only when it has a non-draft, non-void sales invoice and is not an inter-pond
  transfer mirror. A harvest record without an invoice stays in standing stock
  and is excluded from harvest kilograms and production gain.

## Follow-up: report defects only

The existing checkout already contained the shared harvest-recognition fix. Follow-up
verification found one remaining lifecycle gap: merely linking an invoice also counted
draft and void invoices as completed harvests. The shared rule now excludes both, so
physical stock, same-day opening heads, FCR harvest weight, and cost-per-kg denominators
agree. FCR coverage also explains exclusions caused by draft or void invoices.

Seven new lifecycle regressions cover no invoice, draft, void, sent, paid, partial, and
overdue invoices across all four consumers and the report's coverage metadata. The focused
regression run passed **51 tests**. A separate endpoint/core accounting run passed
**105 tests**, for **156 backend checks passed** in this follow-up. Frontend tests,
TypeScript validation, Django system checks, and diff whitespace checks also passed.
Historical inventory valuation and multi-currency accounting are outside this
follow-up, as requested. Changes have not been deployed by this review.

## Reproduce

Validation results:

- Initial endpoint/core accounting run: **105 passed**, including every registered
  report endpoint.
- Expanded selection: **418 passed, 3 failed** before fixture corrections. Each of
  those failures was subsequently included in the passing final regression run.
- Final regression run: **89 passed**, covering all changed areas, related FCR
  events and backlog repairs, tenant categories, business-line posting, accounting
  identities, report accounting audit, and report edge cases.
- Frontend `npm test`, TypeScript `--noEmit`, Django system check, Python compilation,
  and `git diff --check` passed.

The expanded selection was not rerun in full after edits; the final run targeted
the changed areas and their accounting dependencies. These counts overlap.

From `backend`:

```powershell
python -m pytest --reuse-db -q -k 'report or accounting or gl_posting or entity_gl or inventory_sku or business_line_accounting' --junitxml=logs/report-accounting-audit.xml
python -m pytest --reuse-db -q tests/test_aquaculture_bio_asset_growth.py tests/test_aquaculture_fcr_events.py tests/test_aqua_backlog_repairs.py tests/test_business_line_accounting_e2e.py tests/test_inventory_sku_valuation_filters.py
python manage.py check
```

From `frontend`:

```powershell
npm test
npx tsc --noEmit
```
