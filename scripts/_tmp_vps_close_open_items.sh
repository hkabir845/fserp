#!/usr/bin/env bash
# Review open aqua items serially on company 2 (read-only).
set -euo pipefail
cd ~/fserp/fserp
source backend/venv/bin/activate
export FSERP_USE_SQLITE=0
cd backend

python manage.py shell <<'PY'
from datetime import date
from decimal import Decimal
from django.db.models import Q
from api.models import (
    AquaculturePond,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureLandlordLedgerEntry,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_fish_transfer_gl_service import pond_1581_balance, transfer_gl_status
from api.management.commands.audit_aquaculture_accounting import _pond_implied_annual_lease

cid = 2
start, end = date(2025, 7, 1), date(2026, 6, 30)
M = lambda x: Decimal(str(x or 0)).quantize(Decimal("0.01"))

print("=== 1) P05 surplus ===")
pl = compute_aquaculture_pl_summary_dict(cid, start, end, None, None, None, False)
p05 = AquaculturePond.objects.get(company_id=cid, code="P05")
row = next(r for r in pl["ponds"] if r["pond_id"] == p05.id)
print(f"P05 income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
margin_sum = Decimal("0")
for ln in AquacultureFishPondTransferLine.objects.filter(
    transfer__from_pond_id=p05.id,
    transfer__transfer_date__gte=start,
    transfer__transfer_date__lte=end,
).select_related("transfer", "to_pond"):
    cost, sale = M(ln.cost_amount), M(ln.sale_amount)
    margin_sum += sale - cost
    print(f"  xfer#{ln.transfer_id} L{ln.id} ->{ln.to_pond.code} cost={cost} sale={sale} margin={sale-cost}")
print(f"P05 IPT margin sum={margin_sum}")

print("\n=== 2) Transfers 15 / 16 ===")
for tid in (15, 16):
    tr = AquacultureFishPondTransfer.objects.select_related("from_pond").get(id=tid)
    lines = list(tr.lines.select_related("to_pond").all())
    line_total = sum(M(ln.cost_amount) for ln in lines)
    sale_total = sum(M(ln.sale_amount) for ln in lines)
    dest = ",".join(sorted({ln.to_pond.code for ln in lines}))
    st = transfer_gl_status(cid, tid)
    gl = M(st.get("gl_total_amount") or 0)
    bal = pond_1581_balance(cid, tr.from_pond_id, tr.transfer_date)
    print(
        f"T{tid} {tr.transfer_date} {tr.from_pond.code}->{dest} "
        f"cost={line_total} sale={sale_total} gl={gl} posted={st.get('gl_posted')} "
        f"src_1581_asof={bal}"
    )
    print(f"  status={ {k: st.get(k) for k in ('gl_posted','gl_total_amount','gl_capped','reason','legacy')} }")
    for ln in lines:
        print(f"  L{ln.id} ->{ln.to_pond.code} cost={ln.cost_amount} sale={ln.sale_amount}")
    for je in JournalEntry.objects.filter(company_id=cid).filter(
        Q(entry_number__startswith=f"AUTO-IPT-INV-{tid}-")
        | Q(entry_number__startswith=f"AUTO-IPT-BILL-{tid}-")
        | Q(entry_number=f"AUTO-AQ-FISH-XFER-{tid}")
    ).order_by("entry_number"):
        print(f"  JE {je.entry_number} date={je.entry_date} posted={je.is_posted}")
        for jl in JournalEntryLine.objects.filter(journal_entry=je).select_related("account"):
            code = jl.account.account_code
            if code in ("1581", "4245", "5245", "1585", "1595"):
                print(f"    {code} dr={jl.debit} cr={jl.credit} pond={jl.aquaculture_pond_id}")

print("\n=== 3) Transfers 8 / 9 ===")
for tid in (8, 9):
    tr = AquacultureFishPondTransfer.objects.select_related("from_pond").get(id=tid)
    lines = list(tr.lines.select_related("to_pond").all())
    line_total = sum(M(ln.cost_amount) for ln in lines)
    dest = ",".join(sorted({ln.to_pond.code for ln in lines}))
    st = transfer_gl_status(cid, tid)
    gl = M(st.get("gl_total_amount") or 0)
    bal = pond_1581_balance(cid, tr.from_pond_id, tr.transfer_date)
    print(
        f"T{tid} {tr.transfer_date} {tr.from_pond.code}->{dest} "
        f"cost={line_total} gl={gl} src_1581={bal} capped={gl < line_total}"
    )

print("\n=== 4) Lease P01 / P04 ===")
for code in ("P01", "P04"):
    pond = AquaculturePond.objects.get(company_id=cid, code=code)
    annual = _pond_implied_annual_lease(pond)
    row = next(r for r in pl["ponds"] if r["pond_id"] == pond.id)
    lease_pl = M(row.get("lease_cost"))
    print(
        f"{code} lease_pl={lease_pl} implied_annual={annual} short={M(annual or 0)-lease_pl} "
        f"area={pond.leasing_area_decimal} rate={pond.lease_price_per_decimal_per_year}"
    )
    for e in AquacultureLandlordLedgerEntry.objects.filter(
        landlord__company_id=cid, pond_id=pond.id,
        entry_date__gte=start, entry_date__lte=end,
    ).order_by("entry_date", "id"):
        print(f"  {e.entry_date} kind={e.kind} amt={e.amount_signed} memo={(e.memo or '')[:70]}")
PY
