"""P08 expense breakdown + P02/P03 lease excess entries."""
import paramiko
from pathlib import Path

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum
from api.models import AquaculturePond, AquacultureExpense, PayrollRunPondAllocation
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_cost_per_kg import (
    vendor_bill_pond_operating_total, landlord_lease_payment_pond_operating_total,
    pond_fry_stocking_capitalized_journal_total, pond_warehouse_consumption_cogs_journal_total,
)
from api.services.aquaculture_pl_expense_sum import pond_consumption_amounts_by_category

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025,7,1), date(2026,6,30)

p08 = AquaculturePond.objects.get(code="P08")
pl = compute_aquaculture_pl_summary_dict(cid, start, end, p08.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p08.id)
print("P08 PL expense categories:")
for item in pl.get("expenses_by_category") or []:
    if money(item.get("amount") or 0):
        print(f"  {item.get('label')} [{item.get('category')}]: {item.get('amount')}")
print(f"total expense={r['expense_total']}")
print(f"vendor_bill={vendor_bill_pond_operating_total(company_id=cid, pond_id=p08.id, start=start, end=end, cycle_filter_id=None)}")
print(f"landlord={landlord_lease_payment_pond_operating_total(company_id=cid, pond_id=p08.id, start=start, end=end, cycle_filter_id=None)}")
print(f"fry_journal={pond_fry_stocking_capitalized_journal_total(company_id=cid, pond_id=p08.id, start=start, end=end, cycle_filter_id=None)}")
print(f"consumption_cogs={pond_warehouse_consumption_cogs_journal_total(company_id=cid, pond_id=p08.id, start=start, end=end, cycle_filter_id=None)}")
for code, amt in pond_consumption_amounts_by_category(cid, p08.id, start, end, None).items():
    if amt: print(f"  consumption {code}: {money(amt)}")
pay = money(PayrollRunPondAllocation.objects.filter(pond_id=p08.id, payroll_run__payment_date__gte=start, payroll_run__payment_date__lte=end).aggregate(t=Sum("amount"))["t"] or 0)
print(f"payroll={pay}")

print("\n=== P02 LEASE PAYMENTS (newest first) ===")
from api.models import AquacultureLandlordLedgerEntry
p02 = AquaculturePond.objects.get(code="P02")
annual = money(p02.leasing_area_decimal * p02.lease_price_per_decimal_per_year)
total = Decimal("0")
for ent in AquacultureLandlordLedgerEntry.objects.filter(landlord__company_id=cid, pond_id=p02.id, kind="payment", entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False).order_by("-entry_date", "-id"):
    amt = money(abs(ent.amount_signed or 0))
    total += amt
    print(f"  #{ent.id} {ent.entry_date} {amt} {ent.memo[:50] if ent.memo else ''}")
print(f"total={money(total)} annual={annual} excess={money(total-annual)}")

print("\n=== P03 LEASE PAYMENTS (newest first, top 25) ===")
p03 = AquaculturePond.objects.get(code="P03")
annual3 = money(p03.leasing_area_decimal * p03.lease_price_per_decimal_per_year)
total3 = Decimal("0")
for ent in AquacultureLandlordLedgerEntry.objects.filter(landlord__company_id=cid, pond_id=p03.id, kind="payment", entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False).order_by("-entry_date", "-id")[:25]:
    amt = money(abs(ent.amount_signed or 0))
    total3 += amt
    print(f"  #{ent.id} {ent.entry_date} {amt} {ent.memo[:50] if ent.memo else ''}")
all_total = money(sum(abs(money(e.amount_signed or 0)) for e in AquacultureLandlordLedgerEntry.objects.filter(landlord__company_id=cid, pond_id=p03.id, kind="payment", entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False)))
print(f"total={all_total} annual={annual3} excess={money(all_total-annual3)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
Path(__file__).resolve().parent.joinpath("_vps_p08_lease.txt").write_text(out, encoding="utf-8")
print("saved _vps_p08_lease.txt", len(out))
c.close()
