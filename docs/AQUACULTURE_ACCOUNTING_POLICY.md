# Aquaculture accounting policy (locked)

**Adopted:** 2026-09-24  
**Status:** Management + GL policy. Not a defect backlog.  
**Audit posture:** `manage.py audit_aquaculture_accounting` — nursing surplus and bio-cap are **accepted**; large bio-cap share and biomass divergence are **warnings** / ops review.

## Decisions

### 1. Nursing ponds — Model A (profit centre)

- Each pond is its own profit centre.
- Inter-pond fish move as **sale + bill** at `cost/kg + Company.aquaculture_internal_transfer_margin_per_kg` (default 20 BDT/kg when unset).
- **Nursing surplus (IPT income > expense) is accepted.** Do **not** run `reconcile_nursing_pond_pl_balance --apply` to force net ≈ 0.
- Use reconcile only for nursing **deficit** after the pond has transfer-out activity.
- Company consolidation eliminates unrealized inter-pond margin until the buying pond sells externally.

*Alternative not chosen:* Model B (cost centre / margin = 0), used by some salmon majors for hatcheries.

### 2. Bio-cap (1581)

- Seller may only credit biological inventory (1581) up to book balance after expense→1581 reclass.
- Sale price to the buying pond is **never** capped.
- **Never** post phantom 1581 to match management cost.
- Ops target: unrelieved share of line cost **&lt; 5%**. Larger caps → investigate capitalization completeness (inventoriable costs still in expense), not journal repair.

### 3. Biomass — dual truth

| Use | Source of truth |
|---|---|
| Heads / custody | Book stock ledger |
| Feed, density, FCR, load | Effective = sample mean × book heads |
| GL 1581 | Accumulated cost (cost model), not sample fair value |

- Weight-only `AUTO-AQ-BIOMASS-REVAL` may bridge book kg (no GL) so book weight does not go negative after growth.
- Bands vs book kg: **≤15%** normal · **15–25%** ops review · **&gt;25%** or **eff/book &gt; 1.20** investigate.
- Head / residual bio-cost true-up only at **harvest / cycle close**.

### 4. Measurement model

- Keep **cost / LCNRV** on 1581 for this private pond business.
- Do not push full IAS 41 fair-value P&L unless dual operational EBIT reporting is also adopted.

### 5. Operating P&amp;L

- Entity losses (e.g. a grow-out pond underperforming) are **business outcomes**, not missing journals.
- Manage with EBIT/kg, FCR, survival, cost/kg — not audit repair scripts.

## Code anchors

- Policy helpers: `api.services.aquaculture_accounting_policy`
- IPT pricing: `api.services.aquaculture_internal_transfer_price`
- Bio-cap GL: `api.services.aquaculture_fish_transfer_gl_service`
- Capitalization: `api.services.aquaculture_pond_bio_capitalization`
- Book reval: `api.services.aquaculture_biomass_book_revaluation_service`
- Audit: `manage.py audit_aquaculture_accounting`

## Benchmarks (context)

IAS 41; Mowi Salmon Farming Industry Handbook §8.6 (smolt at cost); SalMar bio note; MAS 5 §18–24; published seine/sample error 15–25%; salmon pen harvest MAE ~5%.
