# BDT reports and historical inventory

The final requested scope is BDT only. Foreign-currency journal and revaluation
additions were removed. Manual journal inputs reject foreign currency and non-unit
exchange rates before saving any lines.

In Reports > Inventory SKU valuation, select **Historical stock at period end**.
The closing date controls stock valuation and the GL comparison. The selected period
still controls sales and velocity. Existing integrations default to live valuation;
the API accepts `valuation_basis=historical`.

Historical stock uses dated openings, applied purchase receipts, physical sales
relief, posted adjustments, transfers, tank dips, consumption and customer returns.
A dated opening replaces earlier movements only when it equals the stock register
at that date. A conflicting opening is left unused, so the receipts and issues
remain the quantity. A tank dip is the measured volume at the end of that day;
later receipts and sales move the balance from there. Empty feed sacks follow
the sacks opened on feed issues and the sacks sold.
Purchase discounts, landed costs and recoverable input tax follow GL receipt rules.
Sales retain their posted COGS; returns retain the original quantities and costs.
Changing the current item cost does not rewrite those values. Displayed monetary
rows are rounded before totaling. Print and CSV include coverage warnings.

Migration `0202_inventory_cost_evidence` adds sales and return evidence fields.
It has been applied to the local configured PostgreSQL database. Remote environments
still require their normal migration and frontend deployment steps.

## Legacy records

Run `python manage.py audit_inventory_history --company-id N` for a read-only audit.
Use `--as-of YYYY-MM-DD` for another closing date. The optional
`--backfill-cost-evidence` stores only costs proved by existing posted journals.
Ambiguous multi-item legacy costs remain flagged. The command does not change stock,
opening balances, catalog costs or GL entries.

The local company 2 backfill stored 6,820 original cost snapshots. The final source
audit found 9 items requiring reconciliation in company 1 and 8 in company 2.
Details are in `backend/logs/inventory-history-review.csv`. Correct opening dates,
quantities and movement records must come from the stock register; no balancing
quantities have been invented. Missing station openings and other incomplete source
evidence remain explicit warnings. Zero-stock items need no artificial opening date.

Historical reconstruction reads the source documents currently saved. It cannot
recover deleted history or recreate an earlier report before backdated edits.
Current-day reconstructed quantities are checked against current stock as a diagnostic;
current stock never replaces a historical quantity. Reconcile coverage warnings and
the GL difference before relying on historical balances to close a period.

## Verification

Regression coverage includes report availability and accounting identities, inventory
movement and cost evidence, journal validation, period locks, and harvest lifecycle
recognition. Frontend checks cover financial helpers, session cleanup, navigation,
TypeScript and the production build. These are local checks, not remote deployment
or an authenticated browser acceptance test.

Final local verification on 18 October 2026: the broad backend selection passed
458 tests (`backend/logs/bdt-report-final.xml`); the additional current-stock
diagnostic regression passed separately. Frontend tests, TypeScript, production
build, Django system checks, migration drift and whitespace checks passed.
