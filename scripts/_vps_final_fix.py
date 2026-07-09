"""Fix P06 nursing FY gap + transfer #8 GL + final audit."""
import paramiko
from pathlib import Path

PASSWORD = "sas_corporation_noob"

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

cid = 2
start, end = date(2025,7,1), date(2026,6,30)
p06 = AquaculturePond.objects.get(code="P06")

pl = compute_aquaculture_pl_summary_dict(cid, start, end, p06.id, None, None, False)
r = next(x for x in pl["ponds"] if x["pond_id"] == p06.id)
income = money(r["income_total"])
expense = money(r["expense_total"])
gap = money(expense - income)
print(f"P06 FY before: income={income} expense={expense} gap={gap}")

if gap > Decimal("1"):
    lines = list(AquacultureFishPondTransferLine.objects.filter(transfer__from_pond_id=p06.id).select_related("to_pond").order_by("transfer__transfer_date", "id"))
    active = [ln for ln in lines if int(ln.fish_count or 0) > 0]
    total_fish = sum(int(ln.fish_count or 0) for ln in active)
    running = Decimal("0")
    with transaction.atomic():
        for i, ln in enumerate(active):
            fc = int(ln.fish_count or 0)
            if i == len(active) - 1:
                bump = money(gap - running)
            else:
                bump = money(gap * Decimal(fc) / Decimal(total_fish))
                running += bump
            old = money(ln.cost_amount or 0)
            new = money(old + bump)
            print(f"  line#{ln.id} -> {ln.to_pond.code}: {old} -> {new} (+{bump})")
            ln.cost_amount = new
            ln.save(update_fields=["cost_amount"])
        for tr in AquacultureFishPondTransfer.objects.filter(company_id=cid, from_pond_id=p06.id):
            res = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
            print(f"  GL xfer#{tr.id}: posted={res.get('posted')} amount={res.get('total_gl_amount')}")

pl2 = compute_aquaculture_pl_summary_dict(cid, start, end, p06.id, None, None, False)
r2 = next(x for x in pl2["ponds"] if x["pond_id"] == p06.id)
print(f"P06 FY after: income={r2['income_total']} expense={r2['expense_total']} net={r2['net_profit']}")

print("\n=== FINAL POND P&L ===")
pl3 = compute_aquaculture_pl_summary_dict(cid, start, end, None, None, None, False)
for row in pl3["ponds"]:
    p = AquaculturePond.objects.get(pk=row["pond_id"])
    print(f"  {p.code} {row['pond_name']!r} ({p.pond_role}): net={row['net_profit']}")

print("\n=== GL GAPS ===")
from api.services.gl_posting_audit import audit_company_gl_gaps
ga = audit_company_gl_gaps(cid)
print(f"total={ga['total_gaps']}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=600)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
Path(__file__).resolve().parent.joinpath("_vps_final_audit.txt").write_text(out, encoding="utf-8")
print(out)
c.close()
