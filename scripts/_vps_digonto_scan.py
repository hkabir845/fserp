"""Scan date ranges for net 623882.65."""
import paramiko
from datetime import date, timedelta

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date, timedelta
from decimal import Decimal
from api.models import AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"))

pond = AquaculturePond.objects.get(code="P04")
cid = pond.company_id
target = Decimal("623882.65")
start0 = date(2025, 7, 1)
for days in range(0, 380):
    end = start0 + timedelta(days=days)
    pl = compute_aquaculture_pl_summary_dict(cid, start0, end, pond.id, None, None, False)
    row = next(r for r in pl["ponds"] if r["pond_id"] == pond.id)
    net = money(row["net_profit"])
    if abs(net - target) < Decimal("1"):
        print(f"MATCH {start0}..{end} net={net} income={row['income_total']} expense={row['expense_total']}")
print("scan done")
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
c.close()
