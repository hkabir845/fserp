# Follow-up application fixes — 2026-09-10

This review addresses reproduced defects in the current workspace. It does not certify that every possible application defect or outstanding product feature is resolved. Other work was being committed to this shared workspace during the review; existing changes were preserved.

## Changes

- Shop POS reversals retain the actual quantities removed, including items with no cost basis and items whose catalogue type changes later. Fuel void followed by delete restores stock only once (from the preceding fix).
- Meter reversal now handles rollover using the same movement helper as checkout. The helper locks the meter while calculating a wrapped reading, avoiding lost updates.
- A malformed shop or fuel line rejects the entire cart before posting. Invalid quantities, unknown shop items, invalid prices, and invalid discounts no longer produce a partial sale or silently substituted values.
- Loan repayment reversal uses the original journal accounts and station tags. Reversed repayments no longer count as interest paid; reversing accrued-interest settlement reopens a loan with interest still due. Reversal holds row locks and updates the journal and loan in one transaction.
- Account types cannot be changed through the chart API after journal lines exist for that account.
- Manual bill allocations validate the rounded values actually sent to the API, preventing a 100.00 split from being submitted as 99.99.
- Currency rounding handles numbers expressed in scientific notation without producing NaN.
- Invoice edit validates every line instead of silently dropping invalid lines.
- Partially successful aquaculture sale submissions keep only the failed lines available for correction and retry.
- ERP and Brain logout use a shared server logout and storage cleanup path, clearing the selected tenant and browser access token as well as local credentials. Navigation waits for the logout request; local cleanup still runs if the request fails.
- SKU valuation excludes live-fish catalogue head counts, which cannot be multiplied by per-kg costs. Draft and void invoice lines no longer contribute to its period sales metrics. Biological inventory remains separately reported through the GL.
- The books audit uses SKU valuation's actual reconciliation payload, includes opening control-account balances, and excludes future journals from an as-of comparison.

## Verification

- 62 targeted backend tests passed, including 20 new regression cases and related POS, invoice, loan, chart, valuation, and reporting tests.
- An additional 28-test run passed, including the internal aquaculture trade report sweep and updated stock reversals.
- Frontend production build passed (117 routes).
- Frontend lint passed; its existing large-file Babel notice is informational.
- `node frontend/scripts/test-financial-helpers.cjs` passed.
- `node frontend/scripts/test-session-logout.cjs` passed.
- Django system checks passed; migration check found no schema changes.
- Full-suite snapshot: 1,271 passed, 4 skipped, 1 failed in 18m30s. The run loaded the old `test_no_company_level_report_moves_on_an_internal_transfer` before another workspace change separated its FCR envelope from financial comparisons. Its failure listed nine aquaculture reports carrying expected transfer metrics. The updated test passed in the 28-test rerun above; a final reporting rerun is recorded below.

## Historical data still needs reconciliation

The connected database was inspected inside PostgreSQL read-only transactions. No stored balances or historical financial records were modified. No active inventory POS lines missing reversal evidence were found by the targeted query.

The corrected books audit found no missing GL postings, unbalanced journals, duplicate journal numbers, or cross-company journal-account references. It did find these control differences:

| Company | Check | Subledger | GL control | Difference |
| --- | --- | ---: | ---: | ---: |
| 1 | Inventory | 129,400.00 | 0.00 | 129,400.00 |
| 2 | Accounts receivable | 359,889.50 | -656,164.85 | 1,016,054.35 |
| 2 | Accounts payable | 6,914,687.13 | 5,392,661.58 | 1,522,025.55 |
| 2 | Inventory | 2,221,860.61 | 6,494,294.37 | -4,272,433.76 |

These differences do not establish which historical figure is correct. Real books require verified opening balances, payment allocations, purchase costs, and stock counts before any correcting entry or stock adjustment. A question about whether this is real or disposable demo data is pending. No reset or balancing entries were applied.

Machine-readable details: `followup-books-audit.json`.

Feature requests and operational items in the earlier audit backlog (such as full statutory tax workflows, approvals, attachments, credential rotation, and deployment) are not implied to be completed by these fixes.
