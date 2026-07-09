"""Digonto P04 P&L for period 20-02-2025 to 20-02-2026."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import AquaculturePond, PayrollRunPondAllocation
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025,2,20), date(2026,2,20)
p04 = AquaculturePond.objects.get(code="P04")

pl = compute_aquaculture_pl_summary_dict(cid, start, end, p04.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p04.id)
inc = money(r["income_total"])
exp = money(r["expense_total"])
net = money(r["net_profit"])
print(f"PERIOD {start} .. {end}")
print(f"P04 Digonto: income={inc} expense={exp} net={net}")
print(f"target 765000 gap={money(Decimal('765000') - net)}")

print("\nExpense categories:")
cat_sum = Decimal("0")
for item in pl.get("expenses_by_category") or []:
    amt = money(item["amount"])
    if amt:
        cat_sum += amt
        print(f"  {item.get('label')} [{item['category']}]: {amt}")
print(f"category sum={money(cat_sum)}")

pay = money(PayrollRunPondAllocation.objects.filter(
    pond_id=p04.id, payroll_run__company_id=cid,
    payroll_run__payment_date__gte=start, payroll_run__payment_date__lte=end,
).aggregate(s=Sum("amount"))["s"] or 0)
print(f"\npayroll_allocated in PL={r.get('salaries_and_payroll_cost') or r.get('payroll_allocated')} payroll query={pay}")

# Compare nearby periods
for label, s, e in [
    ("user_period", start, end),
    ("through_feb18", date(2025,2,20), date(2026,2,18)),
    ("fy_jul_jun", date(2025,7,1), date(2026,6,30)),
]:
    pl2 = compute_aquaculture_pl_summary_dict(cid, s, e, p04.id, None, None, False)
    r2 = next(x for x in pl2["ponds"] if x["pond_id"] == p04.id)
    print(f"  {label} {s}..{e}: net={r2['net_profit']} income={r2['income_total']} expense={r2['expense_total']}")
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
c.close()
