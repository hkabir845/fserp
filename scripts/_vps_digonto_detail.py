"""Detailed Digonto expense breakdown on VPS."""
import sys
import paramiko

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

from api.models import AquaculturePond, AquacultureFishPondTransferLine, AquacultureExpense, Company
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_cost_per_kg import (
    landlord_lease_payment_pond_operating_total,
    vendor_bill_pond_operating_total,
    pond_fry_stocking_capitalized_journal_total,
    pond_warehouse_consumption_cogs_journal_total,
)
from api.services.aquaculture_pl_expense_sum import pond_consumption_amounts_by_category

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
cid = pond.company_id
pid = pond.id
start, end = date(2025, 7, 1), date(2026, 6, 30)

pl = compute_aquaculture_pl_summary_dict(cid, start, end, pid, None, None, False)
row = next(r for r in pl["ponds"] if r["pond_id"] == pid)
print(f"Digonto P04 FY {start}..{end}")
print(f"income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
print(f"feed={row.get('feed_consumption_cost')} med={row.get('medicine_consumption_cost')} fry={row.get('fry_fingerling_cost')}")
print(f"lease={row.get('lease_cost')} payroll={row.get('salaries_and_payroll_cost')} xfer_in={row.get('fish_transfer_cost_in')}")
print(f"other_opex={row.get('other_operating_expenses')} direct={row.get('direct_operating_expenses')} shared={row.get('shared_operating_expenses')}")
print(f"prior_income={row.get('prior_pl_opening_income')} prior_expense={row.get('prior_pl_opening_expense')}")

print("\nTop-level expenses_by_category:")
for item in pl.get("expenses_by_category") or []:
    amt = money(item.get("amount") or 0)
    if amt:
        print(f"  {item.get('label')} [{item.get('category')}]: {amt}")

print("\nComponent checks:")
print(f"  vendor_bill_pond: {vendor_bill_pond_operating_total(cid, pid, start, end, None)}")
print(f"  landlord_lease: {landlord_lease_payment_pond_operating_total(cid, pid, start, end, None)}")
print(f"  fry_journal: {pond_fry_stocking_capitalized_journal_total(cid, pid, start, end, None)}")
print(f"  consumption_cogs_journal: {pond_warehouse_consumption_cogs_journal_total(cid, pid, start, end, None)}")
for code, amt in pond_consumption_amounts_by_category(cid, pid, start, end, None).items():
    if amt:
        print(f"  consumption {code}: {money(amt)}")

# Transfer line history
print("\nAll transfer lines TO Digonto:")
for ln in AquacultureFishPondTransferLine.objects.filter(to_pond_id=pid).select_related("transfer", "transfer__from_pond").order_by("transfer__transfer_date", "id"):
    tr = ln.transfer
    in_period = start <= tr.transfer_date <= end
    print(f"  line#{ln.id} xfer#{tr.id} {tr.transfer_date} from {tr.from_pond.code} fish={ln.fish_count} cost={money(ln.cost_amount or 0)} in_fy={in_period}")

# Lease expenses
print("\nLease-tagged expenses:")
for e in AquacultureExpense.objects.filter(company_id=cid, pond_id=pid, expense_category="lease", expense_date__gte=start, expense_date__lte=end).order_by("expense_date"):
    print(f"  {e.expense_date} {money(e.amount)} {e.notes[:60] if e.notes else ''}")

# Scenarios
inc = money(row['income_total'])
exp = money(row['expense_total'])
xfer = money(row.get('fish_transfer_cost_in') or 0)
lease = money(row.get('lease_cost') or 0)
print("\nScenarios:")
for label, xfer_adj, lease_adj in [
    ("current", xfer, lease),
    ("user_jul6_xfer", Decimal("123913.98"), Decimal("676500")),
    ("xfer_only_jul6", Decimal("123913.98"), lease),
    ("lease_only_jul6", xfer, Decimal("676500")),
]:
    adj_exp = exp - xfer + xfer_adj - lease + lease_adj
    print(f"  {label}: expense={money(adj_exp)} net={money(inc - adj_exp)}")

# Try find 623882.65
print("\nSearch periods for net 623882.65:")
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
company = pond.company
for end_d in [date(2026,6,30), date(2026,7,9), date(2026,7,10), date(2026,3,31), date(2025,12,31)]:
    ps, pe = fiscal_period_for_end_date(company, end_d) if end_d >= date(2026,1,1) else (date(2025,7,1), end_d)
    if end_d == date(2025,12,31):
        ps, pe = date(2025,1,1), end_d
    p2 = compute_aquaculture_pl_summary_dict(cid, ps, pe, pid, None, None, False)
    r2 = next(r for r in p2["ponds"] if r["pond_id"] == pid)
    net = money(r2['net_profit'])
    if abs(net - Decimal('623882.65')) < 2 or abs(net - Decimal('765000')) < 5000:
        print(f"  {ps}..{pe} net={net} income={r2['income_total']} expense={r2['expense_total']}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print(err, file=sys.stderr)
c.close()
