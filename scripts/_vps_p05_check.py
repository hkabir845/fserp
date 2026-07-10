"""Check P05 state after reconcile attempt."""
import paramiko
SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()
from datetime import date
from api.models import AquaculturePond, AquacultureFishPondTransferLine
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
cid=2; start,end=date(2025,2,20),date(2026,2,20)
p=AquaculturePond.objects.get(code="P05")
pl=compute_aquaculture_pl_summary_dict(cid,start,end,p.id,None,None,False)
r=next(x for x in pl["ponds"] if x["pond_id"]==p.id)
print("PL", r["income_total"], r["expense_total"], r["net_profit"])
for ln in AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p.id).order_by("id"):
    print(" line", ln.id, ln.cost_amount)
PY
'''
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com",username="sas",password="sas_corporation_noob",timeout=30)
i,o,e=c.exec_command("bash -s",timeout=60); i.write(SCRIPT); i.flush(); i.channel.shutdown_write()
print(o.read().decode()); 
err=e.read().decode();
if err: print("ERR", err)
c.close()
