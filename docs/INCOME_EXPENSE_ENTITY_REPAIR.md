# Income and expense entity corrections

Deploy the code normally, including frontend build and backend migrations. The reporting fix excludes shop inventory purchases from unallocated pond operating expenses; the receiving pond retains the cost recorded by sale COGS or consumption. POS donations now preserve the selected station without requiring a shift.

GitHub carries code, not database changes. Apply the historical entity repair separately on the VPS, after taking the normal database backup. Do not restore the older review snapshot over the live database.

From the backend directory, using the deployment's Python environment:

```bash
python manage.py repair_income_expense_entities \
  --company-id 2 --through 2026-10-19 \
  --head-office-bill-number BILL-876 \
  --head-office-bill-number BILL-882 \
  --donation-station-id 2 > entity-repair-preview.json
```

Inspect the JSON, then run the same command with `--apply` and save its output as `entity-repair-applied.json`. The command changes only station dimensions on the selected source bills and their posted journals, and on previously unassigned POS donation journals through the report date. It never changes amounts, dates, inventory quantities, or pond dimensions. It validates company ownership and refuses conflicting tags. It is atomic and idempotent; a second apply should report zero changes.

The two selected bills in the reviewed snapshot are electricity for Head Office (4,611) and internet for Head Office (1,000). A separate transport bill, BILL-843 (220), also describes Head Office but was left untouched because the request identified two expenses. It can be included with another `--head-office-bill-number` argument after reviewing it.

Local validation used a freshly exported snapshot from the reachable `vps-sas` FSERP instance, restored to the isolated PostgreSQL database `fserp_entity_review_20261022`. Its latest posted journal is 21 September 2026, so it does not establish the contents of the public server on 19 October. The snapshot's two Head Office bills and 71 unassigned donation journals required 221 field updates. Donation expense of 8,765 then reports under Adib Filling Station. Existing Mynuddin Pond feed sale COGS of 8,985,458.64 remains pond-tagged. Unallocated feed/medicine stock purchases disappear; genuine unallocated service costs remain for separate allocation from supporting records.

Review the report using the original start date and 19 October 2026 as the end date after applying on the current VPS database. Confirm the two Head Office bills, station donations, and pond input costs. Database snapshots and the detailed local preview, apply log, and report remain under ignored `backend/backups/` and are not committed to GitHub.

Validation: all nine tests in `test_income_expense_entity_repairs.py`, `test_income_expense_entity_register.py`, and `test_income_statement_site_entity_scope.py` passed. Frontend TypeScript and lint checks passed. The broader `test_entities_pl_aquaculture_expenses.py` suite has four existing failures (harvest recognition fixture and capitalization metadata expectations); the same four failures were reproduced with the original reporting helper before this change.
