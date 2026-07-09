"""Query live API P&L for Digonto on VPS."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django, json
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from api.models import AquaculturePond, Company
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date

pond = AquaculturePond.objects.get(code="P04")
company = pond.company
for label, start, end in [
    ("fy2526", date(2025,7,1), date(2026,6,30)),
    ("current", *fiscal_period_for_end_date(company, date.today())),
]:
    pl = compute_aquaculture_pl_summary_dict(company.id, start, end, pond.id, None, None, False)
    row = next(r for r in pl["ponds"] if r["pond_id"] == pond.id)
    print(label, "income", row["income_total"], "expense", row["expense_total"], "net", row["net_profit"], "profit", row.get("profit"))
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
c.close()
