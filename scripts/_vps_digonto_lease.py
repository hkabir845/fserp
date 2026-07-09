"""VPS: Digonto pond lease contract + identify excess payments."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from api.models import AquacultureLandlordLedgerEntry, AquaculturePond

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

p04 = AquaculturePond.objects.get(code="P04")
area = p04.leasing_area_decimal
price = p04.lease_price_per_decimal_per_year
annual = money(area * price) if area and price else None
print(f"P04 area={area} price/decimal/year={price} implied_annual={annual}")
print(f"lease_paid_to_landlord={p04.lease_paid_to_landlord}")
print(f"contract {p04.lease_contract_start} .. {p04.lease_contract_end}")

start, end = date(2025, 7, 1), date(2026, 6, 30)
ents = list(AquacultureLandlordLedgerEntry.objects.filter(pond_id=p04.id, kind="payment", entry_date__gte=start, entry_date__lte=end).order_by("entry_date", "id"))
total = sum(money(abs(ent.amount_signed)) for ent in ents)
print(f"\nFY payments count={len(ents)} total={money(total)}")
if annual:
    print(f"excess vs annual={money(total - annual)}")

# Cumulative by month
running = Decimal("0")
for ent in ents:
    amt = money(abs(ent.amount_signed))
    running += amt
    print(f"  #{ent.id} {ent.entry_date} {amt:>12} run={money(running)} {ent.memo[:45] if ent.memo else ''}")

# If cap at annual, which entries to reverse (newest first)?
if annual and total > annual:
    excess = money(total - annual)
    print(f"\nNeed to reverse {excess} — candidates (newest large first):")
    rev = Decimal("0")
    for ent in reversed(ents):
        amt = money(abs(ent.amount_signed))
        if amt >= 50000:
            print(f"  candidate #{ent.id} {ent.entry_date} {amt}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err: print("ERR:", err)
c.close()
