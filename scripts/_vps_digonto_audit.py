"""Pre-fix audit: P05 transfers, landlord ledger, payroll for Digonto."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransferLine, AquacultureLandlordLedgerEntry, AquaculturePond,
    AquacultureLandlordPondShare, PayrollRunPondAllocation, JournalEntry,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025, 7, 1), date(2026, 6, 30)
p04 = AquaculturePond.objects.get(code="P04")
p05 = AquaculturePond.objects.get(code="P05")

print("=== P05 ALL OUTGOING TRANSFERS ===")
lines = AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p05.id).select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id")
total_cost = Decimal("0")
total_fish = 0
for ln in lines:
    tr = ln.transfer
    total_cost += money(ln.cost_amount or 0)
    total_fish += int(ln.fish_count or 0)
    print(f"  line#{ln.id} xfer#{tr.id} {tr.transfer_date} -> {ln.to_pond.code} fish={ln.fish_count} cost={money(ln.cost_amount or 0)}")
print(f"TOTAL out cost={money(total_cost)} fish={total_fish}")

pl = compute_aquaculture_pl_summary_dict(cid, start, end, p05.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p05.id)
print(f"P05 PL: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']} xfer_out={r.get('fish_transfer_cost_out')}")

print("\n=== LANDLORD LEDGER ENTRIES -> P04 ===")
# pond shares for P04
shares = AquacultureLandlordPondShare.objects.filter(pond_id=p04.id).select_related("landlord")
for sh in shares:
    ll = sh.landlord
    print(f"Landlord {ll.id} {ll.name!r} pond_share annual={sh.annual_lease_amount} paid={sh.lease_paid_to_date}")
    ents = AquacultureLandlordLedgerEntry.objects.filter(landlord_id=ll.id, entry_date__gte=start, entry_date__lte=end).order_by("entry_date", "id")
    for ent in ents:
        # check if this payment allocates to P04
        from api.models import AquacultureLandlordLedgerPondAllocation
        allocs = list(AquacultureLandlordLedgerPondAllocation.objects.filter(ledger_entry_id=ent.id, pond_id=p04.id))
        if not allocs:
            # maybe company-level payment split
            allocs = list(AquacultureLandlordLedgerPondAllocation.objects.filter(ledger_entry_id=ent.id))
        p04_amt = sum(money(a.amount or 0) for a in allocs if a.pond_id == p04.id)
        if p04_amt or ent.entry_type == "payment":
            je = JournalEntry.objects.filter(entry_number=f"AUTO-LL-PAY-{ent.id}").first()
            print(f"  ent#{ent.id} {ent.entry_date} type={ent.entry_type} amount={money(ent.amount)} p04_alloc={p04_amt} bank={ent.bank_account_id} JE={je.entry_number if je else None}")

print("\n=== PAYROLL to P04 since Jul 2025 ===")
for pa in PayrollRunPondAllocation.objects.filter(pond_id=p04.id, payroll_run__payment_date__gte=start).select_related("payroll_run").order_by("payroll_run__payment_date"):
    pr = pa.payroll_run
    print(f"  {pr.payment_date} alloc#{pa.id} run#{pr.id} amt={money(pa.amount)}")
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
