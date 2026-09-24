# FSERP backend — agent notes

## Database

- PostgreSQL only (`DATABASE_URL`). Never `FSERP_USE_SQLITE=1` or `db.sqlite3` for app data.

## GL posting

- Auto journals funnel through `gl_posting._create_posted_entry`. Unbalanced or zero-amount AUTO journals **raise `GlPostingError`** (fail closed) — do not soft-return `None` for unbalanced lines.
- Inter-pond fish trades: seller `AUTO-IPT-INV-*` (Dr 5245 / Cr 1581). Do **not** also post `AUTO-AQ-SALE-*-BIO` for mirrored sales (`source_fish_pond_transfer_line_id` set).

## Aquaculture P&L / CPK

- Company P&L eliminates IPT-invoiced mirror revenue and buyer `fish_transfer_cost_in` (align with GL 4245/5245 elimination). Pond rows keep full profit-centre amounts.
- `pl_grand_totals` / `totals` net income follow **company category nets**, not raw pond sums.
- Cost/kg harvest denominators exclude mirrored transfer sales (`source_fish_pond_transfer_line_id__isnull=True`).
- Elimination on-hand kg uses **effective biomass** (sample × heads), not fry book weight.

## Permissions / tenancy

- Mutating company-scoped views: stack `@auth_required` → `@require_company_id` → `@require_permission(...)`.
- Shifts: `app.page.shift_management`. Vendor purchase terms/credits: `app.page.vendors`.

## Audits

- Prefer `manage.py audit_aquaculture_accounting` / `audit_gl_posting_gaps` over ad-hoc `scripts/_tmp_*` VPS patches for recurring checks.
- Historical null-cycle sales: `repair_aquaculture_null_cycle_sales --company-id N --dry-run` then apply.
- Species mistags: `repair_aquaculture_species_mistags --company-id N --dry-run` (BD polyculture companions excluded; auto-fix when memo names a correcting species).
- Nursing P&L gap (expense ≫ transfer income): `reconcile_nursing_pond_pl_balance --company-id N --pond-code P08 --dry-run` then apply.
- Leftover IPT double BIO: `repair_aquaculture_ipt_double_bio --company-id N --dry-run` then apply.
- VPS one-shot (company 2): after `deploy-vps.sh`, `bash scripts/repair-aqua-company2-vps.sh` then `--apply`.
