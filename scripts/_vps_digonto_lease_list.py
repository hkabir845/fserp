"""List Digonto P04 lease payments and landlords on VPS."""
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
    AquacultureLandlordLedgerEntry,
    AquacultureLandlordPondShare,
    AquaculturePond,
    AquacultureLandlord,
)

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
start, end = date(2025,2,20), date(2026,2,20)
print(f"P04 {pond.name} id={pond.id}")
print(f"lease_price_per_decimal={pond.lease_price_per_decimal_per_year} lease_paid={pond.lease_paid_to_landlord}")

shares = AquacultureLandlordPondShare.objects.filter(pond_id=pond.id).select_related("landlord")
print("\nlandlord shares:")
for s in shares:
    ll = s.landlord
    print(f"  landlord id={ll.id} name={ll.name} decimals={s.land_area_decimal}")

ents = AquacultureLandlordLedgerEntry.objects.filter(
    pond_id=pond.id,
    landlord__company_id=pond.company_id,
    kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
).order_by("entry_date", "id")
print(f"\nall P04 payments ({ents.count()}):")
total = Decimal("0")
for e in ents:
    amt = money(abs(e.amount_signed))
    total += amt
    in_p = start <= e.entry_date <= end
    print(f"  {e.entry_date} id={e.id} ll={e.landlord_id} amt={amt} in_period={in_p} memo={(e.memo or '')[:50]} ref={e.reference or ''}")
print(f"all_payments_sum={money(total)}")
in_period = ents.filter(entry_date__gte=start, entry_date__lte=end)
ip_sum = money(sum(abs(e.amount_signed) for e in in_period))
print(f"in_period_sum={ip_sum} count={in_period.count()}")

# target gap
print(f"\ngap_to_676500={money(Decimal('676500')-ip_sum)}")
print(f"gap_to_765k_net={money(Decimal('22884'))}")

# sample recent payment for GL fields
last = ents.filter(entry_date__gte=start, entry_date__lte=end).order_by("-entry_date").first()
if last:
    print(f"\nlast_in_period_payment id={last.id} bank={last.bank_account_id} station={last.station_id} method={last.payment_method}")
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
