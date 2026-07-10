"""Find pond with income ~1107163 and expense ~1355919 on VPS."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from api.models import AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.models import Company

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
company = Company.objects.get(pk=cid)
today = date(2026, 7, 10)
# crop year presets
periods = [
    ("crop_year", date(2025,2,20), date(2026,2,20)),
    ("season_to_date", *fiscal_period_for_end_date(company, today)),
    ("jul_jun_fy", date(2025,7,1), date(2026,6,30)),
    ("today_range", today, today),
]

targets = (Decimal("1107163.10"), Decimal("1355919.60"), Decimal("-248756.50"))

for label, start, end in periods:
    print(f"\n=== {label} {start}..{end} ===")
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, None, None, None, False)
    for row in pl.get("ponds") or []:
        inc = money(row["income_total"])
        exp = money(row["expense_total"])
        net = money(row["net_profit"])
        close = (
            abs(inc - targets[0]) < Decimal("1")
            or abs(exp - targets[1]) < Decimal("1")
            or abs(net - targets[2]) < Decimal("1")
        )
        if close or abs(net) > 50000:
            code = next((p.code for p in AquaculturePond.objects.filter(pk=row["pond_id"])), "?")
            name = row.get("pond_name") or "?"
            role = row.get("pond_role") or "?"
            flag = " *** MATCH ***" if close else ""
            print(f"  {code} {name} [{role}] inc={inc} exp={exp} net={net}{flag}")

# exact match scan all ponds all recent periods
print("\n=== exact match scan ===")
for p in AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "code"):
    for start, end in [
        (date(2025,2,20), date(2026,2,20)),
        (date(2026,2,20), date(2026,7,10)),
        (date(2025,7,1), date(2026,6,30)),
    ]:
        pl = compute_aquaculture_pl_summary_dict(cid, start, end, p.id, None, None, False)
        row = next(x for x in pl["ponds"] if x["pond_id"] == p.id)
        inc, exp, net = money(row["income_total"]), money(row["expense_total"]), money(row["net_profit"])
        if inc == targets[0] and exp == targets[1]:
            print(f"MATCH {p.code} {p.name} {start}..{end} net={net}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=180)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
if err:
    print("STDERR:", err)
c.close()
