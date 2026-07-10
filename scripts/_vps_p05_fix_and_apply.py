"""Apply P05 nursing balance on VPS with full GL patch."""
import paramiko

PATCH = r'''
cd ~/fserp/fserp/backend && python3 <<'PY'
from pathlib import Path
p = Path("api/services/aquaculture_pond_bio_capitalization.py")
text = p.read_text(encoding="utf-8")
changed = False
if "amount_needed = Decimal(str(amount_needed))" not in text:
    old = "    if amount_needed <= 0:\n        return Decimal(\"0\")\n"
    new = old + "    amount_needed = Decimal(str(amount_needed))\n"
    if old in text:
        text = text.replace(old, new, 1)
        changed = True
if "min(amount_needed, Decimal(str(available)))" not in text:
    text = text.replace(
        "target = _money_q(min(amount_needed, available))",
        "target = _money_q(min(amount_needed, Decimal(str(available))))",
    )
    changed = True
if changed:
    p.write_text(text, encoding="utf-8")
    print("PATCHED bio_capitalization")
else:
    print("PATCH already complete")
PY
'''

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def pl_row(cid, pid, start, end):
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, pid, None, None, False)
    return next(x for x in pl["ponds"] if x["pond_id"] == pid)

def gap(row):
    return money(Decimal(str(row["expense_total"])) - Decimal(str(row["income_total"])))

def distribute(lines, g):
    active = [ln for ln in lines if int(ln.fish_count or 0) > 0]
    total_fish = sum(int(ln.fish_count or 0) for ln in active)
    bumps, running = [], Decimal("0")
    for i, ln in enumerate(active):
        fc = int(ln.fish_count or 0)
        bump = money(g - running) if i == len(active) - 1 else money(g * Decimal(fc) / Decimal(total_fish))
        running += bump
        bumps.append(bump)
    return [(ln, money(ln.cost_amount), money(ln.cost_amount + bump)) for ln, bump in zip(active, bumps) if bump]

cid = 2
start, end = date(2025,2,20), date(2026,2,20)
pond = AquaculturePond.objects.get(code="P05")
row = pl_row(cid, pond.id, start, end)
g = gap(row)
print(f"BEFORE income={row['income_total']} expense={row['expense_total']} net={row['net_profit']} gap={g}")

lines = list(AquacultureFishPondTransferLine.objects.filter(
    transfer__company_id=cid, transfer__from_pond_id=pond.id,
).select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id"))
changes = distribute(lines, g)
xfer_ids = set()
for ln, old, new in changes:
    print(f"line {ln.id} xfer#{ln.transfer_id}: {old} -> {new}")
    ln.cost_amount = new
    ln.save(update_fields=["cost_amount"])
    xfer_ids.add(ln.transfer_id)

row = pl_row(cid, pond.id, start, end)
print(f"AFTER line update income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")

for tid in sorted(xfer_ids):
    try:
        xfer = AquacultureFishPondTransfer.objects.get(pk=tid)
        r = sync_aquaculture_fish_pond_transfer_gl(cid, xfer)
        print(f"GL xfer#{tid}: posted={r.get('posted')} amount={r.get('total_gl_amount')}")
    except Exception as ex:
        print(f"GL xfer#{tid} ERROR: {ex}")

row = pl_row(cid, pond.id, start, end)
print(f"FINAL income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
for cmd in [PATCH, SCRIPT]:
    stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
    stdin.write(cmd)
    stdin.flush()
    stdin.channel.shutdown_write()
    print(stdout.read().decode("utf-8", errors="replace"))
    err = stderr.read().decode("utf-8", errors="replace")
    if err:
        print("STDERR:", err)
c.close()
