"""VPS: resync preview P05 + landlord entries for P04."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction

from api.models import AquacultureFishPondTransferLine, AquacultureLandlordLedgerEntry, AquaculturePond
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs, lookup_transfer_cost_per_head
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025, 7, 1), date(2026, 6, 30)
p04 = AquaculturePond.objects.get(code="P04")
p05 = AquaculturePond.objects.get(code="P05")

print("=== P05 per-head lookup at Jul 14 2025 ===")
per_head, note = lookup_transfer_cost_per_head(
    company_id=cid, from_pond_id=p05.id, transfer_date=date(2025,7,14), from_cycle=None
)
print(f"per_head={per_head}")
print(f"note={note[:200]}")

for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p05.id, transfer__transfer_date__gte=start).select_related("to_pond"):
    implied = money(per_head * Decimal(int(ln.fish_count or 0))) if per_head else Decimal("0")
    print(f"line#{ln.id} -> {ln.to_pond.code} fish={ln.fish_count} current={money(ln.cost_amount or 0)} per_head_implied={implied}")

print("\n=== DRY resync P05 ===")
with transaction.atomic():
    n = resync_nursing_pond_transfer_costs(company_id=cid, from_pond_id=p05.id, from_production_cycle_id=None, sync_gl=False)
    print(f"updated {n} lines")
    for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p05.id, transfer__transfer_date__gte=start).select_related("to_pond"):
        print(f"  line#{ln.id} -> {ln.to_pond.code} new={money(ln.cost_amount or 0)}")
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, p04.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == p04.id)
    print(f"P04 after resync (rolled back): xfer_in={r.get('fish_transfer_cost_in')} net={r['net_profit']}")
    transaction.set_rollback(True)

print("\n=== LANDLORD ledger payments tagged pond P04 ===")
for ent in AquacultureLandlordLedgerEntry.objects.filter(pond_id=p04.id, kind="payment", entry_date__gte=start, entry_date__lte=end).order_by("entry_date", "id"):
    print(f"  ent#{ent.id} {ent.entry_date} signed={money(ent.amount_signed)} lease_delta={ent.lease_paid_delta} memo={ent.memo[:50] if ent.memo else ''} bank={ent.bank_account_id}")

print("\nAll landlord payments (any pond) with P04 journal debit in period - already listed above via AUTO-LL-PAY")

# check pond annual lease expectation
print(f"\nP04 lease_paid_to_landlord={p04.lease_paid_to_landlord}")
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
