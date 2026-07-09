import paramiko
SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()
from datetime import date
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.models import AquaculturePond
start, end = date(2025,7,1), date(2026,6,30)
for code in ("P04", "P05", "P02"):
    p = AquaculturePond.objects.get(code=code)
    pl = compute_aquaculture_pl_summary_dict(2, start, end, p.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == p.id)
    print(f"{code}: income={r['income_total']} expense={r['expense_total']} net={r['net_profit']}")
PY
'''
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
_, o, _ = c.exec_command("bash -s", timeout=60)
o.channel.sendall(SCRIPT.encode())
o.channel.shutdown_write()
print(o.read().decode())
c.close()
