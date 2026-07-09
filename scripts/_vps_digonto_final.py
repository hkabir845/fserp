"""Landlord lease + payroll + transfer detail for Digonto P04."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import AquaculturePond, AquacultureFishPondTransferLine, JournalEntryLine, PayrollRunPondAllocation
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_cost_per_kg import landlord_lease_payment_pond_journal_qs

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
cid, pid = pond.company_id, pond.id
start, end = date(2025, 7, 1), date(2026, 6, 30)

print("=== LANDLORD LEASE PAYMENTS (AUTO-LL-PAY) P04 ===")
qs = landlord_lease_payment_pond_journal_qs(company_id=cid, pond_id=pid, start=start, end=end, cycle_filter_id=None)
print(f"Total: {money(qs.aggregate(s=Sum('debit'))['s'] or 0)} lines={qs.count()}")
for jl in qs.select_related("journal_entry").order_by("journal_entry__entry_date", "id"):
    je = jl.journal_entry
    print(f"  {je.entry_date} {je.entry_number} debit={money(jl.debit)} cycle={jl.aquaculture_production_cycle_id}")

print("\n=== PAYROLL ALLOCATIONS P04 ===")
pay = PayrollRunPondAllocation.objects.filter(
    pond_id=pid,
    payroll_run__company_id=cid,
    payroll_run__payment_date__gte=start,
    payroll_run__payment_date__lte=end,
).select_related("payroll_run")
print(f"Total: {money(pay.aggregate(t=Sum('amount'))['t'] or 0)} rows={pay.count()}")
for pa in pay.order_by("payroll_run__payment_date")[:30]:
    pr = pa.payroll_run
    print(f"  {pr.payment_date} run#{pr.id} amount={money(pa.amount)}")

print("\n=== TRANSFER P05 -> P04 ===")
for ln in AquacultureFishPondTransferLine.objects.filter(to_pond_id=pid).select_related("transfer", "transfer__from_pond"):
    tr = ln.transfer
    print(f"line#{ln.id} xfer#{tr.id} {tr.transfer_date} from {tr.from_pond.code} fish={ln.fish_count} cost={money(ln.cost_amount or 0)}")

# P05 nursing PL
p05 = AquaculturePond.objects.get(code="P05")
pl = compute_aquaculture_pl_summary_dict(cid, start, end, p05.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p05.id)
print(f"\nP05 nursing: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']} xfer_out={r.get('fish_transfer_cost_out')}")

# What-if corrections
pl4 = compute_aquaculture_pl_summary_dict(cid, start, end, pid, None, None, False)
row = next(x for x in pl4["ponds"] if x["pond_id"] == pid)
inc = money(row["income_total"])
cats = {x["category"]: money(x["amount"]) for x in pl4["expenses_by_category"]}
print("\n=== WHAT-IF NET PROFIT ===")
scenarios = {
    "current_vps": sum(cats.values()),
    "jul6_categories": Decimal("4114202.53"),
    "fix_xfer_only": sum(cats.values()) - cats.get("fish_transfer_cost_in", 0) + Decimal("123913.98"),
    "fix_lease_only": sum(cats.values()) - cats.get("lease", 0) + Decimal("676500"),
    "fix_xfer_and_lease": sum(cats.values()) - cats.get("fish_transfer_cost_in", 0) + Decimal("123913.98") - cats.get("lease", 0) + Decimal("676500"),
    "fix_xfer_lease_payroll_jul6": Decimal("4114202.53"),
}
for name, exp in scenarios.items():
    print(f"  {name}: expense={money(exp)} net={money(inc - exp)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("ERR:", err)
c.close()
