"""P05 nursing pond P&L gap breakdown on VPS."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from api.models import AquacultureFishPondTransferLine, AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025,2,20), date(2026,2,20)
pond = AquaculturePond.objects.get(code="P05")
pl = compute_aquaculture_pl_summary_dict(cid, start, end, pond.id, None, None, False)
row = next(x for x in pl["ponds"] if x["pond_id"] == pond.id)
print(f"P05 {pond.name} role={pond.pond_role}")
print(f"income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
print(f"gap expense-income={money(Decimal(str(row['expense_total']))-Decimal(str(row['income_total'])))}")

print("\nExpense categories:")
for item in pl.get("expenses_by_category") or []:
    if Decimal(str(item.get("amount") or 0)):
        print(f"  {item.get('label')} [{item['category']}]: {item['amount']}")

print("\nIncome categories:")
for item in pl.get("income_by_category") or []:
    if Decimal(str(item.get("amount") or 0)):
        print(f"  {item.get('label')} [{item['category']}]: {item['amount']}")

lines = AquacultureFishPondTransferLine.objects.filter(
    transfer__company_id=cid, transfer__from_pond_id=pond.id,
    transfer__transfer_date__gte=start, transfer__transfer_date__lte=end,
).select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id")
xfer_inc = Decimal("0")
print(f"\nTransfer lines out ({lines.count()}):")
for ln in lines:
    c = money(ln.cost_amount)
    xfer_inc += c
    print(f"  #{ln.id} xfer#{ln.transfer_id} {ln.transfer.transfer_date} -> {ln.to_pond.code} fish={ln.fish_count} cost={c}")
print(f"transfer_line_cost_sum={money(xfer_inc)}")

res = resync_nursing_pond_transfer_costs(cid, pond.id, start, end)
print(f"\nresync_nursing_pond_transfer_costs: {res}")

pl2 = compute_aquaculture_pl_summary_dict(cid, start, end, pond.id, None, None, False)
row2 = next(x for x in pl2["ponds"] if x["pond_id"] == pond.id)
print(f"\nAfter resync: income={row2['income_total']} expense={row2['expense_total']} net={row2['net_profit']}")
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
