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

## All-date follow-up audit and repair

The follow-up audit examined 16,515 posted journals in the downloaded copy across its full date range. The 40 previously skipped bills had correctly allocated expense debits but incorrect payable credits. The updated repair recognizes those matching entity totals and preserves the existing debit lines while repairing the payable. It also repairs on-account vendor payments using their saved payment site. In the local copy, 45 vendor payment journals required entity corrections; journal debit/credit totals by account remained unchanged.

Three source bills explicitly describe Head Office: BILL-843 (transport 220), BILL-876 (electricity 4,611), and BILL-882 (internet 1,000). The follow-up includes all three, plus the previously reviewed unassigned POS donations.

Deploy the latest code normally, then run the reviewed company-2 workflow:

```bash
cd ~/fserp/fserp
bash scripts/review-income-expense-company2-vps.sh --apply
```

The script exports a database backup, applies the reviewed source corrections, syncs accounting tags through today in Asia/Dhaka, and audits all dates before and after. An optional `--through YYYY-MM-DD` limits the repair cutoff. Without `--apply`, it performs a read-only audit. Full logs are saved under ignored `backend/backups/entity-review-*/`. It supports either `backend/venv` or `backend/.venv`.

For a standalone read-only audit across all companies and all dates:

```bash
cd backend
python manage.py audit_income_expense_entities
```

Use `--company-id 2 --summary` for compact company output, or `--start-date` / `--end-date` to reproduce a particular report period. The audit checks bill and invoice entity tags, vendor payments, journal balance, Head Office description/tag conflicts, suspect dates, orphaned pond opening journals, and report totals for All vs individual non-pond scopes. It preserves the existing company inter-pond elimination policy.

Two historical exceptions in the downloaded copy need original records rather than an automatic reassignment: payment 84 (500, reference VND-10) and its journal are dated 0205-03-24; journal AUTO-POND-PL-OB-10 contains 9,517,865 of prior pond expense, but pond 10 and its source opening rows no longer exist. Its description mentions Ashari - 1 Pond, which now has another id; the audit flags this orphan instead of guessing that the opening should be moved or removed. Both remain unchanged by the repair script. Current VPS results may differ from this older snapshot.

Final local follow-up: all bill, invoice, and vendor-payment entity checks passed after the reviewed repairs. The orphaned opening and suspect year remain flagged. All eight report reconciliation checks passed, and 60 targeted backend tests passed.
