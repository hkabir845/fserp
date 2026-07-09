"""Investigate Digonto grow-out pond P&L discrepancy on VPS."""
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

from api.models import (
    AquacultureExpense,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.reporting import report_income_statement

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = (
    AquaculturePond.objects.filter(name__iregex=r"di[gg]ont", pond_role="grow_out")
    .select_related("company")
    .first()
)
if not pond:
    raise SystemExit("Digonto grow-out pond not found")
company = pond.company
cid = company.id
pid = pond.id

periods = [
    ("current_fy", *fiscal_period_for_end_date(company, date.today())),
    ("cal_2025", date(2025, 1, 1), date(2025, 12, 31)),
    ("fy_2526", date(2025, 7, 1), date(2026, 6, 30)),
    ("ytd_2026", date(2026, 1, 1), date(2026, 7, 10)),
    ("all_time", date(2020, 1, 1), date.today()),
]

print(f"Company {cid} {company.name!r}")
print(f"Pond id={pid} code={pond.code!r} name={pond.name!r}")
print("\n=== NET PROFIT BY PERIOD ===")
matched = None
for label, ps, pe in periods:
    pl = compute_aquaculture_pl_summary_dict(cid, ps, pe, pid, None, None, False)
    pr = next((r for r in pl.get("ponds") or [] if r.get("pond_id") == pid), {})
    inc = money(pr.get("income_total") or 0)
    exp = money(pr.get("expense_total") or 0)
    net = money(pr.get("net_profit") or (inc - exp))
    marker = ""
    if abs(net - Decimal("623882.65")) < Decimal("1"):
        marker = " <-- USER REPORTED"
        matched = (label, ps, pe)
    if abs(net - Decimal("765000")) < Decimal("5000"):
        marker += " <-- EXPECTED ~765k"
    print(f"  {label} {ps}..{pe}: income={inc} expense={exp} net={net}{marker}")

if matched:
    period_start, period_end = matched[1], matched[2]
    print(f"\nUsing matched period {matched[0]} {period_start}..{period_end}")
else:
    period_start, period_end = date(2025, 7, 1), date(2026, 6, 30)
    print(f"\nNo 623882.65 match; deep-dive FY 2025-07-01..2026-06-30")

payload = compute_aquaculture_pl_summary_dict(cid, period_start, period_end, pid, None, None, False)
row = next((r for r in payload.get("ponds") or [] if r.get("pond_id") == pid), {})
income = money(row.get("income_total") or 0)
expense = money(row.get("expense_total") or 0)
net = money(row.get("net_profit") or (income - expense))
print(f"\n=== DEEP DIVE {period_start}..{period_end} ===")
print(f"income={income} expense={expense} net={net}")
print(f"gap to expected 765000 = {money(Decimal('765000') - net)}")

print("\n--- income_by_category ---")
for item in row.get("income_by_category") or []:
    amt = money(item.get("amount") or 0)
    if amt:
        print(f"  {item.get('label') or item.get('category')}: {amt}")

print("\n--- expenses_by_category ---")
cat_sum = Decimal("0")
for item in row.get("expenses_by_category") or []:
    amt = money(item.get("amount") or 0)
    if amt:
        cat_sum += amt
        print(f"  {item.get('label') or item.get('category')} [{item.get('category')}]: {amt}")
print(f"category sum: {money(cat_sum)}")

for key in sorted(row.keys()):
    if key.endswith("_total") or key in (
        "feed_cost", "medicine_cost", "lease_cost", "fry_stocking_cost",
        "fish_transfer_cost_in", "fish_transfer_cost_out", "payroll_allocated",
        "biological_write_offs", "prior_income", "prior_expense",
        "direct_expenses", "shared_expenses", "revenue_total",
        "consumption_cogs_journal_offset", "total_costs_and_expenses",
    ):
        val = row.get(key)
        if val not in (None, "", "0", "0.00", 0, "0.0"):
            print(f"  {key}={val}")

sales = AquacultureFishSale.objects.filter(
    company_id=cid, pond_id=pid, sale_date__gte=period_start, sale_date__lte=period_end
)
print(f"\nFish sales: count={sales.count()} total={money(sales.aggregate(t=Sum('total_amount'))['t'] or 0)}")

xfer_in = AquacultureFishPondTransferLine.objects.filter(
    transfer__company_id=cid,
    to_pond_id=pid,
    transfer__transfer_date__gte=period_start,
    transfer__transfer_date__lte=period_end,
).select_related("transfer", "transfer__from_pond")
print(f"\nTransfer IN: {xfer_in.count()} lines total={money(sum(money(l.cost_amount or 0) for l in xfer_in))}")
for ln in xfer_in.order_by("transfer__transfer_date", "id"):
    tr = ln.transfer
    print(f"  #{tr.id} {tr.transfer_date} from {tr.from_pond.code or tr.from_pond.name} fish={ln.fish_count} cost={money(ln.cost_amount or 0)}")

print("\n--- AquacultureExpense top categories ---")
for r in (
    AquacultureExpense.objects.filter(company_id=cid, pond_id=pid, expense_date__gte=period_start, expense_date__lte=period_end)
    .values("expense_category").annotate(s=Sum("amount")).order_by("-s")[:25]
):
    print(f"  {r['expense_category']}: {money(r['s'] or 0)}")

gl = report_income_statement(cid, period_start, period_end, pond_id=pid)
print(f"\nGL: income={money(gl.get('total_income') or 0)} cogs={money(gl.get('total_cogs') or 0)} opex={money(gl.get('total_operating_expenses') or 0)} net={money(gl.get('net_income') or 0)}")

# Nursing pond P08
nursing = AquaculturePond.objects.filter(company_id=cid, name__iregex=r"di[gg]ont", pond_role="nursing").first()
if nursing:
    npl = compute_aquaculture_pl_summary_dict(cid, period_start, period_end, nursing.id, None, None, False)
    nr = next((r for r in npl.get("ponds") or [] if r.get("pond_id") == nursing.id), {})
    print(f"\nDigonto Nursing {nursing.code}: income={money(nr.get('income_total') or 0)} expense={money(nr.get('expense_total') or 0)} net={money(nr.get('net_profit') or 0)}")
    xfer_out = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=cid,
        transfer__from_pond_id=nursing.id,
        to_pond_id=pid,
        transfer__transfer_date__gte=period_start,
        transfer__transfer_date__lte=period_end,
    )
    print(f"  transfers nursing->digonto grow-out: {xfer_out.count()} cost={money(sum(money(l.cost_amount or 0) for l in xfer_out))}")

# What expense reduction gets net to 765k?
target_exp = money(income - Decimal("765000"))
print(f"\nTo reach net 765000 with income {income}, expenses should be {target_exp} (currently {expense}, over by {money(expense - target_exp)})")
PY
'''


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    try:
        stdin, stdout, stderr = client.exec_command("bash -s", timeout=300)
        stdin.write(SCRIPT)
        stdin.flush()
        stdin.channel.shutdown_write()
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
        return code
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
