"""Audit landlord + resync preview for Digonto fix."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import AquaculturePond, AquacultureLandlordLedgerEntry, JournalEntryLine
from api.services.aquaculture_cost_per_kg import landlord_lease_payment_pond_journal_qs
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs, preview_transfer_line_cost
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025, 7, 1), date(2026, 6, 30)
p04 = AquaculturePond.objects.get(code="P04")
p05 = AquaculturePond.objects.get(code="P05")

print(f"P04 lease_paid_to_landlord={p04.lease_paid_to_landlord}")
print(f"P04 implied annual lease from pond fields: area={p04.land_area_decimal} rate={getattr(p04, 'lease_rate_per_decimal', None)}")

print("\n=== LANDLORD PAYMENTS P04 (journal lines) ===")
qs = landlord_lease_payment_pond_journal_qs(company_id=cid, pond_id=p04.id, start=start, end=end, cycle_filter_id=None)
for jl in qs.select_related("journal_entry").order_by("journal_entry__entry_date"):
    je = jl.journal_entry
    ll_id = je.entry_number.replace("AUTO-LL-PAY-", "")
    ent = AquacultureLandlordLedgerEntry.objects.filter(pk=int(ll_id)).first() if ll_id.isdigit() else None
    memo = ent.memo if ent else ""
    print(f"  {je.entry_date} {je.entry_number} debit={money(jl.debit)} memo={memo[:60]}")

print("\n=== RESYNC P05 preview (dry) ===")
from api.models import AquacultureFishPondTransferLine
for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p05.id, transfer__transfer_date__gte=start).select_related("transfer", "to_pond"):
    tr = ln.transfer
    try:
        prev = preview_transfer_line_cost(cid, ln)
        print(f"  line#{ln.id} -> {ln.to_pond.code} current={money(ln.cost_amount or 0)} preview={money(prev)} fish={ln.fish_count}")
    except Exception as e:
        print(f"  line#{ln.id} preview error: {e}")

print("\nDry resync count:")
# don't save - call internal logic
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs
# check module for preview mode... just print

# P04 PL current
pl = compute_aquaculture_pl_summary_dict(cid, start, end, p04.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p04.id)
print(f"\nP04 current net={r['net_profit']}")
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
