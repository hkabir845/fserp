# Pond go-live setup (cutover)

Use **Production ponds → Go-live setup** when starting FSERP mid-cultivation. One **cutover date** applies to all ponds; each pond has a **readiness checklist**.

## Cutover date

Stored on the company (`aquaculture_go_live_cutover_date`). Set in the go-live modal header. Use **Apply date to all as-of fields** before saving monetary openings.

## Checklist tracks (per pond)

| Track | Where | What it means |
|--------|--------|----------------|
| Prior P&L | Income / Expense tabs | Cumulative revenue and costs by category since crop start (not G/L) |
| Customer A/R | Customers tab | Unpaid on-account sales; optional G/L Dr 1100 / Cr 3200 |
| Vendor / employee / loan | Vendors / Employees / Loans | Party openings when linked to the pond (vendor optional G/L Dr/Cr 2000 + 3200) |
| Fish biomass | Fish tab | Species-wise count and kg (Stock ledger adjustment) |
| Feed & medicine | Inventory tab + Stock | Pond warehouse on-hand |
| Lease contract | Lease prepaid tab + Edit pond | Contract total minus prepaid rent |
| Landlord rent | Aquaculture → Landlords | Sub-ledger opening (not in bulk PUT) |

**Bioasset (estimate)** on the checklist = biomass kg × (prior expense ÷ biomass kg). Informational; enter expense and fish for a meaningful value.

**Cutover enforcement:** When `cutover_date` is set on the company, all opening as-of dates must equal cutover; day-to-day aquaculture transactions must be dated **after** cutover.

**Prior P&L in reports:** Go-live income/expense openings are merged into pond P&L summary and analytics. Optional G/L posts one journal per pond (`AUTO-POND-PL-OB-{pond}`) with per-category Dr/Cr to mapped income/expense accounts and 3200 equity.

**Cutover required:** Opening balance writes require `cutover_date` to be set first; all opening as-of dates must equal cutover.

## API

`GET/PUT /api/aquaculture/ponds/opening-balances/`

GET returns `cutover_date`, `go_live` fleet summary, and per-pond `go_live` (checks, biology, inventory, bioasset, lease).

PUT body:

```json
{
  "cutover_date": "2026-05-22",
  "updates": [{ "pond_id": 1, "pl_income": [...], "customer": {...} }]
}
```

## Migrations

```bash
cd backend
python manage.py migrate api 0113
```

Requires `0112` (P&L openings) and `0109` (landlord opening balance).

## Key files

| Layer | Path |
|-------|------|
| Cutover + readiness | `api/services/aquaculture_pond_go_live_service.py` |
| P&L openings | `api/services/aquaculture_pond_pl_opening.py` |
| Summary | `api/services/aquaculture_pond_opening_summary.py` |
| API | `aquaculture_ponds_opening_balances` in `aquaculture_views.py` |
| UI | `PondOpeningBalancesModal.tsx`, `PondGoLiveOverview.tsx`, `PondGoLiveFishTab.tsx`, `PondGoLiveInventoryTab.tsx` |
