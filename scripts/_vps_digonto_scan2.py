"""Coarse scan end dates for Digonto net profit."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal
from api.models import AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"))

pond = AquaculturePond.objects.get(code="P04")
cid = pond.company_id
targets = [Decimal("623882.65"), Decimal("765000"), Decimal("383955.65")]
for y,m,d in [(2025,7,1),(2025,10,1),(2026,1,1),(2026,3,1),(2026,5,1),(2026,6,1),(2026,6,30),(2026,7,10)]:
    for start in [date(2025,7,1), date(2026,1,1)]:
        end = date(y,m,d)
        if end < start: continue
        pl = compute_aquaculture_pl_summary_dict(cid, start, end, pond.id, None, None, False)
        row = next(r for r in pl["ponds"] if r["pond_id"] == pond.id)
        net = money(row["net_profit"])
        for t in targets:
            if abs(net-t) < Decimal("5000"):
                print(f"~{t} start={start} end={end} net={net} inc={row['income_total']} exp={row['expense_total']}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=180)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode())
c.close()
