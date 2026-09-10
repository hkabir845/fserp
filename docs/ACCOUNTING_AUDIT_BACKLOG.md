# Accounting & business-rule audit — findings backlog

Audit date: 2026-09-10. Scope: `backend/api` (GL, AR/AP, inventory, payroll, loans, fixed
assets, tax, reporting, aquaculture).

Each item says what is wrong, what it does to the books, and where. **Confidence** is either
`verified` (the defect was read end-to-end and, where noted, reproduced by a test) or
`reported` (found by an audit pass and cited, but not yet independently confirmed — confirm
before fixing).

Priorities:

- **P0** — the books are wrong *right now*, silently.
- **P1** — the books can go wrong: a missing guard, a race, a control gap.
- **P2** — a missing capability that forces users into a wrong workaround.
- **P3** — scale and hygiene. Only matters once the numbers are right.

---

## Done (2026-09-10)

| Defect | Effect | Fix |
|---|---|---|
| Contra-assets signed by normal balance then **added** to assets | Assets overstated by 2× accumulated depreciation; absorbed by the Σ-ADJ plug | `reporting.py` `_ending_balance_from_movement` signs by balance-sheet bucket |
| Item edit re-capitalized bill-received stock as opening stock | Inventory **and** equity overstated by the full stock value | `item_views.py` `_item_stock_already_capitalized` guard |
| Output VAT booked to revenue when account 2100 was missing | Tax collected for the authority recognised as income; no liability | 2100 auto-provisions; posting refuses rather than plugging tax into revenue |
| Invoice create / PUT / status / DELETE not atomic | Invoice committed as "sent" with no journal; PUT destroyed all lines before validating replacements | `transaction.atomic()` + validate-before-delete + `_InvoiceEditRejected` |
| Loan repayment expensed interest a second time | Interest expensed twice; accrued-interest liability never cleared | `unsettled_accrued_interest()` splits the payment between accrual and expense |
| Void invoices counted as receivable | A/R and A/P subledgers disagreed with the control accounts | `invoice_open_amount`, `contact_ledgers` exclude `void` |
| Account drill-down included unposted journals | Drill-down could not reconcile to the trial balance above it | `journal_statement.py` filters `is_posted=True` throughout |
| Viewing the income statement posted COGS for **void** invoices | Inventory relieved against reversed revenue, from a GET | `backfill_invoice_cogs_journals` and both post paths exclude `void` |
| Dashboard counted draft + void invoices as revenue | The headline number was wrong | `dashboard_views.py` excludes draft/void |
| Manual depreciation amount uncapped | Assets depreciable below salvage; book value negative | 400 when the amount exceeds `depreciable_remaining` |
| No DB uniqueness on `(company, entry_number)` | Concurrent posts → two journals for one document | Migration `0177` + `IntegrityError` recovery; ledger indexes added |
| Unbounded balancing plug into revenue | Header/line mismatch silently invented revenue | Capped at 0.02, matching the bill builder |
| Vendor credits / rate cards absent from tenant backup | Silent data loss on backup + restore | Added to `tenant_backup` list, serialiser, purge and presence check |
| Harvest blocked by sub-gram rounding in derived biomass | A pond could not sell its own recorded stock | Tolerance equal to the 6 dp average-weight rounding envelope |
| Inventory adjustment / transfer committed stock even when its journal failed | Back-dating into a closed period moved stock, marked the document posted, then raised | Journal call moved inside `transaction.atomic()`; `StockBusinessError` → 400 |
| Un-posting a bill or invoice left its journal, A/P bump and A/R behind | Subledgers exclude draft/void, so the control accounts silently stopped matching | Explicit un-post branches; `_validated_bill_status` rejects unknown statuses instead of coercing to draft |
| Supplier credit reduced A/P even when the journal came back `None` | Vendor balance fell with nothing behind it in the ledger | One transaction; refuses rather than moving A/P without a journal |
| Payment reversal skipped the period lock | A receipt inside closed books could be deleted | `assert_period_open` on both `reverse_payment_*_posting` |
| `return` inside `transaction.atomic()` committed a half-unwound reversal | Latent; live as soon as reversal could fail | `_PaymentReversalRejected` raised, not returned |
| Party opening balances posted no journal at all | An opening entered on the Customers/Vendors screen never reached GL 1100 / 2000 | `apply_customer_opening_gl` / `apply_vendor_opening_gl` wired into CRUD; a changed opening now re-posts; 1100/2000/3200/4230 auto-provision |
| Wet-stock and stock-count variances valued at the **selling price** | A count gain capitalised unearned margin into the inventory asset | `item_inventory_cost_strict` on every GL valuation path; explicit `item_cost_zero` skip |
| Fuel `Item.quantity_on_hand` never decreased | The mirror of tank stock only ever rose, so valuation and POS availability were overstated by life-to-date sales | `refresh_item_quantity_on_hand_from_tanks` after POS, dips, tank edits and invoice rollback |
| Manual invoices relieved inventory in the GL but never moved stock | The control account drifted credit and the same units could be sold again | New `invoice_stock_relief.py` + `Invoice.stock_relieved` (migration 0178); applied on post, unwound on void/edit/delete; per-line evidence in 0179 |
| Inter-pond sales posted to ordinary harvest revenue (4240) | Elimination never saw them — the report printed "No inter-pond trade" while the whole margin sat in group profit | Sales and bio-relief to a pond counterparty route to 4245 / 5245 |
| Inter-pond margin was eliminated permanently | Once the buying pond sold the fish on, that profit was real but consolidated income never got it back, and 1585 wrote down inventory that was gone | Elimination is now proportional to internal-sourced biomass still on hand; realized margin flows back into consolidated profit |
| Bio-asset cost/kg divided by `max()` of the candidate bases | A pond with 900 kg sold and 1,000 kg held relieved 90,000 instead of 47,368 | `production_denominator_kg` — sold **plus** still held |
| The costing window opened on 1 January | A March harvest of fish fed since October was priced from January's costs alone | `pond_production_start_date` opens the window at the pond's first production cost |
| Customer-facing document numbers reused deleted numbers | A reissued tax-invoice number makes two documents indistinguishable in the audit trail | `next_sequential_code` (`max(suffix)+1`, computed in the database) for **invoices, journals and subscription invoices**. Vendor bills deliberately keep gap-filling: a bill number is our internal handle for the vendor's document, not a series issued to anyone. The gap scan now filters to matching codes instead of loading every row |
| Deactivating a party removed them from aging while their documents stayed in the ledger | GL 1100 / 2000 silently stopped matching the party list, with an untraceable reconciliation difference | `_reportable_customers` / `_reportable_vendors` keep anyone still owing money |
| `payments/made/` had no idempotency key | A client timeout on a slow disbursement paid the vendor twice | Same header/body key, lookup and `IntegrityError` recovery the received side already had |
| `JournalEntryLine.account` was `CASCADE` | Deleting a chart account outside the API took its journal lines with it, unbalancing every entry they belonged to | `PROTECT` (migration 0181) |
| JWTs survived a password change | A stolen refresh token kept minting access tokens for seven days | Credential version in the claims, validated on both access and refresh *(fixed by the parallel session)* |
| Duplicate allocation rows for one document each passed the balance check separately | 100 + 100 against a 100 invoice passed, then the second insert hit the unique constraint as an uncaught 500 | Rows are summed per invoice / per bill before the balance check |
| `VendorSchemeReserve` absent from tenant backup | Silent data loss on backup + restore, same class as the vendor-credit gap | Added to the model list, serialiser and purge |
| Walk-in receipts credited 1100 with no subledger | GL A/R drifted from the customer list | `walkin_ar_payment_error` on received create/edit |
| AP payments and payment edits validated allocations without a row lock | Concurrent disbursements / edits could overpay | `select_for_update` on bills (create/edit) and invoices (edit), matching AR create |
| No `posted_by` on journals | "Who posted this journal?" was unanswerable | Nullable `created_by` / `posted_by` on `JournalEntry`; `auth_required` context; AUTO journals pick up the request user |
| Depreciation reverse left the month blocked and revived disposed assets | Could not re-run the month; disposed assets returned to ACTIVE | Reverse skips reversed runs, restores `last_depreciation_date`, refuses disposed assets |
| Disposal left cost/accum on the register | Register overstated vs GL | Shared `book_value()`; register cost and accum cleared after the disposal journal |
| Loan closed at zero principal with unpaid accrued interest | Interest stranded; further repayment/accrual rejected | Close only when principal **and** unsettled accrual are ~0; interest-only repay still allowed on a closed loan |
| Same month could be accrued twice | Interest expense doubled | `period_year` / `period_month` + unique unreversed constraint; API 400 |
| Site trial balance reported unbalanced without explanation | Managers thought the books were wrong | Synthetic "Due to / from Head Office" balancing line |
| Negative bin qty clamped to zero; item PUT wrote QOH | Stock vanished / appeared with no journal | Negative qty refused; item PUT and tank PUT refuse quantity changes (use Adjustments / Dips) |
| Chart `opening_balance_date` ignored | Historical BS included future openings | Openings dated after `as_of` are excluded |
| Bill tax expensed to 6900; no VAT return | Input VAT unrecoverable; no working paper for a BD return | Bill `tax_total` → 1170; `vat-return` report ties 2100 vs 1170 to the GL |
| `BrainCompanySettings` absent from tenant backup | Silent data loss on restore | Added to expected models, serialiser and purge |
| Payroll ledger GET ran subset-sum | Wrong payees and timeouts | GET uses stored allocations only; combinatorial inference is off the read path |
| Payroll never debited 2200 / 2210 | Accrue-now / pay-later impossible; deductions piled up | `mode=accrue` credits 2200; settle Dr 2200; remit Dr 2210 |
| Manager with `app.backup` could wipe a tenant | Restore is destructive | Tenant restore is Admin (or super admin) only |

Baseline 1153 passed / 2 failed → **1185+ passed / 0 failed**, plus 38 new regression tests across
`test_accounting_audit_regressions.py`, `test_accounting_audit_wave_a.py`,
`test_balance_sheet_contra_asset_sign.py`, `test_invoice_stock_relief.py`,
`test_inter_pond_margin_realization.py` and `test_bio_asset_cost_basis.py`.

---

## P0 — the books are wrong right now

### ✅ DONE — A0-1. Non-POS invoices post COGS but never move stock — *needs a decision*
`api/views/invoice_views.py` contains no stock handling at all; only `cashier_views.py`
decrements. `post_invoice_cogs_journal` still relieves inventory for any line with an
inventory item, so a manual invoice credits the inventory asset while quantity on hand stays
put. The same stock can be sold repeatedly and the inventory control account drifts credit.
**Confidence: verified.** The fix is correct accounting but changes an existing workflow — the
owner decides whether manual invoices should relieve stock or be blocked from selling stocked
items.

### ✅ DONE — A0-2. Inter-pond trade elimination is never released — *needs a decision*
`internal_trade_elimination.py` returns cumulative 4245/5245 margin as `unrealized_margin`,
with nothing tracking whether the buying pond has since sold the fish externally. Once it
does, consolidated profit stays understated by the full margin forever and the 1585 contra
writes down biological inventory that is already gone. Compounding it,
`FISH_POND_TRANSFERS_ENABLED = False` means today's documented pond-to-pond path is an
ordinary sale posting to **4240**, which the elimination never nets — so the income statement
prints *"No inter-pond trade in this period"* while 100% of the margin sits in group profit.
**Confidence: verified** (the flag and the code path; the accounting consequence follows).

### ✅ DONE — A0-3. Bio-asset cost/kg divides by `max()` of candidate denominators
`aquaculture_transfer_cost.py:296` takes the largest of {period sale kg, on-hand kg, this
line's kg} rather than sold + still held. A pond that spent 100,000 on 900 kg sold and 1,000
kg held relieves 90,000 instead of 47,368 — COGS over-relieved by ~43k and standing biomass
carried at a fifth of cost. Feeds every `AUTO-AQ-SALE-*-BIO` journal. **Confidence: reported.**

### ✅ DONE — A0-4. Accumulated biological cost resets every 1 January
`aquaculture_transfer_cost.py:61` starts the costing window at `date(year, 1, 1)`. A March
harvest of fish fed since October is relieved at a cost/kg built from January onward only.
**Confidence: reported.**

### A0-5. `Item.cost` overwritten by last bill rate with no revaluation journal
`bill_item_catalog_sync.py:172` discards the AVCO result by design (an owner decision), but
nothing posts the offsetting entry. Receipts debit inventory at bill value while COGS credits
it at the *current* cost, so the control account systematically diverges from `qty × cost` and
can go credit while quantity is positive. **Confidence: reported** (the write-back is
confirmed; the GL consequence follows).

### A0-6. Bill tax and freight expensed; bill discounts break the cost basis
✅ DONE (tax + AVCO scale). `_build_bill_journal_lines` now debits **1170** for `tax_total`.
Receipt AVCO uses the scaled line value when a header discount makes `total < sum(lines)`.
Landed cost (freight, duty as a true add-on) is still not capitalised (IAS 2 §11) — that
remains a product decision. **Confidence: verified.**

### ✅ DONE — A0-7. Fuel `Item.quantity_on_hand` never decreases
`cashier_views.py` and `tank_dip_views.py` write `Tank.current_stock` only; the item-level
resync runs solely on bill receipt. For fuel SKUs the field only ever rises, and the
company-wide valuation report reads exactly that field. **Confidence: reported.**

### ✅ DONE — A0-8. Tank-dip variance valued at the selling price when cost is zero
`item_inventory_unit_cost` falls back to `unit_price`, so a wet-stock gain **debits inventory
at retail**, capitalising unrealised margin into the asset. `item_inventory_cost_strict`
exists for this and is not used. **Confidence: reported.**

### ✅ DONE — A0-9. Payroll never debits 2200 / 2210 — *feature, not a patch*
`post_payroll_salary` now supports `mode=accrue` (Cr **2200** net, Cr **2210** deductions)
and `mode=pay` (cash basis, unchanged default). `settle_payroll_net_pay` Dr 2200 / Cr bank;
`remit_payroll_deductions` Dr 2210 / Cr bank. Employee opening payables / manual HR ledger
(A0-10) still do not hit the GL. **Confidence: verified.**

### A0-10. Manual employee ledger entries post no GL — *feature, not a patch*
`hr_views.py:481` is the only way to record a staff advance or recovery; it moves
`Employee.current_balance` and the HR ledger with zero journal impact. Account 1150 is
referenced only by opening balances. **Confidence: reported.**

### ✅ DONE — A0-11. Stock adjustments commit even when their journal fails
`inventory_views.py:1058` calls `post_inventory_adjustment_journal` **outside** the
`transaction.atomic()` that already wrote the stock and set status POSTED. Back-dating into a
closed period changes physical stock, marks the document posted, and raises — no journal, no
rollback. Same shape for transfers at `:735`. **Confidence: reported.**

### ✅ DONE — A0-12. A posted bill silently reverts to `draft`
`_normalize_bill_status` coerces any unrecognised status to `"draft"`. Draft is neither `void`
nor eligible for posting, so no branch fires: the journal and the A/P bump stay while the
vendor subledger drops the bill. **Confidence: reported.**

### ✅ DONE — A0-13. Vendor credits reduce A/P even when the journal fails
`vendor_purchase_terms.py:613` decrements `Vendor.current_balance` regardless of whether
`_post_vendor_credit_journal` returned `None`. **Confidence: reported.**

### ✅ DONE — A0-14. The invoice status endpoint can void or un-post without reversing
`sync_invoice_gl` short-circuits on `draft`/`void`, so `sent → void` through
`PUT /api/invoices/<id>/status/` leaves the sale journal, the COGS journal and the customer
balance bump in place. **Confidence: verified** (the short-circuit; the endpoint is now atomic
but still takes this path).

### ✅ DONE — A0-15. Party opening and current balances are writable with no GL
`customer_views.py:323` and `vendor_views.py:299` accept `opening_balance` and
`current_balance` straight from the request. `apply_customer_opening_gl` exists but is called
only from the aquaculture views. **Confidence: reported.**

---

## P1 — the books can go wrong

- **A1-1.** ✅ DONE — Payment delete/edit hard-deletes a posted journal with **no period check** —
  `reverse_payment_*_posting` has none, unlike the bill and invoice cleanups. A receipt inside
  a closed period can be erased. *verified*
- **A1-2.** ✅ DONE — A receipt against the Walk-in customer credits 1100 A/R with no subledger
  counterpart; `walkin_ar_invoice_error` guards invoices but not payments. *verified*
- **A1-3.** ✅ DONE — Allocation validation has no row lock — concurrent receipts can overpay;
  a duplicated row 500s. In-request duplicates and AR create locks were already in; AP create
  and AR/AP edits now lock the document row inside the atomic. *verified*
- **A1-4.** ✅ DONE — `payments/made/` has no idempotency key (the received side does) — a retry
  duplicates a vendor disbursement. *reported*
- **A1-5.** ✅ DONE — `return` inside `transaction.atomic()` in `payment_views.py` commits the partial
  reversal it is reporting as failed. Latent today; live as soon as A1-1 is fixed. *reported*
- **A1-6.** ✅ DONE — Invoice numbering **reuses deleted numbers** (`first_free_suffix`) and scans the
  whole invoice table per POS sale. Reuse breaks the tax-invoice series. *verified*
- **A1-7.** ✅ DONE (journals) — `JournalEntry.created_by` / `posted_by` record the request user
  on create and post (including AUTO journals). Invoice / bill / payment header attribution
  and an append-only audit log are still open. *verified*
- **A1-8.** ✅ DONE — `ChartOfAccount` → `JournalEntryLine` is `on_delete=CASCADE`. The view guards
  deletion, but a shell, admin or data migration would silently unbalance the ledger. *verified*
- **A1-9.** ✅ DONE (GET path) — Payroll ledger GET no longer infers payees by subset-sum.
  Combinatorial matching remains for legacy POST sync of runs without stored allocations —
  that is still an audit hole if those runs exist. Accrue-now / pay-later (A0-9) is done
  for payroll runs; opening employee payables (A0-10) are still open.
  *verified*
- **A1-10.** ✅ DONE — Depreciation reversal restores `last_depreciation_date`, ignores reversed
  runs in `run_exists_for_period`, and refuses to reverse a disposed asset. *verified*
- **A1-11.** ✅ DONE — Disposal uses shared `book_value()` and clears cost / accum on the register
  so it matches the GL. *verified*
- **A1-12.** ✅ DONE — A loan stays active until outstanding principal **and** unsettled accrued
  interest are ~0. Interest-only repayment is still allowed on a closed loan that was closed early.
  *verified*
- **A1-13.** ✅ DONE — Accruals carry `period_year` / `period_month`; the same unreversed month
  cannot be posted twice. *verified*
- **A1-14.** ✅ DONE — Aging and party-balance reports filter `is_active=True`, so deactivating a
  customer with open invoices removes them from the subledger while the GL keeps them — an
  untraceable reconciliation difference. *reported*
- **A1-15.** ✅ DONE — Site-scoped trial balance injects a synthetic Due to / from Head Office
  line and sets `scope_balanced_via`. *verified*
- **A1-16.** ✅ DONE (negative qty) — Negative station/pond stock is refused instead of clamped.
  `move_all_shop_stock` still relocates an unchanged total (that is a transfer of existing qty).
  *verified*
- **A1-17.** ✅ DONE — Item PUT and tank PUT refuse on-hand / current_stock changes. Opening qty
  on create still posts through the existing opening-stock path. *verified*
- **A1-18.** ✅ DONE (date gate) — Chart openings dated after `as_of` are excluded from BS and
  control-account balances. The opening is still one-sided (no automatic OBE journal) — that
  remains a P2 if users type openings on the chart instead of using the party/item opening flows.
  *verified*

---

## P2 — missing capability

- **A2-1. Input VAT is expensed, and no VAT return can be produced.** ✅ DONE (GL working paper).
  Bill header tax now debits **1170** VAT Input; `GET /api/reports/vat-return/` sums 2100 vs 1170.
  Not a Mushak e-file, not a TaxRate FK engine, and withholding 2120 is still unused.
  *verified*
- **A2-2. No credit notes, debit notes, sales returns, refunds, settlement discounts or
  bad-debt write-offs.** A return can only be handled by editing or deleting the original
  invoice; a customer discount makes the receipt fail allocation validation. *verified*
- **A2-3. No year-end close / retained-earnings roll-forward.** Equity shows one lifetime
  Σ-P&L line. Typing last year's profit into `3100.opening_balance` (the natural user action)
  double-counts it — and it still balances, so nothing flags it. *verified*
- **A2-4. The cash flow statement is neither direct nor indirect** and its three figures do
  not tie to each other or to the GL. ✅ DONE — direct-method IAS 7 sections; see
  `test_cash_flow_statement.py`. *verified*
- **A2-5. The tax module is disconnected** — `Tax` / `TaxRate` have no FK from any document,
  `Item.is_taxable` is never read, tax is a free-typed header amount. *verified*
- **A2-6. No bank reconciliation** (statement matching) — only batch deposits. *verified*
- **A2-7. FCR ignores harvest, mortality and restocking between samples**, biasing the farm's
  main operational KPI in both directions. ✅ DONE (harvest + mortality/loss + transfers +
  stocking + manual adjustments). *verified*

---

## P3 — scale and hygiene

- **A3-1.** Balance sheet issues one aggregate query **per chart account** (~150 round trips);
  `_movements_by_account` already exists and is used correctly elsewhere. Same shape in
  liabilities detail, loan GL reports, party balances, inventory reconciliation. *reported*
- **A3-2.** AR/AP aging walks the company's entire payment history with a per-payment
  aggregate. *reported*
- **A3-3.** `build_statement_transactions` runs 2 extra queries per ledger line. *reported*
- **A3-4.** `audit_entity_gl_scoping` materialises every posted journal line in Python with no
  date bound. *reported*
- **A3-5.** Reports serialise money as float at the API boundary; string would be safer for a
  JS client. ✅ DONE — `reporting._f` returns quantized decimal strings. *verified*

---

---

## Cross-reference: `docs/APPLICATION_REVIEW_2026-09-10.md`

A separate review ran against the same working tree on the same day and reached several of the
same conclusions independently. Reconciling the two:

| Their finding | Status here |
|---|---|
| 1 — editing a posted invoice reverses the new data, not the original | **Fixed.** The material-edit path now reverses the persisted original before the replacement header or lines are saved (`invoice_views.py`). |
| 6 — migration 0178 marks already-voided POS invoices as stock-relieved | **Fixed.** The backfill excludes voided invoices. |
| 8 — consolidation never releases inter-pond profit after external sale | **Fixed.** Same defect as A0-2; the elimination is now proportional to internal-sourced biomass still on hand. |
| 2 — password changes do not revoke existing refresh tokens | **Fixed by that session.** Verified here: a credential version is embedded in the claims and checked on both `get_user_from_request` and `/api/auth/refresh/`. Previously Genuine and worth doing: add a credential/session version to the JWT claims and bump it on password change and reset. Tracked in their document. |
| 3, 4, 5 — item-type / cost-basis changes between posting and voiding produce the wrong reversal | **Partly addressed, partly open.** Reversal now restores from recorded per-line evidence (`InvoiceLine.stock_relieved_quantity` / `stock_relieved_station_id`, migration 0179) rather than recomputing eligibility at undo time, which is the structural fix for this family. Confirm each of their three reproductions against the current tree before closing. |
| 7 — the production start script fails on Windows | **Open.** Operational, not accounting. |

---

## A note on the reference-code scan

Narrowing `collect_used_suffixes` to a database regex is a real speed-up, but the filter must be
`__iregex`, not `__regex`. Postgres regex matching is case-sensitive; the `parse_suffix` call it
replaced uses `re.IGNORECASE`. With the case-sensitive form a stored `bill-2` stopped counting as
suffix 2, so the allocator could hand out a code that was already taken — and because
`link_production_cycles_to_vendor_bills` matches production cycles by the bill number written into
their notes, a fry bill then failed to open its batch. It showed up only under the full suite and
took a while to pin down; the guard against it is
`tests/test_vendor_bill_auto_aquaculture_cycle.py`, which is worth keeping in mind before touching
this allocator again.

## Suggested working order

1. **Wave A** — P0 items with exactly one correct answer: A0-11, A0-12, A0-13, A0-14, A0-15,
   A0-3, A0-4, A0-7, A0-8, A0-9, A0-10.
2. **Wave B** — the two P0 decisions: A0-1, A0-2 (and A0-5, A0-6, which depend on the same
   inventory-costing policy).
3. **Wave C** — P1 control gaps, starting with A1-1, A1-5, A1-7, A1-8, A1-6.
4. **Wave D** — P2 capabilities, one at a time: A2-1 first, then A2-2, then A2-3.
5. **Wave E** — P3 performance.

Rules for each fix: one commit, one regression test, full suite green before the next.

## Recommended addition: `manage.py audit_books`

✅ DONE — `manage.py audit_books --company-id N` runs unbalanced-journal, duplicate
entry-number, orphan-line, GL posting-gap, and AR/AP/inventory-vs-control checks
(`api.services.books_audit`). `audit_gl_posting_gaps` remains available for the
missing-AUTO-journal subset.
