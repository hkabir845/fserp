"""Check suspicious lease entries on P04."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from api.models import AquacultureLandlordLedgerEntry, AquaculturePond, AquacultureLandlord

for eid in [86, 109, 110, 111, 112, 114, 116]:
    ent = AquacultureLandlordLedgerEntry.objects.filter(pk=eid).select_related("landlord", "pond").first()
    if ent:
        print(f"#{ent.id} {ent.entry_date} pond={ent.pond.code if ent.pond else None} landlord={ent.landlord.name!r} amt={ent.amount_signed} memo={ent.memo!r}")

print("\nAll ponds:")
for p in AquaculturePond.objects.filter(company_id=2).order_by("code"):
    print(f"  {p.code} {p.name!r} role={p.pond_role}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
_, o, e = c.exec_command("bash -s", timeout=60)
o.channel.sendall(SCRIPT.encode())
o.channel.shutdown_write()
print(o.read().decode())
c.close()
