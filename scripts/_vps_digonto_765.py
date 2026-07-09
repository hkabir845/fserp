"""Digonto P04: why net is 707957 vs expected 765000."""
import paramiko
from pathlib import Path

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
start, end = date(2025,7,1), date(2026,6,30)
p04 = AquaculturePond.objects.get(code="P04")

pl = compute_aquaculture_pl_summary_dict(cid, start, end, p04.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p04.id)
inc = money(r["income_total"])
exp = money(r["expense_total"])
net = money(r["net_profit"])
target = Decimal("765000")
print(f"P04 income={inc} expense={exp} net={net}")
print(f"target net={target} gap={money(target - net)} (need expense cut of {money(exp - (inc - target))})")

print("\nCurrent expense categories:")
cats = {}
for item in pl.get("expenses_by_category") or []:
    code = item["category"]
    amt = money(item["amount"])
    if amt:
        cats[code] = amt
        print(f"  {item.get('label')} [{code}]: {amt}")

# Jul 6 reference from user report
jul6 = {
    "feed_consumed": Decimal("2328269.05"),
    "medicine_purchase": Decimal("25905.00"),
    "fry_stocking": Decimal("380042.50"),
    "payroll_allocated": Decimal("250980.00"),
    "lease": Decimal("676500.00"),
    "pond_preparation": Decimal("24000.00"),
    "equipment": Decimal("4820.00"),
    "repair_maintenance": Decimal("9150.00"),
    "electricity": Decimal("131142.00"),
    "transportation": Decimal("77340.00"),
    "fisherman": Decimal("76310.00"),
    "day_labor": Decimal("3000.00"),
    "vendor_bill_pond": Decimal("2300.00"),
    "shop_supplies": Decimal("380.00"),
    "fish_transfer_cost_in": Decimal("123913.98"),
    "biological_write_offs": Decimal("150.00"),
}
sum_jul6 = sum(jul6.values())
print(f"\nJul6 category sum={money(sum_jul6)} implied net={money(inc - sum_jul6)}")
print("\nDelta (current - jul6):")
for code in sorted(set(cats) | set(jul6)):
    d = cats.get(code, Decimal("0")) - jul6.get(code, Decimal("0"))
    if d:
        print(f"  {code}: jul6={money(jul6.get(code,0))} now={money(cats.get(code,0))} delta={money(d)}")

print("\nPayroll allocations to P04:")
for pa in PayrollRunPondAllocation.objects.filter(pond_id=p04.id, payroll_run__payment_date__gte=start, payroll_run__payment_date__lte=end).select_related("payroll_run").order_by("payroll_run__payment_date"):
    print(f"  {pa.payroll_run.payment_date} run#{pa.payroll_run_id} {money(pa.amount)}")

# What-if: jul6 payroll only
pay_now = cats.get("payroll_allocated", Decimal("0"))
pay_jul6 = jul6["payroll_allocated"]
print(f"\nIf payroll were jul6 level ({pay_jul6} not {pay_now}): net={money(net + (pay_now - pay_jul6))}")
# What-if: jul6 electricity
elec_now = cats.get("electricity", Decimal("0"))
elec_jul6 = jul6["electricity"]
print(f"If electricity were jul6 ({elec_jul6} not {elec_now}): net={money(net - (elec_jul6 - elec_now))}")
# Combined jul6 payroll+elec+lease
adj = (pay_now - pay_jul6) - (elec_jul6 - elec_now) - (cats.get("lease",0) - jul6["lease"])
print(f"Net if jul6 payroll+elec+lease deltas applied: {money(net + adj)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
print(out)
c.close()
