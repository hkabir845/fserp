"""Digonto lease and transfer cost root cause on VPS."""
import paramiko

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import (
    AquacultureExpense, AquacultureFishPondTransfer, AquacultureFishPondTransferLine,
    AquaculturePond, BillLine, JournalEntry, JournalEntryLine,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
cid = pond.company_id
pid = pond.id
start, end = date(2025, 7, 1), date(2026, 6, 30)

print("=== LEASE breakdown Digonto P04 ===")
lease_exp = AquacultureExpense.objects.filter(company_id=cid, pond_id=pid, expense_category="lease").order_by("expense_date")
fy_lease = lease_exp.filter(expense_date__gte=start, expense_date__lte=end)
print(f"AquacultureExpense lease in FY: {money(fy_lease.aggregate(t=Sum('amount'))['t'] or 0)} ({fy_lease.count()} rows)")
for e in fy_lease:
    print(f"  {e.expense_date} {money(e.amount)} id={e.id} notes={(e.notes or '')[:80]}")

# Bill lines with lease
print("\nVendor bill lines (lease category) for pond:")
try:
    bl = BillLine.objects.filter(
        bill__company_id=cid, pond_id=pid, expense_category="lease",
        bill__bill_date__gte=start, bill__bill_date__lte=end,
    ).select_related("bill")
    print(f"  count={bl.count()} total={money(bl.aggregate(t=Sum('amount'))['t'] or 0)}")
    for ln in bl.order_by("bill__bill_date")[:20]:
        print(f"  {ln.bill.bill_date} bill#{ln.bill_id} {money(ln.amount)}")
except Exception as ex:
    print(f"  bill query error: {ex}")

# Landlord payments - search GL 6711
print("\nGL journal lines account 6711 (lease) tagged P04:")
for jl in JournalEntryLine.objects.filter(
    journal_entry__company_id=cid,
    account__code="6711",
    aquaculture_pond_id=pid,
    journal_entry__entry_date__gte=start,
    journal_entry__entry_date__lte=end,
).select_related("journal_entry", "account").order_by("journal_entry__entry_date")[:30]:
    je = jl.journal_entry
    print(f"  {je.entry_date} JE#{je.id} debit={money(jl.debit)} credit={money(jl.credit)} memo={(je.memo or '')[:50]}")

print("\n=== TRANSFER cost P05 -> P04 ===")
ln = AquacultureFishPondTransferLine.objects.filter(to_pond_id=pid).select_related("transfer", "transfer__from_pond").first()
if ln:
    tr = ln.transfer
    print(f"Transfer #{tr.id} date={tr.transfer_date} from={tr.from_pond.code} fish={ln.fish_count} cost={money(ln.cost_amount or 0)}")
    print(f"  created/updated: transfer id={tr.id}")
    # All lines on this transfer
    for l2 in AquacultureFishPondTransferLine.objects.filter(transfer_id=tr.id).select_related("to_pond"):
        print(f"  -> {l2.to_pond.code} fish={l2.fish_count} cost={money(l2.cost_amount or 0)}")

# P05 nursing pond transfers out
p05 = AquaculturePond.objects.filter(code="P05").first()
if p05:
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, p05.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == p05.id)
    print(f"\nP05 nursing FY: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']} xfer_out={r.get('fish_transfer_cost_out')}")
    for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p05.id, to_pond_id=pid).select_related("transfer"):
        print(f"  to P04 line cost={money(ln.cost_amount or 0)} fish={ln.fish_count} date={ln.transfer.transfer_date}")

# P08 Digonto Nursing
p08 = AquaculturePond.objects.filter(code="P08").first()
if p08:
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, p08.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == p08.id)
    print(f"\nP08 Digonto Nursing FY: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']}")
    for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p08.id).select_related("transfer", "to_pond"):
        print(f"  xfer to {ln.to_pond.code} cost={money(ln.cost_amount or 0)} fish={ln.fish_count} date={ln.transfer.transfer_date}")

# Reconcile to 765k
inc = Decimal("4883586.98")
cats_jul6 = {
    "feed_consumed": Decimal("2328269.05"),
    "lease": Decimal("676500.00"),
    "fry_stocking": Decimal("380042.50"),
    "payroll_allocated": Decimal("250980.00"),
    "electricity": Decimal("131142.00"),
    "fish_transfer_cost_in": Decimal("123913.98"),
    "transportation": Decimal("77340.00"),
    "fisherman": Decimal("76310.00"),
    "medicine_purchase": Decimal("25905.00"),
    "pond_preparation": Decimal("24000.00"),
    "repair_maintenance": Decimal("9150.00"),
    "equipment": Decimal("4820.00"),
    "day_labor": Decimal("3000.00"),
    "vendor_bill_pond": Decimal("2300.00"),
    "shop_supplies": Decimal("380.00"),
    "biological_write_offs": Decimal("150.00"),
}
sum_jul6 = sum(cats_jul6.values())
print(f"\nJul6 category sum: {money(sum_jul6)} net={money(inc - sum_jul6)}")

pl = compute_aquaculture_pl_summary_dict(cid, start, end, pid, None, None, False)
cur = {item["category"]: money(item["amount"]) for item in pl.get("expenses_by_category") or []}
print("\nDelta Jul6 vs current VPS categories:")
for code in sorted(set(cats_jul6) | set(cur)):
    d = cur.get(code, Decimal("0")) - cats_jul6.get(code, Decimal("0"))
    if d:
        print(f"  {code}: jul6={money(cats_jul6.get(code,0))} now={money(cur.get(code,0))} delta={money(d)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode()
err = stderr.read().decode()
code = stdout.channel.recv_exit_status()
print(out)
if err:
    print("ERR:", err)
print("exit", code)
c.close()
