from pathlib import Path
S = Path(r'I:/ITProjects/FSERP/backend/api/services')
O = Path(r'I:/ITProjects/FSERP/scripts/_audit_extract')
O.mkdir(exist_ok=True)

def dump(name, text):
    (O/name).write_text(text, encoding='utf-8')

# FCR gain formula
fcr = (S/'aquaculture_fcr_service.py').read_text(encoding='utf-8')
i = fcr.find('def compute_fcr_for_scope')
dump('fcr_compute.txt', fcr[i:i+3500])
i = fcr.find('production_gain_kg')
dump('fcr_gain_line.txt', fcr[max(0,i-400):i+500])

# cost per kg build
cpk = (S/'aquaculture_cost_per_kg.py').read_text(encoding='utf-8')
i = cpk.find('def build_pond_cost_per_kg_block')
dump('cost_per_kg_build.txt', cpk[i:i+2200])
i = cpk.find('def harvest_weight_denominator_kg')
dump('cost_per_kg_denom.txt', cpk[i:i+900])

# elimination
elim = (S/'internal_trade_elimination.py').read_text(encoding='utf-8')
dump('elim_full.txt', elim)

# transfer cost fry + denom + biological total
tc = (S/'aquaculture_transfer_cost.py').read_text(encoding='utf-8')
i = tc.find('def transfer_cost_pools_for_scope')
dump('xfer_pools.txt', tc[i:i+2200])
i = tc.find('def _transfer_denominator_kg')
dump('xfer_denom.txt', tc[i:i+1800])
i = tc.find('def _biological_production_cost_total')
dump('xfer_bio_total.txt', tc[i:i+800])
i = tc.find('def pl_window_for_transfer_date')
dump('xfer_window.txt', tc[i:i+900])

# bio asset
ba = (S/'aquaculture_bio_asset_cost_service.py').read_text(encoding='utf-8')
dump('bio_asset.txt', ba)

# revaluation
rev = (S/'aquaculture_biomass_book_revaluation_service.py').read_text(encoding='utf-8')
dump('reval.txt', rev[:5000])

# pl expense sum
pes = (S/'aquaculture_pl_expense_sum.py').read_text(encoding='utf-8')
dump('pl_expense_sum.txt', pes)

# nursing double count in PL
pl = (S/'aquaculture_pl_service.py').read_text(encoding='utf-8')
i = pl.find('nursing_pond')
dump('pl_nursing.txt', pl[i-200:i+2500])
i = pl.find('# Commercial view is the mirrored')
dump('pl_transfer_loop.txt', pl[i-400:i+1200])

# sale bio relief vs model fields
sbr = (S/'aquaculture_sale_bio_relief_service.py').read_text(encoding='utf-8')
dump('sale_bio_relief.txt', sbr)

# gl posting bio relief cost_bucket
gl = (S/'gl_posting.py').read_text(encoding='utf-8')
i = gl.find('def post_aquaculture_fish_sale_bio_relief_journal')
dump('gl_sale_bio.txt', gl[i:i+2200])
i = gl.find('def post_aquaculture_fish_stock_ledger_journal')
dump('gl_stock_led.txt', gl[i:i+1800])

# fish transfer as sale
for cand in ['aquaculture_fish_transfer_as_sale.py','aquaculture_fish_transfer_policy.py','aquaculture_internal_trade_posting.py']:
    p = S/cand
    if p.exists():
        dump(cand.replace('.py','.txt'), p.read_text(encoding='utf-8')[:6000])

print('done', list(O.glob('*.txt')))
