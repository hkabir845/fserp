# Inter-pond fish trade — conversion runbook

Fish moving between ponds is a **sale**, not a transfer. The selling pond raises an invoice, the
buying pond records a bill, and the pair settles through account **1595 Inter-Pond Current
Account** — never in cash, so no internal balance ages in real A/R or A/P.

The old single `AUTO-AQ-FISH-XFER-{id}` journal is retired. Transfers of **feed, medicine,
equipment and other supplies** are unaffected — those run through
`transfer_pond_warehouse_between_ponds` and are a different mechanism entirely.

## What posts now

Per traded line, tagged to the pond on each side:

| Journal | Account | Dr | Cr |
|---|---|---|---|
| `AUTO-IPT-INV-{line}` (seller) | 1595 Inter-pond current | price | |
| | 4245 Inter-pond fish sales | | price |
| | 5245 Inter-pond cost of sales | cost | |
| | 1581 Biological inventory | | cost |
| `AUTO-IPT-BILL-{line}` (buyer) | 1581 Biological inventory | price | |
| | 1595 Inter-pond current | | price |

Price = the line's **cost per kg + `Company.aquaculture_internal_transfer_margin_per_kg`**
(default 20 BDT/kg, editable in Company settings). The seller can only release the 1581 it
actually holds, so the cost leg is still capped at its balance on the trade date and pond
production expense is still reclassified into 1581 first when the company capitalizes it. The
price legs are never capped — the buyer owes the agreed price either way.

Company-wide the two 1595 legs cancel. Consolidation still removes the margin: `4245`/`5245`
drop out of company income and the unsold profit is written down through `1585`, so **company
profit and the company balance sheet do not move**. Per-pond results do — that is the point.

## Running the conversion on live data

1. **Back up the database first.**

   ```bash
   pg_dump -Fc "$DATABASE_URL" -f ~/fserp-before-ipt-conversion.dump
   ```

2. **Deploy the code and apply the migration** (adds `Company.books_locked_through`):

   ```bash
   cd /home/sas/fserp/fserp
   git pull
   bash scripts/deploy-vps.sh
   ```

3. **Dry run** — writes nothing, prints every line it would raise and proves the company totals
   hold still:

   ```bash
   cd backend
   venv/bin/python manage.py convert_fish_transfers_to_documents --company-id <ID>
   ```

   Check the tail of the output:
   - `Trial balance ... balanced=True`
   - every `reported ...` row shows `change 0.0`
   - the success line: *"The company's reported profit and balance sheet are unchanged"*

   If either check fails the command rolls back on its own and prints why — nothing is saved.

4. **Apply** once the dry run reads correctly:

   ```bash
   venv/bin/python manage.py convert_fish_transfers_to_documents --company-id <ID> --apply
   ```

5. **Verify:**

   ```bash
   venv/bin/python manage.py audit_aquaculture_accounting --company-id <ID>
   ```

   The `transfer_gl_mismatch` findings should be gone: those transfers now carry document
   journals instead of the retired transfer journal.

The command is **idempotent** — running it again finds the documents already posted and changes
nothing, so it is safe to re-run after a partial deploy.

Use `--transfer-id N` (repeatable) to convert a single transfer, and `--json` for machine-readable
output.

## What the conversion does not do

It moves no fish. Stock ledger entries, biomass samples and head counts already recorded those
movements when the transfers were made; this changes only how the money is documented. Internal
invoices and bills stay hidden from external A/R/A/P lists through `ExternalTradeDocumentManager`
(`Invoice.objects` / `Bill.objects`); use `all_objects` or `?internal_trade=1` to see them.
