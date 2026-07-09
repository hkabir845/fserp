"""Audit Digonto P04 payroll allocations on VPS - employee home pond mismatch."""
import paramiko
from pathlib import Path

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from django.db.models import Sum

from api.models import (
    AquaculturePond, Employee, PayrollRun, PayrollRunPondAllocation,
    PayrollRunEmployeeAllocation,
)

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def emp_label(e):
    return f"{(e.first_name or '').strip()} {(e.last_name or '').strip()}".strip() or e.employee_code or f"#{e.id}"

cid = 2
start, end = date(2025,7,1), date(2026,6,30)
p04 = AquaculturePond.objects.get(code="P04")

allocs = list(
    PayrollRunPondAllocation.objects.filter(
        pond_id=p04.id,
        payroll_run__company_id=cid,
        payroll_run__payment_date__gte=start,
        payroll_run__payment_date__lte=end,
    )
    .select_related("payroll_run")
    .order_by("payroll_run__payment_date", "id")
)
total_p04 = money(sum(money(a.amount or 0) for a in allocs))
print(f"P04 payroll FY total: {total_p04} (Jul6 ref 250980, excess {money(total_p04 - Decimal('250980'))})\n")

print("=== ALL P04 ALLOCATIONS ===")
for pa in allocs:
    pr = pa.payroll_run
    pond_splits = list(
        PayrollRunPondAllocation.objects.filter(payroll_run_id=pr.id).select_related("pond")
    )
    split_str = " | ".join(f"{s.pond.code}={money(s.amount)}" for s in pond_splits)
    emps = list(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).select_related("employee")
    )
    emp_str = "; ".join(f"{emp_label(e.employee)}={money(e.amount)}" for e in emps[:6])
    print(f"#{pa.id} run#{pr.id} {pr.payment_date} status={pr.status} gross={money(pr.total_gross)}")
    print(f"  P04={money(pa.amount)} splits=[{split_str}]")
    if emp_str:
        print(f"  staff: {emp_str}")
    if pr.notes:
        print(f"  notes: {pr.notes[:100]}")

print("\n=== EMPLOYEES WITH home_pond != P04 BUT PAID ON P04 RUNS ===")
misassigned = []
for pa in allocs:
    pr = pa.payroll_run
    for ea in PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).select_related("employee", "employee__home_aquaculture_pond"):
        emp = ea.employee
        home = emp.home_aquaculture_pond
        if home and home.id != p04.id:
            misassigned.append({
                "run": pr.id, "date": pr.payment_date, "emp": emp_label(emp),
                "home": home.code, "p04_amt": money(pa.amount), "emp_amt": money(ea.amount),
                "scope": emp.aquaculture_labor_scope,
            })
        elif emp.aquaculture_labor_scope == "not_applicable" and money(pa.amount) > 0:
            misassigned.append({
                "run": pr.id, "date": pr.payment_date, "emp": emp_label(emp),
                "home": "N/A", "p04_amt": money(pa.amount), "emp_amt": money(ea.amount),
                "scope": "not_applicable",
            })
for m in misassigned:
    print(f"  run#{m['run']} {m['date']} {m['emp']} home={m['home']} scope={m['scope']} emp_line={m['emp_amt']} P04_alloc={m['p04_amt']}")
print(f"misassigned rows: {len(misassigned)}")

print("\n=== EMPLOYEES home_pond=P04 (should be on P04 payroll) ===")
for emp in Employee.objects.filter(company_id=cid, home_aquaculture_pond_id=p04.id, is_active=True):
    paid = money(
        PayrollRunEmployeeAllocation.objects.filter(
            employee_id=emp.id,
            payroll_run__company_id=cid,
            payroll_run__payment_date__gte=start,
            payroll_run__payment_date__lte=end,
        ).aggregate(s=Sum("amount"))["s"] or 0
    )
    print(f"  {emp_label(emp)} scope={emp.aquaculture_labor_scope} paid_in_FY={paid}")

print("\n=== PAYROLL BY POND ===")
for pond in AquaculturePond.objects.filter(company_id=cid).order_by("code"):
    t = money(PayrollRunPondAllocation.objects.filter(
        pond_id=pond.id, payroll_run__company_id=cid,
        payroll_run__payment_date__gte=start, payroll_run__payment_date__lte=end,
    ).aggregate(s=Sum("amount"))["s"] or 0)
    if t:
        print(f"  {pond.code}: {t}")

print("\n=== TIMING: before vs after Jul 6 2025 ===")
pre = money(sum(money(p.amount) for p in allocs if p.payroll_run.payment_date <= date(2025,7,6)))
post = money(sum(money(p.amount) for p in allocs if p.payroll_run.payment_date > date(2025,7,6)))
print(f"through Jul6: {pre} ({len([p for p in allocs if p.payroll_run.payment_date <= date(2025,7,6)])} runs)")
print(f"after Jul6:   {post} ({len([p for p in allocs if p.payroll_run.payment_date > date(2025,7,6)])} runs)")

print("\n=== LARGE P04-ONLY RUNS (>= 20000) after Jul 6 ===")
for pa in allocs:
    if pa.payroll_run.payment_date <= date(2025,7,6):
        continue
    if money(pa.amount) < 20000:
        continue
    n = PayrollRunPondAllocation.objects.filter(payroll_run_id=pa.payroll_run_id).count()
    if n == 1:
        pr = pa.payroll_run
        emps = PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).select_related("employee")
        print(f"  run#{pr.id} {pr.payment_date} P04={money(pa.amount)} gross={money(pr.total_gross)}")
        for ea in emps:
            e = ea.employee
            hp = e.home_aquaculture_pond.code if e.home_aquaculture_pond_id else "-"
            print(f"    {emp_label(e)} home={hp} scope={e.aquaculture_labor_scope} amt={money(ea.amount)}")

print("\n=== SHARED PAYROLL RUNS (P04 + other ponds) ===")
for pa in allocs:
    splits = list(PayrollRunPondAllocation.objects.filter(payroll_run_id=pa.payroll_run_id).select_related("pond"))
    if len(splits) > 1:
        print(f"  run#{pa.payroll_run_id} {pa.payroll_run.payment_date}: " + 
              ", ".join(f"{s.pond.code}={money(s.amount)}" for s in splits))
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
Path(__file__).resolve().parent.joinpath("_vps_payroll_audit.txt").write_text(out, encoding="utf-8")
print(out)
if stderr.read().decode():
    print("ERR:", stderr.read().decode())
c.close()
