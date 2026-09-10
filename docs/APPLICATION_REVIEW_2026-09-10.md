# Application review — 10 September 2026

Scope: current local Django backend and Next.js frontend in `I:/ITProjects/FSERP`. Reviewed invoice posting/editing/reversal, item stock eligibility, authentication, aquaculture consolidation, and Windows startup. Ran the full existing backend suite, frontend type checking, lint, and production build. This is not proof that every application bug has been found. Browser interactions, Android execution, and the deployed environment were not tested.

No application fixes were made in this review. Added reproduction tests and this report. The workspace already contained extensive changes, and some files changed during the test run.

## Findings

### 1. High — Editing a posted invoice reverses the new data instead of the original data

Location: `backend/api/views/invoice_views.py:472–518`; `backend/api/services/document_posting_lifecycle.py:130–156`.

The PUT handler saves the replacement total and deletes/recreates lines before calling rollback. Rollback therefore restores the replacement quantities and subtracts the replacement customer balance, rather than reversing the original sale.

API reproduction: start with 10 units, sell 3 at 300, then PUT a quantity of 5 at 300. The request returns 200. Actual stock is **7**, expected **5**. Actual customer balance is **900**, expected **1,500**. The edited invoice and its journals no longer agree with stock and the customer balance.

Fix direction: reverse the persisted original document inside the transaction before replacing its header or lines; then post the replacement.

### 2. High — Password changes do not revoke existing refresh tokens

Location: `backend/api/utils/auth.py:15–31`; `backend/api/views/auth_views.py:136–155`; `backend/api/views/password_views.py:493–496`.

JWTs contain username, token type, and expiry, without a password/session version checked against the user. Changing the password updates the password hash but leaves existing JWTs valid.

API reproduction: issue tokens, successfully change the password through `/api/auth/change-password/`, then submit the old refresh token to `/api/auth/refresh/`. Actual response is **200**, expected **401**. A previously obtained refresh token can continue minting access tokens until its seven-day expiry; access tokens are also unaffected by the password change.

Fix direction: include and validate a persisted credential/session version and increment it on password changes and resets.

### 3. High — Voiding a sale after an item-type change fails to restore stock

Location: `backend/api/services/invoice_stock_relief.py:52–70,143`.

Undo selects stock lines using the item's current type and cost eligibility, rather than recording which lines originally moved stock.

Reproduction: sell 3 units from 10, change the item to `non_inventory`, then reverse the invoice. Reversal reports success, but stock remains **7**, expected **10**.

Fix direction: retain the original stock movement details and reverse those independently of subsequent catalog edits.

### 4. High — Adding a cost after invoicing can create stock when the invoice is voided

Location: `backend/api/services/invoice_stock_relief.py:64–69,106–110,143–153`.

An invoice with no eligible stock lines is still marked `stock_relieved=True`. If its item later gains a cost, undo now treats the line as stock-relieved and adds its quantity.

Reproduction: an uncosted item starts at 10; invoice 3 units (stock stays 10); add item cost; reverse the invoice. Actual stock becomes **13**, expected **10**.

Fix direction: track actual movements per line; an invoice-wide flag cannot distinguish skipped lines from decremented lines.

### 5. High — Selling a costed service credits physical inventory

Location: `backend/api/services/gl_posting.py:709–725,1177–1200`.

`item_should_relieve_cogs` returns true for any item with a cost basis, including explicit services. Posting then uses the inventory/COGS journal path.

Reproduction: make the test item a service with cost 200 and invoice 3 units. An `AUTO-INV-*-COGS` journal credits shop inventory account 1220, although no inventory was sold. This understates inventory and misstates service costs. The item semantics in `item_catalog.py` explicitly describe services as not moving inventory.

Fix direction: exclude services from inventory relief; if service costing is required, use the appropriate service expense/accrual mechanism.

### 6. High — Migration 0178 marks already-voided POS invoices as stock-relieved

Location: `backend/api/migrations/0178_invoice_stock_relieved.py:19–21`.

The backfill updates every invoice whose number begins with `INV-POS-`, without filtering status. Existing voided invoices, whose stock was already restored, become eligible for another restoration when deleted through the normal cleanup path.

Reproduction: run the backfill against a void POS invoice with `stock_relieved=False`; it becomes **True**. The reproduction directly checks the bad migration state; the subsequent duplicate-restoration risk follows the cleanup and undo code.

Fix direction: backfill only documents with outstanding physical movements, accounting for status and historical behavior.

### 7. Medium — The production start script fails on Windows

Location: `frontend/package.json:18` (`start` script).

The script passes `${PORT:-3000}`, which is Unix shell parameter expansion. Windows npm's default shell passes it literally.

Reproduced by invoking the script's Next.js command with that literal argument. Next exits with: `argument '${PORT:-3000}' is invalid`. The `prestart` port-killing hook was deliberately not invoked for this check.

Fix direction: use a portable Node launcher that reads `process.env.PORT`, or a portable fixed default.

### 8. High — Consolidation never releases inter-pond profit after external sale

Location: `backend/api/services/internal_trade_elimination.py:69–75`; consumers in `backend/api/services/reporting.py`.

Code-reviewed finding, not an end-to-end reproduction. The elimination reports `unrealized_margin = cumulative internal revenue - cumulative internal COGS`. It does not consider whether the receiving pond subsequently sold the fish outside the company. External sale postings do not clear the internal 4245/5245 balances. Consequently, historic internal margin continues reducing consolidated biological inventory and profit even after the related fish leave the company.

Fix direction: track the remaining internally purchased stock/margin and release the elimination as the receiving pond sells or otherwise disposes of it. This also affects historical internal-trade records even though the dedicated transfer feature is currently disabled.

## Verification

- Frontend `tsc --noEmit --incremental false`: passed.
- Frontend `npm run lint`: passed (exit 0; Babel emitted a large-file notice).
- Frontend `npm run build`: passed.
- Original backend suite: **1,176 passed, 3 failed, 4 skipped**, 555.47 seconds.
- Rechecked the three affected test files after observing workspace changes: **11 passed**. The initial failures are not listed as current bugs. They concerned station-stock setup and automatic production-cycle expectations.
- Added `backend/tests/test_review_20260910.py`: **six targeted defect reproductions**. Running with `--runxfail` produced six assertion failures at the expected behavior checks, with no setup errors. These are intentionally marked strict `xfail` (AssertionError only) in ordinary runs to record outstanding defects.
- The reproduction module uses a separate test database name so it does not conflict with the main suite. No business-data mutation was required.

Reproduce the six defects from `backend`:

```powershell
..\.venv-local\Scripts\python.exe -m pytest tests/test_review_20260910.py --runxfail -q --tb=short
```

Logs are in `docs/application-review-20260910/`. The existing `ACCOUNTING_AUDIT_BACKLOG.md` contains additional historical/reported concerns; those were not blindly counted as confirmed findings here.
