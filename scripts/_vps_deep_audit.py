"""Deep VPS audit + fixes for nursing ponds, GL gaps, lease."""
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
from collections import defaultdict
from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransferLine, AquacultureLandlordLedgerEntry, AquaculturePond,
    AquacultureExpense, Company,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.gl_posting_audit import audit_company_gl_gaps

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
company = Company.objects.get(pk=cid)
start, end = date(2025,7,1), date(2026,6,30)

print("=== NURSING POND TRANSFER DETAIL ===")
for pond in AquaculturePond.objects.filter(company_id=cid, pond_role="nursing").order_by("code"):
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, pond.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == pond.id)
    out_lines = AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=pond.id)
    out_cost = money(sum(money(l.cost_amount or 0) for l in out_lines))
    out_fy = AquacultureFishPondTransferLine.objects.filter(
        transfer__from_pond_id=pond.id,
        transfer__transfer_date__gte=start,
        transfer__transfer_date__lte=end,
    )
    fy_cost = money(sum(money(l.cost_amount or 0) for l in out_fy))
    exp = money(AquacultureExpense.objects.filter(company_id=cid, pond_id=pond.id, expense_date__gte=start, expense_date__lte=end).aggregate(t=Sum("amount"))["t"] or 0)
    print(f"\n{pond.code} {pond.name!r}")
    print(f"  PL income={r['income_total']} expense={r['expense_total']} net={r['net_profit']}")
    print(f"  xfer_out_lines={out_lines.count()} alltime_cost={out_cost} fy_cost={fy_cost}")
    print(f"  direct_expense_register={exp}")
    for ln in out_fy.select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id"):
        print(f"    line#{ln.id} {ln.transfer.transfer_date} -> {ln.to_pond.code} fish={ln.fish_count} cost={money(ln.cost_amount or 0)}")

print("\n=== LEASE PAYMENTS BY POND (FY) ===")
for pond in AquaculturePond.objects.filter(company_id=cid).order_by("code"):
    annual = None
    if pond.leasing_area_decimal and pond.lease_price_per_decimal_per_year:
        annual = money(pond.leasing_area_decimal * pond.lease_price_per_decimal_per_year)
    pays = AquacultureLandlordLedgerEntry.objects.filter(
        landlord__company_id=cid, pond_id=pond.id, kind="payment",
        entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False,
    )
    total = money(sum(abs(money(e.amount_signed or 0)) for e in pays))
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, pond.id, None, None, False)
    r = next((x for x in pl["ponds"] if x["pond_id"] == pond.id), {})
    lease_pl = money(r.get("lease_cost") or 0)
    flag = ""
    if annual and total > annual + 10000:
        flag = f" OVER+{money(total-annual)}"
    elif annual and total < annual - 50000:
        flag = f" under-{money(annual-total)}"
    print(f"  {pond.code} payments={total} pl_lease={lease_pl} annual={annual}{flag}")

print("\n=== DUPLICATE LEASE (same pond+date+amount) ===")
seen = defaultdict(list)
for ent in AquacultureLandlordLedgerEntry.objects.filter(
    landlord__company_id=cid, kind="payment", pond_id__isnull=False,
    entry_date__gte=start, entry_date__lte=end,
).select_related("pond"):
    key = (ent.pond.code, ent.entry_date.isoformat(), str(money(abs(ent.amount_signed or 0))))
    seen[key].append(ent.id)
for k, ids in seen.items():
    if len(ids) > 1:
        print(f"  DUP {k} ids={ids}")

print("\n=== GL GAPS ===")
ga = audit_company_gl_gaps(cid)
print(f"total={ga['total_gaps']}")
for gt, rows in ga["gaps_by_type"].items():
    for row in rows:
        print(f"  {gt}: #{row['record_id']} {row['label']} {row.get('amount')}")

print("\n=== GROW-OUT NEGATIVE NET (possible transfer cost issues) ===")
pl = compute_aquaculture_pl_summary_dict(cid, start, end, None, None, None, False)
for r in pl["ponds"]:
    net = money(r["net_profit"])
    if net < -100000:
        p = AquaculturePond.objects.get(pk=r["pond_id"])
        if p.pond_role == "grow_out":
            print(f"  {p.code} {p.name!r} net={net} xfer_in={r.get('fish_transfer_cost_in')} fry={r.get('fry_fingerling_cost')}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=600)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
Path(__file__).resolve().parent.joinpath("_vps_deep_audit.txt").write_text(out, encoding="utf-8")
print(out)
err = stderr.read().decode()
if err:
    print("ERR:", err)
c.close()
