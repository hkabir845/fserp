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

Local validation used a freshly exported snapshot from the reachable `vps-sas` FSERP instance, restored to the isolated PostgreSQL database `fserp_entity_review_20261022`. Its latest posted journal is 21 September 2026, so it does not establish the contents of the public server on 19 October. The initial repair of two Head Office bills and 71 unassigned donation journals required 221 field updates; the newer explicit Head Office flag adds two source-field updates. Donation expense of 8,765 then reports under Adib Filling Station. Existing Mynuddin Pond feed sale COGS of 8,985,458.64 remains pond-tagged. Stock purchases no longer create duplicate pond expenses. The Charge-to consistency fix below also keeps non-pond vendor service charges in their station or Head Office GL rather than adding them again to pond Unallocated costs.

Review the report using the original start date and 19 October 2026 as the end date after applying on the current VPS database. Confirm the two Head Office bills, station donations, and pond input costs. Database snapshots and the detailed local preview, apply log, and report remain under ignored `backend/backups/` and are not committed to GitHub.

Validation: all nine tests in `test_income_expense_entity_repairs.py`, `test_income_expense_entity_register.py`, and `test_income_statement_site_entity_scope.py` passed. Frontend TypeScript and lint checks passed. The broader `test_entities_pl_aquaculture_expenses.py` suite has four existing failures (harvest recognition fixture and capitalization metadata expectations); the same four failures were reproduced with the original reporting helper before this change.

## Charge-to consistency update

Migration `0203` preserves an explicit Head Office selection on each bill line. The selected entity is authoritative for expense/inventory debits, payable credits, vendor payment allocations, bill-list filters and totals, purchase and vendor balance reports, and journal entity labels. Each entity's electricity bill stays with that entity. Vendor defaults and physical receipt location do not replace explicit Charge-to choices. Changing a line's entity clears stale pond/station metadata; mixed bills allocate payable and VAT to the charged entities.

The migration does not guess which historical blank lines were intended as Head Office. For existing mistakes, first correct the source bill's Charge to (or use the specifically reviewed repair above), then synchronize its posted accounting dimensions. Paid bills retain the existing protection against material edits.

After deploying the update with `bash scripts/deploy-vps.sh`, preview all posted bill entity repairs through the report date:

```bash
cd ~/fserp/fserp/backend
source venv/bin/activate
python manage.py sync_bill_charge_to_entities \
  --company-id 2 --through 2026-10-19 > charge-to-preview.json
```

Use `--bill-id N` (repeatable) to limit the scope. To apply after reviewing the JSON:

```bash
python manage.py sync_bill_charge_to_entities \
  --company-id 2 --through 2026-10-19 --apply > charge-to-applied.json
```

The historical command preserves each journal's account debit/credit totals and funding accounts while synchronizing the entity dimensions of bills and linked vendor payments. It reports incompatible mixed-entity line amounts or multiple payable/funding accounts in `skipped_bills`, leaving those bills unchanged for review. A second run should show zero changed bills. Inspect `skipped_bills` separately; zero changes does not mean that skipped records were repaired. Preview and apply logs stay on the server and are not committed.

In the isolated September snapshot, the sync changed 728 bill records and reported 40 mixed-entity bills for separate reconciliation. Every journal's debit and credit totals by account were unchanged. A second apply changed zero bills, and the income/expense sheet had no duplicate bill costs under Unallocated. The current October VPS dataset must be checked independently. The follow-up verification passed 55 targeted backend tests, frontend TypeScript, lint and frontend regression tests, including Charge-to changes from shared splits.
