"""Digonto 23k gap: lease lines + manual expense target comparison."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from api.models import AquaculturePond
from api.services.aquaculture_cost_per_kg import landlord_lease_payment_pond_operating_total

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
start, end = date(2025,2,20), date(2026,2,20)
lease = landlord_lease_payment_pond_operating_total(
    company_id=pond.company_id, pond_id=pond.id, start=start, end=end, cycle_filter_id=None
)
print(f"lease_in_period={money(lease)}")

# compare scenarios for 765k
inc = Decimal("4883586.98")
exp = Decimal("4095702.53")
net = inc - exp
print(f"system_net={money(net)}")
for label, add_exp in [
    ("lease +18500 to 676500", Decimal("18500")),
    ("lease +14500", Decimal("14500")),
    ("misc +22884", Decimal("22884")),
    ("lease +18500 + misc +4384", Decimal("22884")),
]:
    n = inc - (exp + add_exp)
    print(f"  if {label}: net={money(n)}")

# lease payments in window from landlord ledger
from api.models import AquacultureLandlordLedgerEntry
ents = AquacultureLandlordLedgerEntry.objects.filter(
    landlord__company_id=pond.company_id,
    pond_id=pond.id,
    entry_date__gte=start,
    entry_date__lte=end,
    entry_type=AquacultureLandlordLedgerEntry.ENTRY_TYPE_PAYMENT,
).order_by("entry_date", "id")
total = Decimal("0")
for e in ents:
    amt = money(e.amount)
    total += amt
    print(f"  {e.entry_date} id={e.id} amt={amt} note={(e.notes or e.reference or '')[:60]}")
print(f"ledger_lease_sum={money(total)} count={ents.count()}")

# outside window but maybe in manual book?
near = AquacultureLandlordLedgerEntry.objects.filter(
    landlord__company_id=pond.company_id,
    pond_id=pond.id,
    entry_date__gte=date(2026,2,15),
    entry_date__lte=date(2026,3,15),
    entry_type=AquacultureLandlordLedgerEntry.ENTRY_TYPE_PAYMENT,
).order_by("entry_date")
print("\nlease near Feb-Mar 2026 boundary:")
for e in near:
    print(f"  {e.entry_date} id={e.id} amt={money(e.amount)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
if err:
    print("STDERR:", err)
c.close()
